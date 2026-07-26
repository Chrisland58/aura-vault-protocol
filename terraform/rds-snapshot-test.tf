# ─────────────────────────────────────────────────────────────────────────────
# Issue #521: Automated RDS Snapshot Testing & Restore Drills
# ─────────────────────────────────────────────────────────────────────────────

# ── SNS Topic: Snapshot Test Results ────────────────────────────────────

resource "aws_sns_topic" "snapshot_test_results" {
  name = "${var.project_name}-snapshot-test-results-${var.environment}"

  tags = {
    Name = "${var.project_name}-snapshot-test-results-${var.environment}"
  }
}

resource "aws_sns_topic_subscription" "snapshot_test_email" {
  count     = var.alert_email != "" ? 1 : 0
  topic_arn = aws_sns_topic.snapshot_test_results.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# ── IAM Role: Lambda Snapshot Test ──────────────────────────────────────

resource "aws_iam_role" "lambda_snapshot_test" {
  name = "${var.project_name}-lambda-snapshot-test-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })

  tags = {
    Name = "${var.project_name}-lambda-snapshot-test-${var.environment}"
  }
}

resource "aws_iam_role_policy" "lambda_snapshot_test" {
  name = "${var.project_name}-lambda-snapshot-test-policy-${var.environment}"
  role = aws_iam_role.lambda_snapshot_test.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "RDSSnapshotAccess"
        Effect = "Allow"
        Action = [
          "rds:DescribeDBInstances",
          "rds:DescribeDBSnapshots",
          "rds:RestoreDBInstanceFromDBSnapshot",
          "rds:DeleteDBInstance",
          "rds:DescribeDBSubnetGroups",
          "rds:AddTagsToResource",
          "rds:ListTagsForResource"
        ]
        Resource = "*"
      },
      {
        Sid    = "SNSPublish"
        Effect = "Allow"
        Action = ["sns:Publish"]
        Resource = [aws_sns_topic.snapshot_test_results.arn]
      },
      {
        Sid    = "SESEmail"
        Effect = "Allow"
        Action = [
          "ses:SendEmail",
          "ses:SendRawEmail"
        ]
        Resource = "*"
      },
      {
        Sid    = "EC2NetworkInfo"
        Effect = "Allow"
        Action = [
          "ec2:DescribeSecurityGroups",
          "ec2:DescribeSubnets",
          "ec2:DescribeVpcs"
        ]
        Resource = "*"
      },
      {
        Sid    = "CloudWatchLogs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:*:*:*"
      },
      {
        Sid    = "SSMParameters"
        Effect = "Allow"
        Action = [
          "ssm:GetParameter",
          "ssm:PutParameter"
        ]
        Resource = "arn:aws:ssm:${var.aws_region}:*:parameter/${var.project_name}/*"
      }
    ]
  })
}

# ── CloudWatch Log Group ──────────────────────────────────────────────────

resource "aws_cloudwatch_log_group" "lambda_snapshot_test" {
  name              = "/aws/lambda/${var.project_name}-rds-snapshot-test-${var.environment}"
  retention_in_days = 14

  tags = {
    Name = "${var.project_name}-lambda-snapshot-test-logs-${var.environment}"
  }
}

# ── Lambda: Snapshot Test Code (S3 Object) ────────────────────────────────

resource "aws_s3_object" "rds_snapshot_test_code" {
  bucket = aws_s3_bucket.lambda_code.id
  key    = "rds-snapshot-test.zip"
  source = "${path.module}/lambda/rds-snapshot-test.zip"

  lifecycle {
    ignore_changes = [etag]
  }
}

# ── Lambda Function: RDS Snapshot Test ───────────────────────────────────

resource "aws_lambda_function" "rds_snapshot_test" {
  function_name = "${var.project_name}-rds-snapshot-test-${var.environment}"
  role          = aws_iam_role.lambda_snapshot_test.arn
  handler       = "rds-snapshot-test.handler"
  runtime       = "python3.11"

  timeout     = 1800 # 30 minutes — matches RTO target
  memory_size = 256

  s3_bucket = aws_s3_bucket.lambda_code.id
  s3_key    = aws_s3_object.rds_snapshot_test_code.key

  environment {
    variables = {
      SOURCE_DB_IDENTIFIER  = aws_db_instance.main.identifier
      SNS_TOPIC_ARN         = aws_sns_topic.snapshot_test_results.arn
      PAGERDUTY_EVENTS_URL  = var.pagerduty_events_url
      OPERATIONS_EMAIL      = var.alert_email
      VALIDATION_TABLE      = var.rds_snapshot_test_validation_table
      DB_SUBNET_GROUP       = aws_db_subnet_group.main.name
      DB_SECURITY_GROUP_ID  = aws_security_group.rds.id
      AWS_ACCOUNT_REGION    = var.aws_region
    }
  }

  tags = {
    Name = "${var.project_name}-rds-snapshot-test-${var.environment}"
  }

  depends_on = [
    aws_cloudwatch_log_group.lambda_snapshot_test,
    aws_iam_role_policy.lambda_snapshot_test,
  ]
}

# ── EventBridge: Weekly Restore Drill (Sundays 02:00 UTC) ────────────────

resource "aws_cloudwatch_event_rule" "weekly_snapshot_test" {
  name                = "${var.project_name}-weekly-snapshot-test-${var.environment}"
  description         = "Weekly RDS snapshot restore drill — Sundays at 02:00 UTC"
  schedule_expression = "cron(0 2 ? * SUN *)"

  tags = {
    Name = "${var.project_name}-weekly-snapshot-test-${var.environment}"
  }
}

resource "aws_cloudwatch_event_target" "weekly_snapshot_test" {
  rule      = aws_cloudwatch_event_rule.weekly_snapshot_test.name
  target_id = "lambda-snapshot-test"
  arn       = aws_lambda_function.rds_snapshot_test.arn
}

resource "aws_lambda_permission" "allow_eventbridge_snapshot_test" {
  statement_id  = "AllowSnapshotTestFromEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.rds_snapshot_test.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.weekly_snapshot_test.arn
}

# ── CloudWatch Alarm: Lambda Failure Detection ────────────────────────────

resource "aws_cloudwatch_metric_alarm" "snapshot_test_failures" {
  alarm_name          = "${var.project_name}-snapshot-test-failures-${var.environment}"
  alarm_description   = "Alert when the RDS snapshot restore drill Lambda fails"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 86400 # 24 hours
  statistic           = "Sum"
  threshold           = 1
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = aws_lambda_function.rds_snapshot_test.function_name
  }

  alarm_actions = [aws_sns_topic.snapshot_test_results.arn]

  tags = {
    Name = "${var.project_name}-snapshot-test-failures-${var.environment}"
  }
}

# ── SSM Parameter: Last Restore Test Result ───────────────────────────────

resource "aws_ssm_parameter" "last_restore_test_result" {
  name        = "/${var.project_name}/${var.environment}/restore-test/last-result"
  description = "Result of the most recent RDS snapshot restore drill"
  type        = "String"
  value       = "pending-first-run"

  lifecycle {
    ignore_changes = [value] # Updated by Lambda at runtime
  }

  tags = {
    Name = "${var.project_name}-restore-test-result-${var.environment}"
  }
}
