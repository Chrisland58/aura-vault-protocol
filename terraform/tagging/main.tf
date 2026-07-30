# ─────────────────────────────────────────────────────────────────────────────
# terraform/tagging/main.tf
#
# Implements the cost tagging strategy for Aura Vault Protocol.
# Issue #509
#
# What this module does:
#   1. Defines the required tag set as a local (single source of truth)
#   2. Creates an AWS Config rule that flags resources missing required tags
#   3. Creates a CloudWatch alarm for untagged resources via Config compliance
#   4. Creates an SNS topic for untagged-resource alerts
#   5. Enables Cost Explorer tag cost allocation
# ─────────────────────────────────────────────────────────────────────────────

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.50"
    }
  }

  backend "s3" {
    key            = "tagging/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "aura-vault-terraform-locks"
    encrypt        = true
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = local.required_tags
  }
}

data "aws_caller_identity" "current" {}

# ─────────────────────────────────────────────────────────────────────────────
# Tag definitions — single source of truth
# All Terraform modules import these via data source or module call.
# ─────────────────────────────────────────────────────────────────────────────
locals {
  required_tag_keys = [
    "Environment",
    "Project",
    "Team",
    "CostCenter",
    "ManagedBy",
  ]

  # Default values applied by the AWS provider default_tags block.
  # Individual resources can override Environment per-module.
  required_tags = {
    Project    = var.project
    Team       = var.team
    CostCenter = var.cost_center
    ManagedBy  = "terraform"
    # Environment is set per-module (staging | production | global)
  }
}

# ─────────────────────────────────────────────────────────────────────────────
# AWS Config — record all resource changes
# ─────────────────────────────────────────────────────────────────────────────

# S3 bucket for Config delivery channel
resource "aws_s3_bucket" "config_logs" {
  bucket        = "${var.project}-aws-config-logs-${data.aws_caller_identity.current.account_id}"
  force_destroy = false
}

