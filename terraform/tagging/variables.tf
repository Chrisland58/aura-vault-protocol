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
  description = "Cost center for billing allocation"
  type        = string
  default     = "infrastructure"
}

variable "alert_emails" {
  description = "List of email addresses to receive untagged-resource alerts"
  type        = list(string)
  default     = []
}
