# ─────────────────────────────────────────────────────────────────────────────
# Issue #523: Multi-Region Failover — Primary: us-east-1 / DR: eu-west-1
# RTO target: < 30 minutes | RPO target: < 5 minutes
# ─────────────────────────────────────────────────────────────────────────────

# ── DR Region Provider ────────────────────────────────────────────────────

provider "aws" {
  alias  = "dr"
  region = var.dr_region

  default_tags {
    tags = {
      Project     = "aura-vault-protocol"
      Environment = var.environment
      ManagedBy   = "terraform"
      Role        = "disaster-recovery"
    }
  }
}

# ── RDS: Cross-Region Automated Backup Replication ────────────────────────

resource "aws_db_instance_automated_backups_replication" "to_dr" {
  source_db_instance_arn = aws_db_instance.main.arn
  retention_period       = 7

  provider = aws.dr
}

# ── RDS: Cross-Region Read Replica (DR) ──────────────────────────────────

resource "aws_db_instance" "dr_replica" {
  provider = aws.dr

  identifier = "${var.project_name}-db-dr-${var.environment}"

  # Cross-region replica: point at the primary instance ARN
  replicate_source_db = aws_db_instance.main.arn

  instance_class = var.db_instance_class
  storage_type   = "gp3"
  storage_encrypted = true

  # Replica-specific settings
  multi_az               = false
  publicly_accessible    = false
  auto_minor_version_upgrade = true

  backup_retention_period = 7
  backup_window           = "03:00-04:00"
  maintenance_window      = "Mon:04:00-Mon:05:00"

  performance_insights_enabled = true
  monitoring_interval          = 60
  monitoring_role_arn          = aws_iam_role.rds_monitoring_dr.arn

  deletion_protection = var.environment == "prod"
  skip_final_snapshot = var.environment != "prod"
  final_snapshot_identifier = var.environment == "prod" ? "${var.project_name}-db-dr-final-${var.environment}" : null

  db_subnet_group_name   = aws_db_subnet_group.dr.name
  vpc_security_group_ids = [aws_security_group.dr_rds.id]

  tags = {
    Name = "${var.project_name}-db-dr-${var.environment}"
    Role = "cross-region-read-replica"
  }

  depends_on = [
    aws_db_instance_automated_backups_replication.to_dr,
    aws_iam_role_policy_attachment.rds_monitoring_dr,
  ]
}

# ── IAM: RDS Enhanced Monitoring Role (DR region) ─────────────────────────

resource "aws_iam_role" "rds_monitoring_dr" {
  provider = aws.dr
  name     = "${var.project_name}-rds-monitoring-dr-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "monitoring.rds.amazonaws.com"
        }
      }
    ]
  })

  tags = {
    Name = "${var.project_name}-rds-monitoring-dr-${var.environment}"
  }
}

resource "aws_iam_role_policy_attachment" "rds_monitoring_dr" {
  provider   = aws.dr
  role       = aws_iam_role.rds_monitoring_dr.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}

# ── Route 53 Health Check: Primary ALB ───────────────────────────────────

resource "aws_route53_health_check" "primary_alb" {
  fqdn              = aws_lb.main.dns_name
  port              = 443
  type              = "HTTPS"
  resource_path     = "/api/health"
  failure_threshold = 3
  request_interval  = 30

  tags = {
    Name = "${var.project_name}-primary-alb-health-${var.environment}"
  }
}

# ── Route 53 Health Check: DR Endpoint ────────────────────────────────────

resource "aws_route53_health_check" "dr_endpoint" {
  count = var.dr_alb_dns_name != "" ? 1 : 0

  fqdn              = var.dr_alb_dns_name
  port              = 443
  type              = "HTTPS"
  resource_path     = "/api/health"
  failure_threshold = 3
  request_interval  = 30

  tags = {
    Name = "${var.project_name}-dr-endpoint-health-${var.environment}"
  }
}

# ── Route 53 Failover DNS Records ─────────────────────────────────────────

resource "aws_route53_record" "primary_failover" {
  count   = var.domain_name != "" ? 1 : 0
  zone_id = aws_route53_zone.main[0].id
  name    = "api.${var.domain_name}"
  type    = "CNAME"
  ttl     = 60
  records = [aws_lb.main.dns_name]

  set_identifier = "primary"

  failover_routing_policy {
    type = "PRIMARY"
  }

  health_check_id = aws_route53_health_check.primary_alb.id
}

