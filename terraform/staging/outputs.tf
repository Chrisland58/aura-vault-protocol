output "cluster_name" {
  description = "EKS cluster name"
  value       = module.eks.cluster_name
}

output "cluster_endpoint" {
  description = "EKS API server endpoint"
  value       = module.eks.cluster_endpoint
  sensitive   = true
}

output "db_endpoint" {
  description = "RDS PostgreSQL endpoint"
  value       = aws_db_instance.staging.endpoint
  sensitive   = true
}

output "redis_endpoint" {
  description = "ElastiCache Redis primary endpoint"
  value       = aws_elasticache_replication_group.staging.primary_endpoint_address
  sensitive   = true
}

output "staging_url" {
  description = "Staging environment URL"
  value       = "https://staging.auravault.io"
}

output "alb_dns_name" {
  description = "ALB DNS name"
  value       = aws_lb.staging.dns_name
}