resource "aws_s3_bucket_lifecycle_configuration" "config_logs" {
  bucket = aws_s3_bucket.config_logs.id

  rule {
    id     = "expire-old-config"
    status = "Enabled"

    expiration {
      days = 365
    }
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "config_logs" {
  bucket = aws_s3_bucket.config_logs.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "config_logs" {
  bucket                  = aws_s3_bucket.config_logs.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# IAM role for AWS Config service
data "aws_iam_policy_document" "config_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["config.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "config" {
  name               = "${var.project}-aws-config"
  assume_role_policy = data.aws_iam_policy_document.config_assume.json
}

resource "aws_iam_role_policy_attachment" "config_managed" {
  role       = aws_iam_role.config.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWS_ConfigRole"
}

# Allow Config to write to the S3 bucket
data "aws_iam_policy_document" "config_s3" {
  statement {
    effect    = "Allow"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.config_logs.arn}/AWSLogs/${data.aws_caller_identity.current.account_id}/Config/*"]

    condition {
      test     = "StringEquals"
      variable = "s3:x-amz-acl"
      values   = ["bucket-owner-full-control"]
    }
  }

  statement {
    effect    = "Allow"
    actions   = ["s3:GetBucketAcl"]
    resources = [aws_s3_bucket.config_logs.arn]
  }
}

resource "aws_iam_role_policy" "config_s3" {
  name   = "config-s3-delivery"
  role   = aws_iam_role.config.id
  policy = data.aws_iam_policy_document.config_s3.json
}

# Config recorder
resource "aws_config_configuration_recorder" "main" {
  name     = "${var.project}-recorder"
  role_arn = aws_iam_role.config.arn

  recording_group {
    all_supported                 = true
    include_global_resource_types = true
  }
}

resource "aws_config_delivery_channel" "main" {
  name           = "${var.project}-delivery"
  s3_bucket_name = aws_s3_bucket.config_logs.bucket
  sns_topic_arn  = aws_sns_topic.untagged_alert.arn

  depends_on = [aws_config_configuration_recorder.main]
}

resource "aws_config_configuration_recorder_status" "main" {
  name       = aws_config_configuration_recorder.main.name
  is_enabled = true

  depends_on = [aws_config_delivery_channel.main]
}

# ─────────────────────────────────────────────────────────────────────────────
# AWS Config Rule — required-tags
# Flags any supported resource missing one of the required tag keys.
# ─────────────────────────────────────────────────────────────────────────────
resource "aws_config_config_rule" "required_tags" {
  name        = "${var.project}-required-tags"
  description = "Checks that all tagged resources carry the required Aura Vault tags"

  source {
    owner             = "AWS"
    source_identifier = "REQUIRED_TAGS"
  }

  input_parameters = jsonencode({
    tag1Key = local.required_tag_keys[0]  # Environment
    tag2Key = local.required_tag_keys[1]  # Project
    tag3Key = local.required_tag_keys[2]  # Team
    tag4Key = local.required_tag_keys[3]  # CostCenter
    tag5Key = local.required_tag_keys[4]  # ManagedBy
  })

  depends_on = [aws_config_configuration_recorder_status.main]
}

# ─────────────────────────────────────────────────────────────────────────────
# SNS topic — untagged resource alerts
# ─────────────────────────────────────────────────────────────────────────────
resource "aws_sns_topic" "untagged_alert" {
  name              = "${var.project}-untagged-resources"
  kms_master_key_id = "alias/aws/sns"
}

resource "aws_sns_topic_subscription" "alert_email" {
  count     = length(var.alert_emails)
  topic_arn = aws_sns_topic.untagged_alert.arn
  protocol  = "email"
  endpoint  = var.alert_emails[count.index]
}

# ─────────────────────────────────────────────────────────────────────────────
# CloudWatch alarm — triggers when Config finds non-compliant resources
# ─────────────────────────────────────────────────────────────────────────────

# EventBridge rule: catch Config rule non-compliance events
resource "aws_cloudwatch_event_rule" "config_noncompliant" {
  name        = "${var.project}-config-noncompliant"
  description = "Fires when AWS Config marks a resource as non-compliant (missing required tags)"

  event_pattern = jsonencode({
    source      = ["aws.config"]
    detail-type = ["Config Rules Compliance Change"]
    detail = {
      configRuleName = [aws_config_config_rule.required_tags.name]
      newEvaluationResult = {
        complianceType = ["NON_COMPLIANT"]
      }
    }
  })
}

resource "aws_cloudwatch_event_target" "notify_sns" {
  rule      = aws_cloudwatch_event_rule.config_noncompliant.name
  target_id = "NotifySNS"
  arn       = aws_sns_topic.untagged_alert.arn
}

# Allow EventBridge to publish to SNS
resource "aws_sns_topic_policy" "allow_eventbridge" {
  arn    = aws_sns_topic.untagged_alert.arn
  policy = data.aws_iam_policy_document.sns_eventbridge.json
}

data "aws_iam_policy_document" "sns_eventbridge" {
  statement {
    sid    = "AllowEventBridge"
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }

    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.untagged_alert.arn]
  }
}

# CloudWatch metric alarm: count of NON_COMPLIANT evaluations per day
resource "aws_cloudwatch_metric_alarm" "untagged_resources" {
  alarm_name          = "${var.project}-untagged-resources"
  alarm_description   = "One or more AWS resources are missing required cost allocation tags"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  threshold           = 0
  period              = 86400  # 24 hours
  statistic           = "Sum"
  namespace           = "AWS/Config"
  metric_name         = "NonCompliantRules"

  dimensions = {
    ConfigRuleName = aws_config_config_rule.required_tags.name
  }

  alarm_actions = [aws_sns_topic.untagged_alert.arn]
  ok_actions    = [aws_sns_topic.untagged_alert.arn]

  treat_missing_data = "notBreaching"
}

# ─────────────────────────────────────────────────────────────────────────────
# Cost Explorer — enable cost allocation tags
# (Tags must be activated in the AWS Billing console after first apply;
#  this resource activates them programmatically if the API supports it)
# ─────────────────────────────────────────────────────────────────────────────
resource "aws_ce_cost_allocation_tag" "tags" {
  for_each = toset(local.required_tag_keys)
  tag_key  = each.key
  status   = "Active"
}
