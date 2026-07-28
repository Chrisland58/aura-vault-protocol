# ─────────────────────────────────────────────────────────────────────────────
# terraform/staging/main.tf
#
# Staging environment — mirrors production at 50% scale.
# Issue #510
#
# Key differences from production:
#   - Separate VPC (CIDR 10.1.0.0/16 vs 10.0.0.0/16)
#   - All instance sizes one step smaller
#   - RDS and ElastiCache single-AZ (no Multi-AZ)
#   - EKS node group: min 1 / max 3 (vs production min 2 / max 10)
#   - Staging URL: staging.auravault.io
#   - Deploys automatically on merge to main (no approval gate)
# ─────────────────────────────────────────────────────────────────────────────

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.50"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.30"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.13"
    }
  }

  backend "s3" {
    # Values injected via -backend-config in CI
    key            = "staging/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "aura-vault-terraform-locks"
    encrypt        = true
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = local.common_tags
  }
}

data "aws_caller_identity" "current" {}
data "aws_availability_zones" "available" { state = "available" }

# ── Common tags (Issue #509) ──────────────────────────────────────────────────
locals {
  environment = "staging"

  common_tags = {
    Environment = local.environment
    Project     = var.project
    Team        = var.team
    CostCenter  = var.cost_center
    ManagedBy   = "terraform"
  }
}

# ─────────────────────────────────────────────────────────────────────────────
# VPC
# ─────────────────────────────────────────────────────────────────────────────
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "5.8.1"

  name = "${var.project}-${local.environment}"
  cidr = "10.1.0.0/16"

  azs             = slice(data.aws_availability_zones.available.names, 0, 2)
  private_subnets = ["10.1.1.0/24", "10.1.2.0/24"]
  public_subnets  = ["10.1.101.0/24", "10.1.102.0/24"]

  enable_nat_gateway     = true
  single_nat_gateway     = true  # cost saving in staging
  enable_dns_hostnames   = true
  enable_dns_support     = true

  # Tags required by EKS for subnet auto-discovery
  public_subnet_tags = {
    "kubernetes.io/role/elb"                                        = "1"
    "kubernetes.io/cluster/${var.project}-${local.environment}"     = "shared"
  }
  private_subnet_tags = {
    "kubernetes.io/role/internal-elb"                               = "1"
    "kubernetes.io/cluster/${var.project}-${local.environment}"     = "shared"
  }
}

# ─────────────────────────────────────────────────────────────────────────────
# EKS Cluster
# ─────────────────────────────────────────────────────────────────────────────
module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "20.14.0"

  cluster_name    = "${var.project}-${local.environment}"
  cluster_version = "1.30"

  vpc_id                         = module.vpc.vpc_id
  subnet_ids                     = module.vpc.private_subnets
  cluster_endpoint_public_access = true

  eks_managed_node_groups = {
    default = {
      name           = "default"
      instance_types = ["t3.medium"]  # 50% of production t3.large
      min_size       = 1
      max_size       = 3
      desired_size   = 2

      labels = merge(local.common_tags, {
        role = "application"
      })
    }
  }

  # Cluster add-ons
  cluster_addons = {
    coredns = {
      most_recent = true
    }
    kube-proxy = {
      most_recent = true
    }
    vpc-cni = {
      most_recent = true
    }
    aws-ebs-csi-driver = {
      most_recent = true
    }
  }
}

# ─────────────────────────────────────────────────────────────────────────────
# RDS PostgreSQL (single-AZ in staging)
# ─────────────────────────────────────────────────────────────────────────────
resource "aws_db_subnet_group" "staging" {
  name       = "${var.project}-${local.environment}"
  subnet_ids = module.vpc.private_subnets
}

resource "aws_security_group" "rds" {
  name        = "${var.project}-${local.environment}-rds"
  description = "RDS PostgreSQL access for staging"
  vpc_id      = module.vpc.vpc_id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [module.eks.node_security_group_id]
    description     = "Allow EKS nodes to connect"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_db_instance" "staging" {
  identifier              = "${var.project}-${local.environment}"
  engine                  = "postgres"
  engine_version          = "16.3"
  instance_class          = "db.t3.micro"  # 50% of production db.t3.small
  allocated_storage       = 20
  max_allocated_storage   = 100
  storage_encrypted       = true
  storage_type            = "gp3"

  db_name  = "aura_staging"
  username = "aura_admin"
  password = var.db_password

  db_subnet_group_name   = aws_db_subnet_group.staging.name
  vpc_security_group_ids = [aws_security_group.rds.id]

  # Staging: single-AZ, shorter backup window
  multi_az               = false
  backup_retention_period = 3
  deletion_protection    = false  # allow teardown in staging
  skip_final_snapshot    = true

  # Seed with anonymised data via the seeding script
  # See: scripts/seed-staging-db.sh
}

# ─────────────────────────────────────────────────────────────────────────────
# ElastiCache Redis (single-node in staging)
# ─────────────────────────────────────────────────────────────────────────────
resource "aws_elasticache_subnet_group" "staging" {
  name       = "${var.project}-${local.environment}"
  subnet_ids = module.vpc.private_subnets
}

resource "aws_security_group" "redis" {
  name        = "${var.project}-${local.environment}-redis"
  description = "Redis access for staging"
  vpc_id      = module.vpc.vpc_id

  ingress {
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [module.eks.node_security_group_id]
    description     = "Allow EKS nodes to connect"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_elasticache_replication_group" "staging" {
  replication_group_id = "${var.project}-${local.environment}"
  description          = "Redis cache for ${var.project} staging"

  node_type            = "cache.t3.micro"  # 50% of production cache.t3.small
  num_cache_clusters   = 1                 # single node in staging
  port                 = 6379
  subnet_group_name    = aws_elasticache_subnet_group.staging.name
  security_group_ids   = [aws_security_group.redis.id]

  at_rest_encryption_enabled = true
  transit_encryption_enabled = true

  automatic_failover_enabled = false  # requires >1 node
}

# ─────────────────────────────────────────────────────────────────────────────
# Route53 — staging.auravault.io
# ─────────────────────────────────────────────────────────────────────────────
data "aws_route53_zone" "primary" {
  name         = "auravault.io"
  private_zone = false
}

resource "aws_route53_record" "staging" {
  zone_id = data.aws_route53_zone.primary.zone_id
  name    = "staging.auravault.io"
  type    = "CNAME"
  ttl     = 300
  records = [aws_lb.staging.dns_name]
}

# ─────────────────────────────────────────────────────────────────────────────
# ALB for staging ingress
# ─────────────────────────────────────────────────────────────────────────────
resource "aws_lb" "staging" {
  name               = "${var.project}-${local.environment}"
  internal           = false
  load_balancer_type = "application"
  subnets            = module.vpc.public_subnets

  enable_deletion_protection = false

  access_logs {
    bucket  = aws_s3_bucket.alb_logs.bucket
    prefix  = "staging"
    enabled = true
  }
}

resource "aws_s3_bucket" "alb_logs" {
  bucket        = "${var.project}-${local.environment}-alb-logs-${data.aws_caller_identity.current.account_id}"
  force_destroy = true
}

resource "aws_s3_bucket_lifecycle_configuration" "alb_logs" {
  bucket = aws_s3_bucket.alb_logs.id

  rule {
    id     = "expire-logs"
    status = "Enabled"

    expiration {
      days = 30
    }
  }
}
