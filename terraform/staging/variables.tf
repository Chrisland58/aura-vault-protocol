variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "project" {
  description = "Project name prefix"
  type        = string
  default     = "aura-vault"
}

variable "team" {
  description = "Owning team"
  type        = string
  default     = "platform"
}

variable "cost_center" {
  description = "Cost center for billing"
  type        = string
  default     = "infrastructure"
}

variable "db_password" {
  description = "RDS admin password — store in AWS Secrets Manager, pass via TF_VAR_db_password"
  type        = string
  sensitive   = true
}
