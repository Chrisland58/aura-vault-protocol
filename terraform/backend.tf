# ─────────────────────────────────────────────────────────────────────────────
# terraform/backend.tf  –  Shared S3 remote backend configuration
#
# Copy this file into every Terraform module directory and update the `key`
# to be unique per module (e.g. "staging/terraform.tfstate").
#
# The bucket name and lock table are provisioned by terraform/remote-state/.
# Run `terraform init -backend-config=../backend.tfvars` after updating.
# ─────────────────────────────────────────────────────────────────────────────

terraform {
  backend "s3" {
    # ── Required: fill these in via -backend-config or environment variables ──
    bucket         = ""                          # set via TF_VAR or -backend-config
    key            = "REPLACE_WITH_MODULE_PATH/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "aura-vault-terraform-locks"
    encrypt        = true

    # ── Optional: role assumption for cross-account access ───────────────────
    # role_arn       = "arn:aws:iam::ACCOUNT_ID:role/aura-vault-terraform-ci"
  }
}
