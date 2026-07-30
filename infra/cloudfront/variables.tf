variable "aws_region" {
  description = "AWS region to deploy CloudFront resources (ACM certificate must be in us-east-1 regardless)."
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Deployment environment (e.g. production, staging)."
  type        = string
  default     = "production"
}

variable "project_name" {
  description = "Short project name used in resource names and tags."
  type        = string
  default     = "aura-vault"
}

variable "origin_domain_name" {
  description = "Domain name of the origin (e.g. ALB or S3 static website endpoint serving the frontend)."
  type        = string
}

variable "origin_id" {
  description = "Unique identifier for the CloudFront origin."
  type        = string
  default     = "aura-vault-frontend-origin"
}

variable "acm_certificate_arn" {
  description = "ARN of the ACM certificate in us-east-1 for the CloudFront distribution. Must cover the aliases below."
  type        = string
}

variable "domain_aliases" {
  description = "List of custom domain aliases for the CloudFront distribution (e.g. [\"app.auravault.io\"])."
  type        = list(string)
  default     = []
}

variable "price_class" {
  description = "CloudFront price class. PriceClass_100 = US/EU, PriceClass_200 adds more regions, PriceClass_All = global."
  type        = string
  default     = "PriceClass_100"

  validation {
    condition     = contains(["PriceClass_100", "PriceClass_200", "PriceClass_All"], var.price_class)
    error_message = "price_class must be one of: PriceClass_100, PriceClass_200, PriceClass_All."
  }
}

variable "web_acl_id" {
  description = "Optional AWS WAF Web ACL ARN to associate with the distribution."
  type        = string
  default     = null
}

variable "tags" {
  description = "Additional tags to apply to all resources."
  type        = map(string)
  default     = {}
}
