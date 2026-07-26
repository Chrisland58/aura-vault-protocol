# ─────────────────────────────────────────────────────────────────────────────
# Aura Vault Protocol – Terraform Remote State Bootstrap
# Issue #502
#
# Provisions the S3 bucket + DynamoDB table that ALL other Terraform modules
# will use as their remote backend.  This module is intentionally bootstrapped
# with a LOCAL backend (terraform init without -backend-config) and its own
# state is stored here after the first apply.
#
# Run order:
#   1. terraform -chdir=terraform/remote-state init
#   2. terraform -chdir=terraform/remote-state apply
#   3. Run scripts/migrate-state.sh to push any pre-existing local state files
# ─────────────────────────────────────────────────────────────────────────────

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.50"
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = local.common_tags
  }
}

# ── Locals ────────────────────────────────────────────────────────────────────
locals {
  common_tags = {
    Project     = var.project
    Environment = "global"
    Team        = var.team
    CostCenter  = var.cost_center
    ManagedBy   = "terraform"
  }
}

# ── Random suffix to ensure globally unique bucket name ───────────────────────
resource "random_id" "bucket_suffix" {
  byte_length = 4
}

# ── S3 State Bucket ───────────────────────────────────────────────────────────
resource "aws_s3_bucket" "terraform_state" {
  bucket        = "${var.project}-terraform-state-${random_id.bucket_suffix.hex}"
  force_destroy = false # protect from accidental deletion

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "terraform_state" {
  bucket                  = aws_s3_bucket.terraform_state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Deny unencrypted uploads and non-HTTPS requests
resource "aws_s3_bucket_policy" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id
  policy = data.aws_iam_policy_document.state_bucket.json

  depends_on = [aws_s3_bucket_public_access_block.terraform_state]
}

data "aws_iam_policy_document" "state_bucket" {
  # Deny any request that does not use TLS
  statement {
    sid    = "DenyNonTLS"
    effect = "Deny"

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    actions   = ["s3:*"]
    resources = [aws_s3_bucket.terraform_state.arn, "${aws_s3_bucket.terraform_state.arn}/*"]

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }

  # Allow access only from the CI role and admin role
  statement {
    sid    = "AllowCIAndAdmin"
    effect = "Allow"

    principals {
      type = "AWS"
      identifiers = [
        aws_iam_role.terraform_ci.arn,
        "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root",
      ]
    }

    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:ListBucket",
    ]

    resources = [aws_s3_bucket.terraform_state.arn, "${aws_s3_bucket.terraform_state.arn}/*"]
  }
}

# ── DynamoDB Lock Table ────────────────────────────────────────────────────────
resource "aws_dynamodb_table" "terraform_locks" {
  name         = "${var.project}-terraform-locks"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled = true
  }

  lifecycle {
    prevent_destroy = true
  }
}

# ── OIDC Provider (GitHub Actions) ────────────────────────────────────────────
data "aws_caller_identity" "current" {}

resource "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"

  client_id_list = ["sts.amazonaws.com"]

  # Thumbprints for token.actions.githubusercontent.com (rotate annually)
  thumbprint_list = [
    "6938fd4d98bab03faadb97b34396831e3780aea1",
    "1c58a3a8518e8759bf075b76b750d4f2df264fcd",
  ]
}

# ── CI IAM Role (assumed via OIDC) ────────────────────────────────────────────
data "aws_iam_policy_document" "github_oidc_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    # Restrict to the aura-vault-protocol repo on any branch/tag
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_org}/${var.github_repo}:*"]
    }
  }
}

resource "aws_iam_role" "terraform_ci" {
  name               = "${var.project}-terraform-ci"
  assume_role_policy = data.aws_iam_policy_document.github_oidc_assume.json
  max_session_duration = 3600

  description = "Assumed by GitHub Actions via OIDC to run Terraform — no long-lived keys"
}

# Minimal permissions for CI: read/write state only
data "aws_iam_policy_document" "terraform_ci_permissions" {
  # S3 state access
  statement {
    sid    = "StateAccess"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:ListBucket",
    ]
    resources = [
      aws_s3_bucket.terraform_state.arn,
      "${aws_s3_bucket.terraform_state.arn}/*",
    ]
  }

  # DynamoDB lock access
  statement {
    sid    = "LockAccess"
    effect = "Allow"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:DeleteItem",
    ]
    resources = [aws_dynamodb_table.terraform_locks.arn]
  }

  # KMS — allow using the bucket key
  statement {
    sid    = "KMSAccess"
    effect = "Allow"
    actions = [
      "kms:GenerateDataKey",
      "kms:Decrypt",
    ]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["s3.${var.aws_region}.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "terraform_ci" {
  name   = "terraform-state-access"
  role   = aws_iam_role.terraform_ci.id
  policy = data.aws_iam_policy_document.terraform_ci_permissions.json
}
