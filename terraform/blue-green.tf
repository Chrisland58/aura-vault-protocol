# terraform/blue-green.tf
# ─────────────────────────────────────────────────────────────────────────────
# ALB blue-green deployment resources
#
# Architecture
# ┌────────────────────────────────────────────────────────────┐
# │ ALB HTTPS listener                                         │
# │   └─ rule: /api/*  ─► weighted forward                    │
# │         ├─ blue target group   (weight = 100 or 0)         │
# │         └─ green target group  (weight = 0 or 100)         │
# │                                                            │
# │ ALB HTTP listener                                          │
# │   └─ preview rule: Host=preview.*  ─► inactive TG (ALT)   │
# └────────────────────────────────────────────────────────────┘
#
# The deploy script (scripts/blue-green-deploy.sh) drives traffic by updating
# the listener rule weights via the AWS CLI:
#   aws elbv2 modify-listener …
#
# On initial apply: 100% traffic → blue.
# ─────────────────────────────────────────────────────────────────────────────

# ── Variables ─────────────────────────────────────────────────────────────

variable "blue_green_preview_cidr" {
  description = "CIDR block allowed to reach the preview (standby-slot) listener rule. Restrict to VPN/CI CIDRs."
  type        = string
  default     = "10.0.0.0/8"
}

variable "blue_green_rollback_window_minutes" {
  description = "Minutes the old slot is kept warm after a traffic switch (instant rollback window)."
  type        = number
  default     = 30
}

variable "active_slot" {
  description = "Current active slot ('blue' or 'green'). Used only to initialise the listener rule weight; the deploy script owns this value at runtime."
  type        = string
  default     = "blue"

  validation {
    condition     = contains(["blue", "green"], var.active_slot)
    error_message = "active_slot must be 'blue' or 'green'."
  }
}

# ── Blue Target Group ──────────────────────────────────────────────────────

resource "aws_lb_target_group" "blue" {
  name        = "${var.project_name}-blue-${var.environment}"
  port        = 3001
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "instance"

  health_check {
    enabled             = true
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 15
    timeout             = 5
    path                = "/api/health"
    matcher             = "200"
    port                = "traffic-port"
    protocol            = "HTTP"
  }

  # Enable stickiness so in-flight requests are not bounced mid-flight during
  # the rollback window — clients that already hit blue stay on blue.
  stickiness {
    type            = "lb_cookie"
    cookie_duration = 1800   # 30 minutes — matches rollback window
    enabled         = true
  }

  deregistration_delay = 30  # seconds — give in-flight requests time to drain

  tags = merge(
    {
      Name            = "${var.project_name}-blue-${var.environment}"
      "blue-green/slot" = "blue"
      Environment     = var.environment
      ManagedBy       = "terraform"
    },
    try(module.tags.common, {})
  )

  lifecycle {
    create_before_destroy = true
  }
}

# ── Green Target Group ─────────────────────────────────────────────────────

resource "aws_lb_target_group" "green" {
  name        = "${var.project_name}-green-${var.environment}"
  port        = 3001
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "instance"

  health_check {
    enabled             = true
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 15
    timeout             = 5
    path                = "/api/health"
    matcher             = "200"
    port                = "traffic-port"
    protocol            = "HTTP"
  }

  stickiness {
    type            = "lb_cookie"
    cookie_duration = 1800
    enabled         = true
  }

  deregistration_delay = 30

  tags = merge(
    {
      Name            = "${var.project_name}-green-${var.environment}"
      "blue-green/slot" = "green"
      Environment     = var.environment
      ManagedBy       = "terraform"
    },
    try(module.tags.common, {})
  )

  lifecycle {
    create_before_destroy = true
  }
}

# ── Production listener rule — weighted forward ────────────────────────────
# Replaces the existing default forward on the HTTPS listener with a
# weighted rule, enabling instant atomic traffic switch via weight update.
#
# Terraform manages the *initial* weights only.
# The deploy script calls `aws elbv2 modify-listener-attributes` at runtime
# and Terraform will show drift next apply — that's expected and intentional.
# Re-running `terraform apply` resets weights to these initial values.

