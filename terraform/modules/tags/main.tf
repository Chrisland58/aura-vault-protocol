# ─────────────────────────────────────────────────────────────────────────────
# terraform/modules/tags/main.tf
#
# Shared tagging module.  All other Terraform modules call this to get a
# consistent tag map that satisfies the required-tags Config rule.
#
# Usage:
#   module "tags" {
#     source      = "../modules/tags"
#     environment = "staging"
#     project     = "aura-vault"
#     team        = "platform"
#     cost_center = "infrastructure"
#   }
#
#   resource "aws_s3_bucket" "example" {
#     tags = module.tags.tags
#   }
# ─────────────────────────────────────────────────────────────────────────────

variable "environment" {
  description = "Environment name: staging | production | global"
  type        = string
  validation {
    condition     = contains(["staging", "production", "global"], var.environment)
    error_message = "environment must be one of: staging, production, global"
  }
}

variable "project" {
  description = "Project name"
  type        = string
  default     = "aura-vault"
}

variable "team" {
  description = "Team that owns the resource"
  type        = string
  default     = "platform"
}

variable "cost_center" {
  description = "Cost center for billing allocation"
  type        = string
  default     = "infrastructure"
}

variable "extra_tags" {
  description = "Additional tags to merge on top of the required set"
  type        = map(string)
  default     = {}
}

locals {
  base_tags = {
    Environment = var.environment
    Project     = var.project
    Team        = var.team
    CostCenter  = var.cost_center
    ManagedBy   = "terraform"
  }
}

output "tags" {
  description = "Merged tag map including all required tags"
  value       = merge(local.base_tags, var.extra_tags)
}

output "environment" {
  description = "Resolved environment name"
  value       = var.environment
}
