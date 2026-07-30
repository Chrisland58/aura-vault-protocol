# ─────────────────────────────────────────────────────────────────────────────
# Issue #523: DR Region VPC Infrastructure (eu-west-1)
# ─────────────────────────────────────────────────────────────────────────────

# ── VPC ───────────────────────────────────────────────────────────────────

resource "aws_vpc" "dr" {
  provider             = aws.dr
  cidr_block           = var.dr_vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name = "${var.project_name}-vpc-dr-${var.environment}"
  }
}

# ── Public Subnets ────────────────────────────────────────────────────────

resource "aws_subnet" "dr_public" {
  provider          = aws.dr
  count             = 2
  vpc_id            = aws_vpc.dr.id
  cidr_block        = cidrsubnet(var.dr_vpc_cidr, 8, count.index)
  availability_zone = var.dr_availability_zones[count.index]

  map_public_ip_on_launch = true

  tags = {
    Name = "${var.project_name}-dr-public-${count.index + 1}-${var.environment}"
    Tier = "public"
  }
}

# ── Private Subnets ───────────────────────────────────────────────────────

resource "aws_subnet" "dr_private" {
  provider          = aws.dr
  count             = 2
  vpc_id            = aws_vpc.dr.id
  cidr_block        = cidrsubnet(var.dr_vpc_cidr, 8, count.index + 10)
  availability_zone = var.dr_availability_zones[count.index]

  tags = {
    Name = "${var.project_name}-dr-private-${count.index + 1}-${var.environment}"
    Tier = "private"
  }
}

# ── Internet Gateway ──────────────────────────────────────────────────────

resource "aws_internet_gateway" "dr" {
  provider = aws.dr
  vpc_id   = aws_vpc.dr.id

  tags = {
    Name = "${var.project_name}-igw-dr-${var.environment}"
  }
}

# ── Public Route Table ────────────────────────────────────────────────────

resource "aws_route_table" "dr_public" {
  provider = aws.dr
  vpc_id   = aws_vpc.dr.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.dr.id
  }

  tags = {
    Name = "${var.project_name}-dr-rt-public-${var.environment}"
  }
}

resource "aws_route_table_association" "dr_public" {
  provider       = aws.dr
  count          = 2
  subnet_id      = aws_subnet.dr_public[count.index].id
  route_table_id = aws_route_table.dr_public.id
}

# ── DB Subnet Group (DR) ──────────────────────────────────────────────────

resource "aws_db_subnet_group" "dr" {
  provider   = aws.dr
  name       = "${var.project_name}-db-subnet-group-dr-${var.environment}"
  subnet_ids = aws_subnet.dr_private[*].id

  tags = {
    Name = "${var.project_name}-db-subnet-group-dr-${var.environment}"
  }
}

# ── Security Group: DR RDS ────────────────────────────────────────────────

resource "aws_security_group" "dr_rds" {
  provider    = aws.dr
  name        = "${var.project_name}-sg-dr-rds-${var.environment}"
  description = "Security group for DR RDS read replica"
  vpc_id      = aws_vpc.dr.id

  ingress {
    description = "PostgreSQL from DR VPC"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = [var.dr_vpc_cidr]
  }

  egress {
    description = "All outbound traffic"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.project_name}-sg-dr-rds-${var.environment}"
  }
}
