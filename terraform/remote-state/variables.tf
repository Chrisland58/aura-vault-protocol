variable "aws_region" {
  description = "AWS region for the state bucket and lock table"
  type        = string
  default     = "us-east-1"
}

variable "project" {
  description = "Project name used as a prefix for all resource names"
  type        = string
  default     = "aura-vault"
}

variable "team" {
  description = "Team that owns this infrastructure"
  type        = string
  default     = "platform"
}

variable "cost_center" {
  description = "Cost center for billing allocation"
  type        = string
  default     = "infrastructure"
}

variable "github_org" {
  description = "GitHub organisation that hosts the repository"
  type        = string
  default     = "soterika"
}

variable "github_repo" {
  description = "GitHub repository name (without org prefix)"
  type        = string
  default     = "aura-vault-protocol"
}
