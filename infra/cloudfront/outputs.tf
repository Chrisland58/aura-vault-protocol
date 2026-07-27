output "distribution_id" {
  description = "CloudFront distribution ID. Used by the invalidation script on every deploy."
  value       = aws_cloudfront_distribution.frontend.id
}

output "distribution_domain_name" {
  description = "CloudFront-assigned domain name (e.g. d1234abcd.cloudfront.net)."
  value       = aws_cloudfront_distribution.frontend.domain_name
}

output "distribution_arn" {
  description = "ARN of the CloudFront distribution."
  value       = aws_cloudfront_distribution.frontend.arn
}

output "distribution_hosted_zone_id" {
  description = "Route53 hosted zone ID for the CloudFront distribution. Use this when creating an ALIAS record in Route53."
  value       = aws_cloudfront_distribution.frontend.hosted_zone_id
}

output "static_assets_cache_policy_id" {
  description = "ID of the static-assets cache policy (1-year TTL + immutable)."
  value       = aws_cloudfront_cache_policy.static_assets.id
}

output "html_pages_cache_policy_id" {
  description = "ID of the html-pages cache policy (5-minute TTL + stale-while-revalidate)."
  value       = aws_cloudfront_cache_policy.html_pages.id
}

output "api_bypass_cache_policy_id" {
  description = "ID of the api-bypass cache policy (no caching)."
  value       = aws_cloudfront_cache_policy.api_bypass.id
}

output "origin_secret_ssm_path" {
  description = "SSM Parameter Store path where the CloudFront origin secret is stored."
  value       = aws_ssm_parameter.origin_secret.name
}
