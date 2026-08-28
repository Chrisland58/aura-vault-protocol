# ─────────────────────────────────────────────────────────────────────────────
# Issue #520: AWS WAF v2 for the Application Load Balancer
# ─────────────────────────────────────────────────────────────────────────────

# Random suffix for globally-unique bucket names
resource "random_id" "waf_suffix" {
  byte_length = 4
}

resource "random_id" "athena_suffix" {
  byte_length = 4
}

# ── WAF Web ACL ────────────────────────────────────────────────────────────

resource "aws_wafv2_web_acl" "main" {
  name        = "${var.project_name}-waf-${var.environment}"
  description = "WAF ACL for ${var.project_name} ALB — managed rules + rate limiting"
  scope       = "REGIONAL"

  default_action {
    allow {}
  }

  # 1. AWS Core Rule Set (CRS)
  rule {
    name     = "AWSManagedRulesCommonRuleSet"
    priority = 10

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.project_name}-waf-crs-${var.environment}"
      sampled_requests_enabled   = true
    }
  }

  # 2. Known Bad Inputs
  rule {
    name     = "AWSManagedRulesKnownBadInputsRuleSet"
    priority = 20

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.project_name}-waf-kbi-${var.environment}"
      sampled_requests_enabled   = true
    }
  }

  # 3. SQL Injection Protection
  rule {
    name     = "AWSManagedRulesSQLiRuleSet"
    priority = 30

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesSQLiRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.project_name}-waf-sqli-${var.environment}"
      sampled_requests_enabled   = true
    }
  }

  # 4. Rate-limiting rule: 2000 requests per 5-minute window per IP
  rule {
    name     = "RateLimitPerIP"
    priority = 40

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit              = var.waf_rate_limit_threshold
        aggregate_key_type = "IP"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.project_name}-waf-ratelimit-${var.environment}"
      sampled_requests_enabled   = true
    }
  }

  # 5. Geo-blocking rule (only active when waf_blocked_countries is non-empty)
  dynamic "rule" {
    for_each = length(var.waf_blocked_countries) > 0 ? [1] : []

    content {
      name     = "GeoBlockRule"
      priority = 50

      action {
        block {}
      }

      statement {
        geo_match_statement {
          country_codes = var.waf_blocked_countries
        }
      }

      visibility_config {
        cloudwatch_metrics_enabled = true
        metric_name                = "${var.project_name}-waf-geo-${var.environment}"
        sampled_requests_enabled   = true
      }
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.project_name}-waf-${var.environment}"
    sampled_requests_enabled   = true
  }

  tags = {
    Name = "${var.project_name}-waf-${var.environment}"
  }
}

# ── WAF ↔ ALB Association ─────────────────────────────────────────────────

resource "aws_wafv2_web_acl_association" "alb" {
  count        = var.enable_waf ? 1 : 0
  resource_arn = aws_lb.main.arn
  web_acl_arn  = aws_wafv2_web_acl.main.arn
}

# ── S3 Bucket: WAF Logs ───────────────────────────────────────────────────

