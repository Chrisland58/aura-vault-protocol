# OWASP Top 10 Audit Report — Aura Vault Protocol Backend

**Date:** 2026-07-25  
**Scope:** `backend/` Express API  
**Issue:** #526  

---

## A01 — Broken Access Control

**Status:** ✅ Implemented

All mutating and sensitive routes require the `authenticate` middleware, which
validates a signed JWT access token on every request.

| Route pattern | Auth enforced |
|---|---|
| `POST /api/auth/logout` | ✅ `authenticate` |
| `GET /api/auth/sessions` | ✅ `authenticate` |
| `POST /api/auth/revoke-all` | ✅ `authenticate` |
| `ALL /api/webhooks/*` | ✅ `authenticate` |
| `ALL /api/v1/user/portfolio` | ✅ `authenticate` |
| `ALL /api/v1/analytics/*` | ✅ `authenticate` (per-route) |
| `GET /api/health` | Public (intentional) |
| `POST /api/auth/login` | Public (intentional) |
| `POST /api/auth/refresh` | Public (intentional) |

**Files:** `backend/src/middleware/authMiddleware.ts`, `backend/src/index.ts`

---

## A02 — Cryptographic Failures

**Status:** ✅ Implemented

- TLS 1.2+ is enforced at the infrastructure level via CloudFront
  (`origin_ssl_protocols = ["TLSv1.2"]`) and ALB HTTPS listener.
- All secrets (JWT secret, database credentials, API keys) are stored in
  **AWS Secrets Manager** — never in source code or environment variables
  in production. See `backend/src/secrets.ts` and `terraform/secrets.tf`.
- Database connections use SSL in production (`rejectUnauthorized: true`
  in `backend/src/db.ts`).
- RDS storage encryption enabled (`storage_encrypted = true`).

**Files:** `terraform/cloudfront.tf`, `terraform/secrets.tf`, `backend/src/db.ts`

---

## A03 — Injection

**Status:** ✅ Implemented

- All SQL queries use **parameterised placeholders** (`$1, $2, …`) via `node-postgres`.
  No string interpolation in SQL.
- All API inputs validated with **Zod schemas** before reaching route handlers.
  Unknown fields are stripped automatically (Zod's `strip` mode default).
- Validation middleware returns structured 400 errors without exposing internals.

**Files:** `backend/src/validation.ts`, `backend/src/routes/analyticsRoutes.ts`,
`backend/src/scripts/backfill-events.ts`

---

## A04 — Insecure Design

**Status:** ✅ N/A / Addressed in architecture

- The vault contract uses Checks-Effects-Interactions (CEI) ordering.
- Flash loan guard prevents balance manipulation (see `aura-vault/src/lib.rs`).
- Rate limiting is applied globally and per-user.

---

## A05 — Security Misconfiguration

**Status:** ✅ Implemented

All HTTP security headers are set via **Helmet v8** (`applySecurityHeaders()`):

| Header | Value |
|---|---|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload` |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Content-Security-Policy` | Restrictive policy (no `unsafe-eval`, no `unsafe-inline` scripts) |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=()` |
| `X-Powered-By` | Removed |

CORS is configured with an explicit allowlist via `CORS_ORIGIN` env var.
Open wildcard `*` is rejected in production.

**Files:** `backend/src/middleware/securityMiddleware.ts`

---

## A06 — Vulnerable and Outdated Components

**Status:** ✅ Monitored

- `cargo audit` runs in CI (`sast-rust` job in `pipeline.yml`) to catch known CVEs.
- `cargo deny` checks licences and advisories.
- Trivy container scanning runs on every Docker build.
- CodeQL scans JavaScript/TypeScript code on every push.
- npm packages: all pinned to exact or patch-range versions.

**Files:** `.github/workflows/pipeline.yml`, `.github/workflows/security-scan.yml`

---

## A07 — Identification and Authentication Failures

**Status:** ✅ Implemented

- JWT signed with **HS256 explicitly** (algorithm confusion attack prevention).
- `issuer` (`aura-vault`) and `audience` (`aura-vault-client`) claims verified
  on every token validation.
- Access tokens expire in **15 minutes**; refresh tokens in 30 days.
- Refresh token rotation: old refresh token is deleted on use (prevents reuse).
- Revoked access tokens are **blacklisted in Redis** until their natural expiry.
- Session revocation (`revoke-all`) removes all refresh tokens for a user.
- Rate limiting on `/api/auth/login` and `/api/auth/refresh` endpoints.

**Files:** `backend/src/auth.ts`, `backend/src/middleware/authMiddleware.ts`

---

## A08 — Software and Data Integrity Failures

**Status:** ✅ Addressed

- Wasm artifacts are SHA-256 hashed and stored as immutable CI artifacts.
- Docker images are pushed to GHCR with digest-pinned references.
- `cargo deny` and `cargo audit` prevent supply-chain compromises.
- `package-lock.json` committed for reproducible npm installs.

---

## A09 — Security Logging and Monitoring Failures

**Status:** ✅ Implemented

- **Winston** structured JSON logger (`backend/src/logger.ts`) used throughout.
- Every HTTP request/response is logged with: method, path, status code,
  duration, IP, User-Agent, and **correlation ID**.
- Every request gets a unique `correlationId` (UUID v4), echoed in the
  `X-Correlation-ID` response header for end-to-end traceability.
- Incoming `X-Correlation-ID` headers are propagated (for inter-service calls).
- Errors logged at `error` level with stack traces; 4xx at `warn`.
- CloudWatch alarms configured for CDN error rate, replication lag, cache miss
  rate, and container health.

**Files:** `backend/src/logger.ts`, `terraform/cloudwatch.tf`

---

## A10 — Server-Side Request Forgery (SSRF)

**Status:** ✅ N/A / Mitigated

- The backend does not proxy arbitrary user-supplied URLs.
- External HTTP calls are made only to allowlisted endpoints:
  Horizon (Stellar), Cloudflare ETH RPC, SendGrid, Mailgun.
- URLs are constructed from environment variables (operator-controlled),
  not from user input.

---

## Summary

| # | Category | Status |
|---|---|---|
| A01 | Broken Access Control | ✅ Implemented |
| A02 | Cryptographic Failures | ✅ Implemented |
| A03 | Injection | ✅ Implemented |
| A04 | Insecure Design | ✅ Addressed |
| A05 | Security Misconfiguration | ✅ Implemented |
| A06 | Vulnerable Components | ✅ Monitored via CI |
| A07 | Auth Failures | ✅ Implemented |
| A08 | Software Integrity | ✅ Addressed |
| A09 | Logging Failures | ✅ Implemented |
| A10 | SSRF | ✅ N/A (no user-controlled URLs) |
