terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.50"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # ── Bootstrap note ────────────────────────────────────────────────────────
  # This module uses a LOCAL backend on first run.  After `terraform apply`
  # succeeds, run scripts/migrate-state.sh to push the state file into the
  # bucket it just created, then add the backend "s3" block below and run
  # `terraform init -migrate-state`.
  #
  # Uncomment after bootstrap:
  # backend "s3" {
  #   bucket         = "<bucket-name-from-output>"
  #   key            = "remote-state/terraform.tfstate"
  #   region         = "us-east-1"
  #   dynamodb_table = "aura-vault-terraform-locks"
  #   encrypt        = true
  # }
}