resource "aws_s3_bucket" "waf_logs" {
  # WAF log bucket name must start with "aws-waf-logs-"
  bucket = "aws-waf-logs-${var.project_name}-${var.environment}-${random_id.waf_suffix.hex}"

  tags = {
    Name = "${var.project_name}-waf-logs-${var.environment}"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "waf_logs" {
  bucket = aws_s3_bucket.waf_logs.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "waf_logs" {
  bucket = aws_s3_bucket.waf_logs.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_public_access_block" "waf_logs" {
  bucket = aws_s3_bucket.waf_logs.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "waf_logs" {
  bucket = aws_s3_bucket.waf_logs.id

  rule {
    id     = "waf-log-retention"
    status = "Enabled"

    transition {
      days          = 30
      storage_class = "STANDARD_IA"
    }

    expiration {
      days = 90
    }

    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }
}

# ── WAF Logging Configuration ─────────────────────────────────────────────

resource "aws_wafv2_web_acl_logging_configuration" "main" {
  log_destination_configs = [aws_s3_bucket.waf_logs.arn]
  resource_arn            = aws_wafv2_web_acl.main.arn

  depends_on = [
    aws_s3_bucket_policy.waf_logs,
  ]
}

# Allow WAF to write to the S3 bucket
resource "aws_s3_bucket_policy" "waf_logs" {
  bucket = aws_s3_bucket.waf_logs.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AWSLogDeliveryWrite"
        Effect = "Allow"
        Principal = {
          Service = "delivery.logs.amazonaws.com"
        }
        Action   = "s3:PutObject"
        Resource = "${aws_s3_bucket.waf_logs.arn}/AWSLogs/*"
        Condition = {
          StringEquals = {
            "s3:x-amz-acl" = "bucket-owner-full-control"
          }
        }
      },
      {
        Sid    = "AWSLogDeliveryAclCheck"
        Effect = "Allow"
        Principal = {
          Service = "delivery.logs.amazonaws.com"
        }
        Action   = "s3:GetBucketAcl"
        Resource = aws_s3_bucket.waf_logs.arn
      }
    ]
  })
}

# ── SNS Alerts: Blocked Requests Spike ───────────────────────────────────

resource "aws_sns_topic" "waf_alerts" {
  name = "${var.project_name}-waf-alerts-${var.environment}"

  tags = {
    Name = "${var.project_name}-waf-alerts-${var.environment}"
  }
}

resource "aws_sns_topic_subscription" "waf_alerts_email" {
  count     = var.alert_email != "" ? 1 : 0
  topic_arn = aws_sns_topic.waf_alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

resource "aws_cloudwatch_metric_alarm" "waf_blocked_requests_spike" {
  alarm_name          = "${var.project_name}-waf-blocked-spike-${var.environment}"
  alarm_description   = "Alert when WAF blocked request count spikes above threshold"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "BlockedRequests"
  namespace           = "AWS/WAFV2"
  period              = 300
  statistic           = "Sum"
  threshold           = 100
  treat_missing_data  = "notBreaching"

  dimensions = {
    Rule   = "ALL"
    WebACL = aws_wafv2_web_acl.main.name
    Region = var.aws_region
  }

  alarm_actions = [aws_sns_topic.waf_alerts.arn]
  ok_actions    = [aws_sns_topic.waf_alerts.arn]

  tags = {
    Name = "${var.project_name}-waf-blocked-spike-${var.environment}"
  }
}

# ── Athena: Query WAF Logs ────────────────────────────────────────────────

resource "aws_s3_bucket" "athena_results" {
  bucket = "${var.project_name}-athena-results-${var.environment}-${random_id.athena_suffix.hex}"

  tags = {
    Name = "${var.project_name}-athena-results-${var.environment}"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "athena_results" {
  bucket = aws_s3_bucket.athena_results.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "athena_results" {
  bucket = aws_s3_bucket.athena_results.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_athena_workgroup" "waf_analysis" {
  name        = "${var.project_name}-waf-analysis-${var.environment}"
  description = "Athena workgroup for querying WAF logs"

  configuration {
    enforce_workgroup_configuration    = true
    publish_cloudwatch_metrics_enabled = true

    result_configuration {
      output_location = "s3://${aws_s3_bucket.athena_results.bucket}/waf-query-results/"

      encryption_configuration {
        encryption_option = "SSE_S3"
      }
    }
  }

  tags = {
    Name = "${var.project_name}-waf-analysis-${var.environment}"
  }
}

resource "aws_athena_database" "waf_logs" {
  name   = replace("${var.project_name}_waf_logs_${var.environment}", "-", "_")
  bucket = aws_s3_bucket.athena_results.bucket

  encryption_configuration {
    encryption_option = "SSE_S3"
  }
}
