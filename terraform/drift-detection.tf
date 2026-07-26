# ─────────────────────────────────────────────────────────────────────────────
# Issue #522: Infrastructure Drift Detection (Terraform)
#
# This file supplements the GitHub Actions workflow (.github/workflows/terraform-drift.yml)
# with AWS-native drift monitoring infrastructure.
# ─────────────────────────────────────────────────────────────────────────────

# ── SSM Parameter: Drift Notification Config ─────────────────────────────

resource "aws_ssm_parameter" "drift_notification_config" {
  name        = "/${var.project_name}/${var.environment}/drift-detection/config"
  description = "Configuration for infrastructure drift detection and notifications"
  type        = "String"

  value = jsonencode({
    slack_webhook_configured = "see-github-secrets:SLACK_WEBHOOK_URL"
    drift_check_schedule     = "daily-06:00-UTC"
    auto_remediation_enabled = true
    safe_drift_types         = ["tag_changes"]
    manual_review_required   = ["resource_creation", "resource_deletion", "attribute_change"]
  })

  tags = {
    Name = "${var.project_name}-drift-config-${var.environment}"
  }
}

# ── EventBridge: Daily Drift Detection Reminder ───────────────────────────
# Supplements the GitHub Actions cron — provides an AWS-native fallback alert
# if the GHA workflow fails to run.

resource "aws_cloudwatch_event_rule" "drift_detection_schedule" {
  name                = "${var.project_name}-drift-detection-${var.environment}"
  description         = "Daily drift detection schedule — triggers SNS if GitHub Actions workflow is unavailable"
  schedule_expression = "rate(1 day)"

  tags = {
    Name = "${var.project_name}-drift-detection-${var.environment}"
  }
}

# ── SNS Topic: Drift Alerts ───────────────────────────────────────────────

resource "aws_sns_topic" "drift_alerts" {
  name = "${var.project_name}-drift-alerts-${var.environment}"

  tags = {
    Name = "${var.project_name}-drift-alerts-${var.environment}"
  }
}

resource "aws_sns_topic_subscription" "drift_alerts_email" {
  count     = var.alert_email != "" ? 1 : 0
  topic_arn = aws_sns_topic.drift_alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

resource "aws_cloudwatch_event_target" "drift_detection_sns" {
  rule      = aws_cloudwatch_event_rule.drift_detection_schedule.name
  target_id = "drift-detection-reminder"
  arn       = aws_sns_topic.drift_alerts.arn

  input = jsonencode({
    message = "Daily infrastructure drift detection run. Check GitHub Actions: terraform-drift workflow."
    action  = "verify-github-actions-workflow-ran"
  })
}

resource "aws_cloudwatch_event_target" "drift_detection_permission" {
  rule      = aws_cloudwatch_event_rule.drift_detection_schedule.name
  target_id = "drift-detection-sns-policy"
  arn       = aws_sns_topic.drift_alerts.arn
}

# Allow EventBridge to publish to the SNS topic
resource "aws_sns_topic_policy" "drift_alerts" {
  arn = aws_sns_topic.drift_alerts.arn

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowEventBridgePublish"
        Effect = "Allow"
        Principal = {
          Service = "events.amazonaws.com"
        }
        Action   = "sns:Publish"
        Resource = aws_sns_topic.drift_alerts.arn
      }
    ]
  })
}

# ── CloudWatch Dashboard: Drift Monitoring ────────────────────────────────

resource "aws_cloudwatch_dashboard" "drift_monitoring" {
  dashboard_name = "${var.project_name}-drift-monitoring-${var.environment}"

  dashboard_body = jsonencode({
    widgets = [
      {
        type   = "text"
        x      = 0
        y      = 0
        width  = 24
        height = 2
        properties = {
          markdown = "## Infrastructure Drift Monitoring\nDrift is detected via daily `terraform plan` in GitHub Actions. This dashboard shows related AWS metrics."
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 2
        width  = 12
        height = 6
        properties = {
          title   = "Config Rule Compliance"
          metrics = [
            ["AWS/Config", "ComplianceByConfigRule"]
          ]
          period = 86400
          stat   = "Average"
          view   = "timeSeries"
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 2
        width  = 12
        height = 6
        properties = {
          title   = "CloudTrail API Events (Infrastructure Changes)"
          metrics = [
            ["AWS/CloudTrail", "TotalEvents"]
          ]
          period = 3600
          stat   = "Sum"
          view   = "timeSeries"
        }
      }
    ]
  })
}
