variable "aws_region" {
  description = "AWS region for deploying rotation infrastructure"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Deployment environment: staging or production"
  type        = string
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be 'staging' or 'production'"
  }
}

variable "db_secret_arn" {
  description = "ARN of the Secrets Manager secret holding the database credentials"
  type        = string
  validation {
    condition     = can(regex("^arn:aws:secretsmanager:", var.db_secret_arn))
    error_message = "db_secret_arn must be a valid Secrets Manager ARN"
  }
}

variable "jwt_secret_arn" {
  description = "ARN of the Secrets Manager secret holding the JWT signing secret"
  type        = string
  validation {
    condition     = can(regex("^arn:aws:secretsmanager:", var.jwt_secret_arn))
    error_message = "jwt_secret_arn must be a valid Secrets Manager ARN"
  }
}

variable "db_rotation_days" {
  description = "How often to rotate the database password (days)"
  type        = number
  default     = 30
  validation {
    condition     = var.db_rotation_days >= 1 && var.db_rotation_days <= 365
    error_message = "db_rotation_days must be between 1 and 365"
  }
}

variable "jwt_rotation_days" {
  description = "How often to rotate the JWT secret (days)"
  type        = number
  default     = 7
  validation {
    condition     = var.jwt_rotation_days >= 1 && var.jwt_rotation_days <= 365
    error_message = "jwt_rotation_days must be between 1 and 365"
  }
}

variable "alert_email" {
  description = "Email address to receive rotation failure alerts. Leave empty to skip email subscription."
  type        = string
  default     = ""
}
