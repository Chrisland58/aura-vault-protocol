output "config_rule_name" {
  description = "AWS Config rule name for required-tags compliance"
  value       = aws_config_config_rule.required_tags.name
}

output "alert_topic_arn" {
  description = "SNS topic ARN for untagged-resource alerts"
  value       = aws_sns_topic.untagged_alert.arn
}

output "config_logs_bucket" {
  description = "S3 bucket storing AWS Config delivery logs"
  value       = aws_s3_bucket.config_logs.bucket
}

output "required_tag_keys" {
  description = "The full list of required tag keys enforced by this module"
  value       = local.required_tag_keys
}
