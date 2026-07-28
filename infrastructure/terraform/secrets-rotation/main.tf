terraform {
  required_version = ">= 1.8.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# ── Data sources ──────────────────────────────────────────────────────────────

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

# ── Lambda deployment package ─────────────────────────────────────────────────

data "archive_file" "lambda_zip" {
  type        = "zip"
  source_dir  = "${path.module}/../../../lambda/secrets-rotation/dist"
  output_path = "${path.module}/lambda-deployment.zip"
  depends_on  = []
}

# ── IAM Role for Lambda ───────────────────────────────────────────────────────

resource "aws_iam_role" "secrets_rotation_lambda" {
  name = "aura-vault-${var.environment}-secrets-rotation-lambda"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  tags = local.common_tags
}

resource "aws_iam_role_policy" "secrets_rotation_lambda" {
  name = "aura-vault-${var.environment}-secrets-rotation-policy"
  role = aws_iam_role.secrets_rotation_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      # Secrets Manager — rotation operations
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:DescribeSecret",
          "secretsmanager:GetSecretValue",
          "secretsmanager:PutSecretValue",
          "secretsmanager:UpdateSecretVersionStage",
        ]
        Resource = [
          var.db_secret_arn,
          var.jwt_secret_arn,
        ]
      },
      # Secrets Manager — list (needed by rotation framework)
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetRandomPassword"]
        Resource = "*"
      },
      # RDS — describe instances (for DB connection validation)
      {
        Effect   = "Allow"
        Action   = ["rds:DescribeDBInstances", "rds:DescribeDBClusters"]
        Resource = "*"
      },
      # CloudWatch Logs — write logs
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ]
        Resource = "arn:aws:logs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/aura-vault-${var.environment}-*:*"
      },
      # CloudWatch Metrics — publish rotation metrics
      {
        Effect   = "Allow"
        Action   = ["cloudwatch:PutMetricData"]
        Resource = "*"
        Condition = {
          StringEquals = {
            "cloudwatch:namespace" = "AuraVault/SecretsRotation"
          }
        }
      },
    ]
  })
}

# ── CloudWatch Log Groups ─────────────────────────────────────────────────────

resource "aws_cloudwatch_log_group" "db_rotation" {
  name              = "/aws/lambda/aura-vault-${var.environment}-db-rotation"
  retention_in_days = 30
  tags              = local.common_tags
}

resource "aws_cloudwatch_log_group" "jwt_rotation" {
  name              = "/aws/lambda/aura-vault-${var.environment}-jwt-rotation"
  retention_in_days = 30
  tags              = local.common_tags
}

# ── Lambda — DB Password Rotation ─────────────────────────────────────────────

resource "aws_lambda_function" "db_rotation" {
  function_name = "aura-vault-${var.environment}-db-rotation"
  description   = "Rotates the Aura Vault database password in Secrets Manager"
  role          = aws_iam_role.secrets_rotation_lambda.arn
  runtime       = "nodejs20.x"
  handler       = "db-rotation.handler"
  timeout       = 30
  memory_size   = 256

  filename         = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256

  environment {
    variables = {
      ENVIRONMENT            = var.environment
      GRACE_PERIOD_SECONDS   = "3600"
      DB_PORT                = "5432"
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.db_rotation,
    aws_iam_role_policy.secrets_rotation_lambda,
  ]

  tags = local.common_tags
}

# Allow Secrets Manager to invoke the DB rotation Lambda
resource "aws_lambda_permission" "db_rotation_secrets_manager" {
  statement_id  = "AllowSecretsManagerInvocation"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.db_rotation.function_name
  principal     = "secretsmanager.amazonaws.com"
  source_arn    = var.db_secret_arn
}

# ── Lambda — JWT Secret Rotation ──────────────────────────────────────────────

resource "aws_lambda_function" "jwt_rotation" {
  function_name = "aura-vault-${var.environment}-jwt-rotation"
  description   = "Rotates the Aura Vault JWT signing secret in Secrets Manager"
  role          = aws_iam_role.secrets_rotation_lambda.arn
  runtime       = "nodejs20.x"
  handler       = "jwt-rotation.handler"
  timeout       = 30
  memory_size   = 128

  filename         = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256

  environment {
    variables = {
      ENVIRONMENT          = var.environment
      GRACE_PERIOD_SECONDS = "3600"
      JWT_SECRET_BYTES     = "64"
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.jwt_rotation,
    aws_iam_role_policy.secrets_rotation_lambda,
  ]

  tags = local.common_tags
}

resource "aws_lambda_permission" "jwt_rotation_secrets_manager" {
  statement_id  = "AllowSecretsManagerInvocation"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.jwt_rotation.function_name
  principal     = "secretsmanager.amazonaws.com"
  source_arn    = var.jwt_secret_arn
}

# ── Secrets Manager Rotation — DB ─────────────────────────────────────────────

resource "aws_secretsmanager_secret_rotation" "db_rotation" {
  secret_id           = var.db_secret_arn
  rotation_lambda_arn = aws_lambda_function.db_rotation.arn

  rotation_rules {
    automatically_after_days = var.db_rotation_days
  }

  depends_on = [aws_lambda_permission.db_rotation_secrets_manager]
}

# ── Secrets Manager Rotation — JWT ────────────────────────────────────────────

resource "aws_secretsmanager_secret_rotation" "jwt_rotation" {
  secret_id           = var.jwt_secret_arn
  rotation_lambda_arn = aws_lambda_function.jwt_rotation.arn

  rotation_rules {
    automatically_after_days = var.jwt_rotation_days
  }

  depends_on = [aws_lambda_permission.jwt_rotation_secrets_manager]
}

# ── SNS Topic — rotation alerts ───────────────────────────────────────────────

resource "aws_sns_topic" "rotation_alerts" {
  name = "aura-vault-${var.environment}-rotation-alerts"
  tags = local.common_tags
}

resource "aws_sns_topic_subscription" "rotation_alerts_email" {
  count     = var.alert_email != "" ? 1 : 0
  topic_arn = aws_sns_topic.rotation_alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# ── CloudWatch Alarms — rotation failures ─────────────────────────────────────

resource "aws_cloudwatch_metric_alarm" "db_rotation_failure" {
  alarm_name          = "aura-vault-${var.environment}-db-rotation-failure"
  alarm_description   = "DB password rotation Lambda has failed"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 60
  statistic           = "Sum"
  threshold           = 1
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = aws_lambda_function.db_rotation.function_name
  }

  alarm_actions = [aws_sns_topic.rotation_alerts.arn]
  ok_actions    = [aws_sns_topic.rotation_alerts.arn]

  tags = local.common_tags
}

resource "aws_cloudwatch_metric_alarm" "jwt_rotation_failure" {
  alarm_name          = "aura-vault-${var.environment}-jwt-rotation-failure"
  alarm_description   = "JWT secret rotation Lambda has failed"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 60
  statistic           = "Sum"
  threshold           = 1
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = aws_lambda_function.jwt_rotation.function_name
  }

  alarm_actions = [aws_sns_topic.rotation_alerts.arn]
  ok_actions    = [aws_sns_topic.rotation_alerts.arn]

  tags = local.common_tags
}

# ── Locals ────────────────────────────────────────────────────────────────────

locals {
  common_tags = {
    Project     = "aura-vault-protocol"
    Environment = var.environment
    ManagedBy   = "terraform"
    Component   = "secrets-rotation"
  }
}
