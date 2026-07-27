# ---------------------------------------------------------------------------
# CloudFront Cache Policies
# Three distinct policies covering the three content categories:
#   1. static-assets  — JS, CSS, fonts, images → 1 year + immutable
#   2. html-pages     — HTML documents → 5 minutes + stale-while-revalidate
#   3. api-bypass     — /api/* → no caching, pass through to origin
# ---------------------------------------------------------------------------

resource "aws_cloudfront_cache_policy" "static_assets" {
  name        = "${var.project_name}-${var.environment}-static-assets"
  comment     = "Cache versioned static assets (JS, CSS, fonts, images) for 1 year. These files are content-addressed and never change at a given URL."
  default_ttl = 31536000 # 1 year in seconds
  max_ttl     = 31536000
  min_ttl     = 31536000

  parameters_in_cache_key_and_forwarded_to_origin {
    cookies_config {
      cookie_behavior = "none"
    }
    headers_config {
      header_behavior = "none"
    }
    query_strings_config {
      query_string_behavior = "none"
    }
    enable_accept_encoding_gzip   = true
    enable_accept_encoding_brotli = true
  }
}

resource "aws_cloudfront_response_headers_policy" "static_assets_headers" {
  name    = "${var.project_name}-${var.environment}-static-assets-headers"
  comment = "Adds Cache-Control: max-age=31536000, immutable to static asset responses."

  custom_headers_config {
    items {
      header   = "Cache-Control"
      value    = "public, max-age=31536000, immutable"
      override = true
    }
  }
}

resource "aws_cloudfront_cache_policy" "html_pages" {
  name        = "${var.project_name}-${var.environment}-html-pages"
  comment     = "Cache HTML pages for 5 minutes with stale-while-revalidate allowing background refresh."
  default_ttl = 300 # 5 minutes
  max_ttl     = 300
  min_ttl     = 0

  parameters_in_cache_key_and_forwarded_to_origin {
    cookies_config {
      cookie_behavior = "none"
    }
    headers_config {
      header_behavior = "none"
    }
    query_strings_config {
      query_string_behavior = "none"
    }
    enable_accept_encoding_gzip   = true
    enable_accept_encoding_brotli = true
  }
}

resource "aws_cloudfront_response_headers_policy" "html_pages_headers" {
  name    = "${var.project_name}-${var.environment}-html-pages-headers"
  comment = "Adds Cache-Control: max-age=300, stale-while-revalidate=60 to HTML responses."

  custom_headers_config {
    items {
      header   = "Cache-Control"
      value    = "public, max-age=300, stale-while-revalidate=60"
      override = true
    }
  }
}

# API bypass — zero TTL, all query strings and headers forwarded
resource "aws_cloudfront_cache_policy" "api_bypass" {
  name        = "${var.project_name}-${var.environment}-api-bypass"
  comment     = "Disables caching for /api/* routes. All requests pass through to the origin."
  default_ttl = 0
  max_ttl     = 0
  min_ttl     = 0

  parameters_in_cache_key_and_forwarded_to_origin {
    cookies_config {
      cookie_behavior = "all"
    }
    headers_config {
      header_behavior = "whitelist"
      headers {
        items = [
          "Authorization",
          "Origin",
          "Accept",
          "Content-Type",
        ]
      }
    }
    query_strings_config {
      query_string_behavior = "all"
    }
    enable_accept_encoding_gzip   = false
    enable_accept_encoding_brotli = false
  }
}

resource "aws_cloudfront_origin_request_policy" "api_forward_all" {
  name    = "${var.project_name}-${var.environment}-api-forward-all"
  comment = "Forwards all headers, cookies, and query strings to origin for API requests."

  cookies_config {
    cookie_behavior = "all"
  }

  headers_config {
    header_behavior = "allViewer"
  }

  query_strings_config {
    query_string_behavior = "all"
  }
}
