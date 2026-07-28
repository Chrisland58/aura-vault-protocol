output "vpc_id" {
  description = "ID of the VPC"
  value       = aws_vpc.main.id
}

output "public_subnet_ids" {
  description = "IDs of public subnets"
  value       = aws_subnet.public[*].id
}

output "private_subnet_ids" {
  description = "IDs of private subnets"
  value       = aws_subnet.private[*].id
}

output "alb_dns_name" {
  description = "DNS name of the load balancer"
  value       = aws_lb.main.dns_name
}

output "alb_zone_id" {
  description = "Zone ID of the load balancer"
  value       = aws_lb.main.zone_id
}

output "cloudfront_distribution_id" {
  description = "ID of the CloudFront distribution"
  value       = var.enable_cloudfront ? aws_cloudfront_distribution.main[0].id : null
}

output "cloudfront_domain_name" {
  description = "Domain name of the CloudFront distribution"
  value       = var.enable_cloudfront ? aws_cloudfront_distribution.main[0].domain_name : null
}

output "rds_endpoint" {
  description = "RDS instance endpoint"
  value       = aws_db_instance.main.endpoint
  sensitive   = true
}

output "s3_bucket_name" {
  description = "Name of the S3 bucket for static assets"
  value       = aws_s3_bucket.static_assets.id
}

output "s3_backup_bucket_name" {
  description = "Name of the S3 bucket for backups"
  value       = aws_s3_bucket.backups.id
}

# DNS Outputs
output "route53_zone_id" {
  description = "ID of the Route53 hosted zone"
  value       = var.domain_name != "" ? aws_route53_zone.main[0].id : null
}

output "acm_certificate_arn" {
  description = "ARN of the ACM certificate"
  value       = var.domain_name != "" ? aws_acm_certificate.main[0].arn : null
}

output "dns_health_check_id" {
  description = "ID of the DNS health check"
  value       = var.domain_name != "" ? aws_route53_health_check.alb[0].id : null
}

output "ses_domain_identity" {
  description = "SES domain identity"
  value       = var.domain_name != "" && var.enable_email_forwarding ? aws_ses_domain_identity.main[0].arn : null
}

output "app_secret_arn" {
  description = "Application secrets ARN for this environment"
  value       = aws_secretsmanager_secret.app.arn
}

output "db_master_secret_arn" {
  description = "Database master credentials secret ARN"
  value       = aws_secretsmanager_secret.db_master.arn
  sensitive   = true
}

# ── Issue #520: WAF Outputs ───────────────────────────────────────────────

output "waf_web_acl_arn" {
  description = "ARN of the WAF Web ACL protecting the ALB"
  value       = aws_wafv2_web_acl.main.arn
}

output "waf_logs_bucket_name" {
  description = "S3 bucket name storing WAF access logs"
  value       = aws_s3_bucket.waf_logs.id
}

output "waf_alerts_topic_arn" {
  description = "SNS topic ARN for WAF blocked-request spike alerts"
  value       = aws_sns_topic.waf_alerts.arn
}

# ── Issue #521: RDS Snapshot Test Outputs ─────────────────────────────────

output "snapshot_test_lambda_arn" {
  description = "ARN of the RDS snapshot restore drill Lambda function"
  value       = aws_lambda_function.rds_snapshot_test.arn
}

output "snapshot_test_sns_topic_arn" {
  description = "SNS topic ARN for snapshot test results and alerts"
  value       = aws_sns_topic.snapshot_test_results.arn
}

# ── Issue #523: Multi-Region / DR Outputs ─────────────────────────────────

output "dr_replica_endpoint" {
  description = "Endpoint of the cross-region RDS read replica in the DR region"
  value       = aws_db_instance.dr_replica.endpoint
  sensitive   = true
}

output "failover_alerts_topic_arn" {
  description = "SNS topic ARN for multi-region failover alerts"
  value       = aws_sns_topic.failover_alerts.arn
}

output "primary_health_check_id" {
  description = "Route 53 health check ID monitoring the primary ALB"
  value       = aws_route53_health_check.primary_alb.id
}
