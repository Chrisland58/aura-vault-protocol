terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = merge(
      {
        Project     = var.project_name
        Environment = var.environment
        ManagedBy   = "terraform"
      },
      var.tags
    )
  }
}

locals {
  # Static asset file extensions matched by path-pattern cache behaviors
  static_path_patterns = [
    "*.js",
    "*.css",
    "*.woff",
    "*.woff2",
    "*.ttf",
    "*.eot",
    "*.png",
    "*.jpg",
    "*.jpeg",
    "*.gif",
    "*.svg",
    "*.ico",
    "*.webp",
    "*.avif",
  ]
}

# ---------------------------------------------------------------------------
# CloudFront Distribution
# ---------------------------------------------------------------------------
resource "aws_cloudfront_distribution" "frontend" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "${var.project_name} ${var.environment} frontend CDN"
  price_class         = var.price_class
  aliases             = var.domain_aliases
  web_acl_id          = var.web_acl_id
  http_version        = "http2and3"
  wait_for_deployment = false

  # ----- Origin -----
  origin {
    domain_name = var.origin_domain_name
    origin_id   = var.origin_id

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }

    custom_header {
      name  = "X-CloudFront-Secret"
      value = random_password.origin_secret.result
    }
  }

  # ----- Default cache behavior (HTML pages / SWR) -----
  default_cache_behavior {
    target_origin_id       = var.origin_id
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id            = aws_cloudfront_cache_policy.html_pages.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.html_pages_headers.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.security_headers.arn
    }
  }

  # ----- Static assets — one ordered_cache_behavior per extension -----
  dynamic "ordered_cache_behavior" {
    for_each = local.static_path_patterns
    content {
      path_pattern           = ordered_cache_behavior.value
      target_origin_id       = var.origin_id
      viewer_protocol_policy = "redirect-to-https"
      allowed_methods        = ["GET", "HEAD"]
      cached_methods         = ["GET", "HEAD"]
      compress               = true

      cache_policy_id            = aws_cloudfront_cache_policy.static_assets.id
      response_headers_policy_id = aws_cloudfront_response_headers_policy.static_assets_headers.id
    }
  }

  # ----- Next.js _next/static assets -----
  ordered_cache_behavior {
    path_pattern           = "_next/static/*"
    target_origin_id       = var.origin_id
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id            = aws_cloudfront_cache_policy.static_assets.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.static_assets_headers.id
  }

  # ----- API routes — bypass cache, forward to origin -----
  ordered_cache_behavior {
    path_pattern           = "/api/*"
    target_origin_id       = var.origin_id
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods         = ["GET", "HEAD"]
    compress               = false

    cache_policy_id          = aws_cloudfront_cache_policy.api_bypass.id
    origin_request_policy_id = aws_cloudfront_origin_request_policy.api_forward_all.id
  }

  # ----- TLS -----
  viewer_certificate {
    acm_certificate_arn      = var.acm_certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  # ----- Geo restriction (none by default) -----
  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  # ----- Access logging (optional, enable by providing a log bucket) -----
  # Uncomment to enable access logging:
  # logging_config {
  #   include_cookies = false
  #   bucket          = "${aws_s3_bucket.cf_logs.bucket_domain_name}"
  #   prefix          = "${var.project_name}/${var.environment}/"
  # }

  tags = {
    Name = "${var.project_name}-${var.environment}-cf"
  }
}

# ---------------------------------------------------------------------------
# CloudFront Function — security headers injected at viewer-request
# ---------------------------------------------------------------------------
resource "aws_cloudfront_function" "security_headers" {
  name    = "${var.project_name}-${var.environment}-security-headers"
  runtime = "cloudfront-js-2.0"
  comment = "Injects security headers (HSTS, CSP, X-Frame-Options) on every response."
  publish = true

  code = <<-EOF
    function handler(event) {
      var response = event.response;
      var headers = response.headers;
      headers['strict-transport-security'] = { value: 'max-age=63072000; includeSubDomains; preload' };
      headers['x-content-type-options']    = { value: 'nosniff' };
      headers['x-frame-options']           = { value: 'DENY' };
      headers['x-xss-protection']          = { value: '1; mode=block' };
      headers['referrer-policy']           = { value: 'strict-origin-when-cross-origin' };
      return response;
    }
  EOF
}

# ---------------------------------------------------------------------------
# Random secret shared with origin to verify requests come from CloudFront
# ---------------------------------------------------------------------------
resource "random_password" "origin_secret" {
  length  = 32
  special = false
}

resource "aws_ssm_parameter" "origin_secret" {
  name        = "/${var.project_name}/${var.environment}/cloudfront/origin-secret"
  description = "Shared secret between CloudFront and the origin to reject direct-to-origin requests."
  type        = "SecureString"
  value       = random_password.origin_secret.result

  tags = {
    Name = "${var.project_name}-${var.environment}-cf-origin-secret"
  }
}