resource "aws_lb_listener_rule" "blue_green_production" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 10

  action {
    type = "forward"

    forward {
      target_group {
        arn    = aws_lb_target_group.blue.arn
        weight = var.active_slot == "blue" ? 100 : 0
      }

      target_group {
        arn    = aws_lb_target_group.green.arn
        weight = var.active_slot == "green" ? 100 : 0
      }

      # Keep stickiness in sync with the rollback window
      stickiness {
        enabled  = true
        duration = var.blue_green_rollback_window_minutes * 60
      }
    }
  }

  condition {
    path_pattern {
      values = ["/api/*"]
    }
  }

  tags = {
    Name        = "${var.project_name}-bg-prod-rule-${var.environment}"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

# ── Preview listener rule — always routes to standby slot ─────────────────
# Accessible only from internal CIDRs (CI runners, VPN).
# Smoke tests hit this endpoint before flipping production traffic.

resource "aws_lb_listener_rule" "blue_green_preview" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 5   # evaluated before production rule

  action {
    type = "forward"
    forward {
      target_group {
        # Routes to whichever slot is currently the STANDBY.
        # Initially: active=blue, standby=green → preview sends to green.
        arn    = aws_lb_target_group.green.arn
        weight = var.active_slot == "blue" ? 100 : 0
      }
      target_group {
        arn    = aws_lb_target_group.blue.arn
        weight = var.active_slot == "green" ? 100 : 0
      }
    }
  }

  condition {
    host_header {
      values = ["preview.${var.domain_name}"]
    }
  }

  # Allow only internal CIDRs via WAF or security-group; the host-header
  # condition alone is not sufficient for a public-facing ALB.
  tags = {
    Name        = "${var.project_name}-bg-preview-rule-${var.environment}"
    Environment = var.environment
    ManagedBy   = "terraform"
    Internal    = "true"
  }
}

# ── CloudWatch alarms for each slot ───────────────────────────────────────
# Separate alarms let on-call engineers see exactly which slot is unhealthy.

resource "aws_cloudwatch_metric_alarm" "blue_unhealthy_hosts" {
  alarm_name          = "${var.project_name}-blue-unhealthy-hosts-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "UnHealthyHostCount"
  namespace           = "AWS/ApplicationELB"
  period              = 60
  statistic           = "Maximum"
  threshold           = 0
  alarm_description   = "One or more BLUE-slot targets are unhealthy"
  treat_missing_data  = "notBreaching"

  dimensions = {
    TargetGroup  = aws_lb_target_group.blue.arn_suffix
    LoadBalancer = aws_lb.main.arn_suffix
  }

  alarm_actions = try([aws_sns_topic.waf_alerts.arn], [])
  ok_actions    = try([aws_sns_topic.waf_alerts.arn], [])

  tags = {
    Environment = var.environment
    Slot        = "blue"
  }
}

resource "aws_cloudwatch_metric_alarm" "green_unhealthy_hosts" {
  alarm_name          = "${var.project_name}-green-unhealthy-hosts-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "UnHealthyHostCount"
  namespace           = "AWS/ApplicationELB"
  period              = 60
  statistic           = "Maximum"
  threshold           = 0
  alarm_description   = "One or more GREEN-slot targets are unhealthy"
  treat_missing_data  = "notBreaching"

  dimensions = {
    TargetGroup  = aws_lb_target_group.green.arn_suffix
    LoadBalancer = aws_lb.main.arn_suffix
  }

  alarm_actions = try([aws_sns_topic.waf_alerts.arn], [])
  ok_actions    = try([aws_sns_topic.waf_alerts.arn], [])

  tags = {
    Environment = var.environment
    Slot        = "green"
  }
}

# ── Outputs ────────────────────────────────────────────────────────────────

output "blue_target_group_arn" {
  description = "ARN of the blue ALB target group"
  value       = aws_lb_target_group.blue.arn
}

output "green_target_group_arn" {
  description = "ARN of the green ALB target group"
  value       = aws_lb_target_group.green.arn
}

output "blue_green_listener_rule_arn" {
  description = "ARN of the production blue-green listener rule (used by deploy script)"
  value       = aws_lb_listener_rule.blue_green_production.arn
}

output "preview_listener_rule_arn" {
  description = "ARN of the preview listener rule (standby slot only)"
  value       = aws_lb_listener_rule.blue_green_preview.arn
}
