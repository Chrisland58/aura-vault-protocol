# CloudFront CDN — Aura Vault Protocol

Terraform configuration for a CloudFront distribution that serves the Aura Vault Protocol frontend with optimised per-content-type caching.

## Architecture

```
User → CloudFront (HTTPS, TLS 1.2+)
          │
          ├─ /api/*          → No cache  → Origin (ALB / backend)
          ├─ *.js *.css ...  → 1 year    → Origin (hashed filenames)
          ├─ _next/static/*  → 1 year    → Origin (Next.js build output)
          └─ default (HTML)  → 5 min SWR → Origin
```

## Cache Policies

| Policy | TTL | Response Header | Applies To |
|--------|-----|----------------|------------|
| `static-assets` | 1 year (31,536,000 s) | `Cache-Control: public, max-age=31536000, immutable` | `*.js`, `*.css`, `*.woff2`, `*.png`, `*.ico`, etc. + `_next/static/*` |
| `html-pages` | 5 min (300 s) | `Cache-Control: public, max-age=300, stale-while-revalidate=60` | Default (all HTML) |
| `api-bypass` | 0 s | — | `/api/*` |

Static assets are safe to cache for 1 year because Next.js appends a content hash to every filename (`_next/static/chunks/main-abc123.js`). The URL changes on every build, so cached files are always fresh.

`stale-while-revalidate=60` on HTML lets CloudFront serve a slightly stale page for up to 60 seconds while refreshing in the background — eliminating the latency spike at the 5-minute TTL boundary.

## Prerequisites

- Terraform ≥ 1.5
- AWS provider ~> 5.0
- An ACM certificate in **us-east-1** covering your domain aliases (CloudFront requires us-east-1 regardless of origin region)
- AWS credentials with permissions: `cloudfront:*`, `ssm:PutParameter`, `ssm:GetParameter`

## Deployment

```bash
cd infra/cloudfront

# Initialise Terraform
terraform init

# Review the plan
terraform plan \
  -var="origin_domain_name=alb.internal.example.com" \
  -var="acm_certificate_arn=arn:aws:acm:us-east-1:123456789012:certificate/..." \
  -var="domain_aliases=[\"app.auravault.io\"]"

# Apply
terraform apply \
  -var="origin_domain_name=alb.internal.example.com" \
  -var="acm_certificate_arn=arn:aws:acm:us-east-1:123456789012:certificate/..." \
  -var="domain_aliases=[\"app.auravault.io\"]"
```

After apply, note the `distribution_id` output — store it as a repository secret named `CLOUDFRONT_DISTRIBUTION_ID`.

## Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `origin_domain_name` | ✅ | — | Domain of the origin server |
| `acm_certificate_arn` | ✅ | — | ACM certificate ARN (us-east-1) |
| `domain_aliases` | — | `[]` | Custom domains (e.g. `app.auravault.io`) |
| `environment` | — | `production` | Used in resource names |
| `project_name` | — | `aura-vault` | Used in resource names |
| `price_class` | — | `PriceClass_100` | Coverage: 100=US+EU, 200=+Asia, All=global |
| `web_acl_id` | — | `null` | Optional WAF Web ACL ARN |

## Triggering Cache Invalidation on Deploy

The `invalidation.sh` script invalidates all paths (`/*`) after every deploy. It requires `cloudfront:CreateInvalidation` permission and the distribution ID.

### Manually

```bash
export DISTRIBUTION_ID=$(terraform output -raw distribution_id)
./infra/cloudfront/invalidation.sh
```

### In GitHub Actions

Add to your deploy job after the build+upload step:

```yaml
- name: Invalidate CloudFront cache
  run: bash infra/cloudfront/invalidation.sh
  env:
    DISTRIBUTION_ID: ${{ secrets.CLOUDFRONT_DISTRIBUTION_ID }}
    AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
    AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
    AWS_DEFAULT_REGION: us-east-1
```

## Cache Hit Ratio

After a warm-up period (first request to each edge location), expect >90% cache hit ratio for static asset traffic. You can monitor this in CloudFront metrics:

- CloudWatch metric: `CacheHitRate` on the distribution
- CloudFront console → Distribution → Reports & analytics → Cache statistics

## Security

- All HTTP traffic is redirected to HTTPS via `redirect-to-https` viewer protocol policy.
- Minimum TLS version: **TLSv1.2_2021** (disables TLS 1.0, 1.1, and older cipher suites).
- HSTS header (`max-age=63072000; includeSubDomains; preload`) injected by a CloudFront Function on every response.
- A random origin secret is shared between CloudFront and the origin (stored in SSM Parameter Store). Configure your origin to reject requests missing the `X-CloudFront-Secret` header to prevent direct-to-origin access.