resource "aws_route53_record" "secondary_failover" {
  count   = var.domain_name != "" && var.dr_alb_dns_name != "" ? 1 : 0
  zone_id = aws_route53_zone.main[0].id
  name    = "api.${var.domain_name}"
  type    = "CNAME"
  ttl     = 60
  records = [var.dr_alb_dns_name]

  set_identifier = "secondary"

  failover_routing_policy {
    type = "SECONDARY"
  }

  health_check_id = aws_route53_health_check.dr_endpoint[0].id
}

# ── SNS: Failover Alerts ──────────────────────────────────────────────────

resource "aws_sns_topic" "failover_alerts" {
  name = "${var.project_name}-failover-alerts-${var.environment}"

  tags = {
    Name = "${var.project_name}-failover-alerts-${var.environment}"
  }
}

resource "aws_sns_topic_subscription" "failover_email" {
  count     = var.alert_email != "" ? 1 : 0
  topic_arn = aws_sns_topic.failover_alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# ── CloudWatch: Replication Lag Alarm (DR region) ─────────────────────────

resource "aws_cloudwatch_metric_alarm" "rds_replica_lag" {
  provider = aws.dr

  alarm_name          = "${var.project_name}-replica-lag-${var.environment}"
  alarm_description   = "RDS replica lag exceeds RPO target of 5 minutes (300 seconds)"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "ReplicaLag"
  namespace           = "AWS/RDS"
  period              = 60
  statistic           = "Average"
  threshold           = 300 # 5 minutes — RPO target
  treat_missing_data  = "notBreaching"

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.dr_replica.identifier
  }

  # Cross-region SNS: publish to primary region topic
  alarm_actions = [aws_sns_topic.failover_alerts.arn]
  ok_actions    = [aws_sns_topic.failover_alerts.arn]

  tags = {
    Name = "${var.project_name}-replica-lag-${var.environment}"
  }
}

# ── CloudWatch: Primary ALB Healthy Host Count Alarm ─────────────────────

resource "aws_cloudwatch_metric_alarm" "primary_alb_health" {
  alarm_name          = "${var.project_name}-alb-healthy-hosts-${var.environment}"
  alarm_description   = "Primary ALB has no healthy targets — consider DR failover"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 2
  metric_name         = "HealthyHostCount"
  namespace           = "AWS/ApplicationELB"
  period              = 60
  statistic           = "Average"
  threshold           = 1
  treat_missing_data  = "breaching"

  dimensions = {
    LoadBalancer = aws_lb.main.arn_suffix
    TargetGroup  = aws_lb_target_group.backend.arn_suffix
  }

  alarm_actions = [aws_sns_topic.failover_alerts.arn]
  ok_actions    = [aws_sns_topic.failover_alerts.arn]

  tags = {
    Name = "${var.project_name}-alb-healthy-hosts-${var.environment}"
  }
}

# ── SSM Parameter: DR Configuration (for runbooks/automation) ─────────────

resource "aws_ssm_parameter" "dr_config" {
  name        = "/${var.project_name}/${var.environment}/dr/config"
  description = "Disaster recovery configuration for runbooks and automation"
  type        = "String"

  value = jsonencode({
    primary_region   = var.aws_region
    dr_region        = var.dr_region
    rto_minutes      = 30
    rpo_minutes      = 5
    primary_db_id    = aws_db_instance.main.identifier
    dr_replica_id    = aws_db_instance.dr_replica.identifier
    failover_dns     = var.domain_name != "" ? "api.${var.domain_name}" : ""
    last_updated     = timestamp()
  })

  lifecycle {
    ignore_changes = [value] # Prevent perpetual diff from timestamp()
  }

  tags = {
    Name = "${var.project_name}-dr-config-${var.environment}"
  }
}

# ── EventBridge: Quarterly DR Test Reminder ───────────────────────────────

resource "aws_cloudwatch_event_rule" "dr_test_reminder" {
  name                = "${var.project_name}-dr-test-reminder-${var.environment}"
  description         = "Quarterly reminder to execute the DR failover test drill"
  schedule_expression = var.failover_test_schedule

  tags = {
    Name = "${var.project_name}-dr-test-reminder-${var.environment}"
  }
}

resource "aws_cloudwatch_event_target" "dr_test_reminder_sns" {
  rule      = aws_cloudwatch_event_rule.dr_test_reminder.name
  target_id = "dr-test-reminder-sns"
  arn       = aws_sns_topic.failover_alerts.arn

  input = jsonencode({
    message = "ACTION REQUIRED: Quarterly DR failover test is due. Please execute the dr-failover-test workflow."
    wiki    = "See docs/disaster-recovery/runbook.md"
  })
}
