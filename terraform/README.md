# Aura Vault Protocol - AWS Infrastructure

This Terraform configuration sets up a complete AWS infrastructure for the Aura Vault Protocol application.

## Infrastructure Components

- **VPC & Networking**: Multi-AZ VPC with public and private subnets, NAT Gateways, and VPC endpoints
- **Security Groups**: Least-privilege security groups for ALB, backend instances, and RDS
- **Load Balancing**: Application Load Balancer with SSL termination and health checks
- **Auto Scaling**: Auto-scaling group (2-10 instances) with CPU-based scaling policies
- **Database**: Multi-AZ RDS PostgreSQL with automated backups and monitoring
- **CDN**: CloudFront distribution for static assets with global edge locations
- **Monitoring**: CloudWatch dashboards, alarms, and cost budgets
- **Storage**: S3 buckets for static assets, backups, and logs

## Prerequisites

- AWS CLI configured with appropriate credentials
- Terraform >= 1.5.0
- SSH key pair for instance access
- Domain name (optional, for custom domain setup)

## Setup Instructions

### 1. Create S3 Backend (one-time setup)

```bash
aws s3api create-bucket --bucket aura-vault-terraform-state --region us-east-1
aws s3api put-bucket-versioning --bucket aura-vault-terraform-state --versioning-configuration Status=Enabled
aws s3api put-bucket-encryption --bucket aura-vault-terraform-state --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'

aws dynamodb create-table \
  --table-name aura-vault-terraform-locks \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region us-east-1
```

### 2. Configure Variables

Copy the example variables file and customize:

```bash
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your specific values
```

**Required variables to set:**
- `db_password` - Strong password for RDS database
- `ssh_public_key` - Your SSH public key for instance access
- `alert_email` - Email for monitoring alerts (optional)

### 3. Initialize Terraform

```bash
terraform init
```

### 4. Plan and Apply

```bash
terraform plan
terraform apply
```

## Architecture Overview

```
                    Internet
                       |
                 CloudFront CDN
                       |
                  Route53 (optional)
                       |
                 Application Load Balancer
                       |
              +--------+--------+
              |        |        |
         Auto Scaling Group (2-10 instances)
              |        |        |
         Private Subnets (3 AZs)
              |        |        |
              +----+---+----+---+
                   |        |
                RDS (Multi-AZ)
                   |
                S3 Backups
```

## Cost Optimization

The infrastructure includes several cost optimization features:

- **Auto-scaling**: Automatically scales instances based on demand (2-10 instances)
- **S3 Lifecycle Policies**: Moves old logs to cheaper storage classes
- **CloudFront Price Class**: Configured for US/Europe (can be adjusted)
- **VPC Endpoints**: Reduces NAT Gateway costs for S3 access
- **Budget Alerts**: Monthly budget monitoring with email notifications

## Monitoring

The infrastructure includes comprehensive monitoring:

- **CloudWatch Dashboard**: Visual monitoring of all infrastructure components
- **Alarms**: Alerts for high CPU, 5XX errors, and database issues
- **Logs**: Centralized logging for ALB, Lambda, and application logs
- **Performance Insights**: RDS performance monitoring

## Backup Strategy

- **RDS Automated Backups**: Daily backups with 7-day retention
- **Manual Snapshots**: Lambda function creates additional backups
- **S3 Backup Storage**: Long-term backup storage with lifecycle policies
- **Multi-AZ Deployment**: Automatic failover for high availability

## Security Features

- **Private Subnets**: Database and backend instances in private subnets
- **Security Groups**: Least-privilege access rules
- **Encryption**: RDS and S3 encryption at rest
- **SSL/TLS**: ALB enforces HTTPS for all traffic
- **VPC Endpoints**: Secure S3 access without internet gateway

## Deployment Workflow

1. Build and push Docker images to ECR
2. Update user-data.sh or use ECS instead of EC2
3. Run `terraform apply` to deploy infrastructure
4. Verify health checks at `http://<alb-dns>/api/health`
5. Configure CloudFront for static assets
6. Set up CI/CD pipeline for automated deployments

## Troubleshooting

### Instance Health Checks Failing
- Check security group rules allow port 3000 from ALB
- Verify user-data script is running correctly
- Check CloudWatch logs for instance errors

### Database Connection Issues
- Verify security group allows backend instances to connect
- Check RDS is in the same VPC as backend instances
- Review database credentials in environment variables

### CloudFront Distribution Issues
- Ensure S3 bucket policy allows CloudFront access
- Verify OAC (Origin Access Control) is configured correctly
- Check certificate validation if using custom domain

## Maintenance

### Scaling Adjustments
Modify `asg_min_size`, `asg_max_size`, and `asg_desired_capacity` in terraform.tfvars

### Database Sizing
Adjust `db_instance_class` and `db_allocated_storage` as needed

### Cost Reduction
- Reduce `asg_min_size` during low-traffic periods
- Use reserved instances for predictable workloads
- Adjust CloudFront price class based on user location

## Cleanup

To destroy all infrastructure:

```bash
terraform destroy
```

Note: This will not delete the S3 backend bucket or DynamoDB table used for Terraform state.

## Support

For issues or questions:
- Check CloudWatch logs and metrics
- Review Terraform state with `terraform show`
- Verify AWS service limits in your account
