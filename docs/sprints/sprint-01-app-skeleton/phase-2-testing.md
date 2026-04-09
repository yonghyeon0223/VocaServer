# Sprint 01 — App Skeleton

## Phase 2: Testing

### Test Strategy

We have two categories of tests in this sprint:

1. **Integration tests** — spin up the Express app (without a real DB for most tests, with a real DB for health check), make HTTP requests via Supertest, and assert on the full response (status, headers, body shape).
2. **Unit tests** — test shared utilities in isolation (error classes, response helpers, pagination).

**Test database:** Integration tests that need MongoDB will use a separate test database (`voca_test`). The test setup connects before tests run and drops the database after. This ensures tests are isolated and repeatable.

**App factory:** Tests use `createApp()` to get a fresh Express instance. This avoids state leakage between test files.

---

### Test Cases

#### Integration: Health Endpoint (`GET /health`)

##### Normal Cases

| # | Test | Expected |
|---|------|----------|
| H1 | `GET /health` with DB connected | 200, `success: true`, `data.status: "healthy"`, `data.database: "connected"`, `data.uptime` is a positive number |
| H2 | Response has correct envelope shape | `success`, `data`, `meta` keys present. `meta` has `requestId` and `timestamp`. |
| H3 | `meta.timestamp` is a valid ISO 8601 string | Parseable by `new Date()`, not `Invalid Date` |
| H4 | `meta.requestId` starts with `req_` | Matches pattern `req_` + UUID format |

##### Special Cases

| # | Test | Expected |
|---|------|----------|
| H5 | `GET /health` when DB is disconnected | 503, `success: true`, `data.status: "degraded"`, `data.database: "disconnected"` |
| H6 | `data.uptime` is a number (not string) | `typeof data.uptime === 'number'` |
| H7 | Response includes `X-Request-Id` header | Header present, matches `meta.requestId` in body |

##### Edge Cases

| # | Test | Expected |
|---|------|----------|
| H8 | `POST /health` (wrong method) | Should still reach health route or fall through to 404 — depends on implementation. Decision: health route only handles GET. POST /health → 404. |
| H9 | `GET /health?foo=bar` (with query params) | 200, query params ignored — health check works normally |

---

#### Integration: 404 Catch-All

##### Normal Cases

| # | Test | Expected |
|---|------|----------|
| N1 | `GET /nonexistent` | 404, `success: false`, `error.code: "RESOURCE_NOT_FOUND"` |
| N2 | `error.message` includes the method and path | Contains `"GET"` and `"/nonexistent"` |
| N3 | Response has correct error envelope shape | `success`, `error`, `meta` keys. `error` has `code` and `message`. |

##### Special Cases

| # | Test | Expected |
|---|------|----------|
| N4 | `POST /nonexistent` | 404, message includes `"POST"` |
| N5 | `PUT /nonexistent` | 404, message includes `"PUT"` |
| N6 | `DELETE /nonexistent` | 404, message includes `"DELETE"` |
| N7 | `GET /api/v1/nonexistent` (under API prefix) | 404, same error shape |

##### Edge Cases

| # | Test | Expected |
|---|------|----------|
| N8 | `GET /a/very/deep/nested/path` | 404, path included in message |
| N9 | `GET /path?with=query&params=true` | 404, responds correctly (query doesn't break anything) |
| N10 | `GET /path%20with%20spaces` (encoded special chars) | 404, no crash |

---

#### Integration: Error Handling Middleware

These tests require triggering errors from within route handlers. We'll register a test-only route that throws different error types.

##### Normal Cases

| # | Test | Expected |
|---|------|----------|
| E1 | Route throws `ValidationError` | 400, `error.code: "VALIDATION_ERROR"`, `error.details` array present |
| E2 | Route throws `UnauthorizedError` | 401, `error.code: "UNAUTHORIZED"` |
| E3 | Route throws `ForbiddenError` | 403, `error.code: "FORBIDDEN"` |
| E4 | Route throws `NotFoundError` | 404, `error.code: "RESOURCE_NOT_FOUND"` |
| E5 | Route throws `ConflictError` | 409, `error.code: "DUPLICATE_ENTRY"` |
| E6 | All error responses have correct envelope shape | `success: false`, `error` object, `meta` with `requestId` and `timestamp` |

##### Special Cases

| # | Test | Expected |
|---|------|----------|
| E7 | Route throws plain `Error` (non-AppError) | 500, `error.code: "INTERNAL_ERROR"`, generic message (no leak) |
| E8 | Route throws string (not even an Error) | 500, handled gracefully |
| E9 | Route throws `AppError` with custom details | `error.details` contains the custom array |
| E10 | Error response `Content-Type` is `application/json` | Header check |

##### Edge Cases

| # | Test | Expected |
|---|------|----------|
| E11 | Async route handler rejects (Promise rejection) | Error caught by Express 5, proper 500 response (not hanging request) |
| E12 | Route throws error with no message | 500, still produces valid response with fallback message |

---

#### Integration: Rate Limiting

##### Normal Cases

| # | Test | Expected |
|---|------|----------|
| R1 | Request within limit includes rate limit headers | `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` headers present |
| R2 | `RateLimit-Remaining` decreases with each request | Second request has lower remaining count |

##### Edge Cases

| # | Test | Expected |
|---|------|----------|
| R3 | Requests exceeding limit get 429 | `success: false`, `error.code: "RATE_LIMITED"`, correct envelope shape |
| R4 | `GET /health` is NOT rate-limited | Can hit health endpoint many times without 429, even after API rate limit is exhausted |

**Implementation note for R3/R4:** These tests will configure a very low rate limit (e.g., max 2 requests per window) to make it practical to test without sending hundreds of requests.

---

#### Integration: Request ID

##### Normal Cases

| # | Test | Expected |
|---|------|----------|
| I1 | Response has `X-Request-Id` header | Header present |
| I2 | `X-Request-Id` header matches `meta.requestId` in body | Same value in both places |
| I3 | Auto-generated ID format: `req_` + UUID | Matches regex `/^req_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/` |

##### Special Cases

| # | Test | Expected |
|---|------|----------|
| I4 | Client sends `X-Request-Id: custom-id-123` | Response uses `custom-id-123`, not a generated one |
| I5 | Each request gets a unique ID | Two requests produce different IDs |

##### Edge Cases

| # | Test | Expected |
|---|------|----------|
| I6 | Client sends empty `X-Request-Id` header | Server generates its own ID (doesn't use empty string) |

---

#### Integration: Security Headers (Helmet)

##### Normal Cases

| # | Test | Expected |
|---|------|----------|
| SH1 | Response includes `X-Content-Type-Options` header | Value is `nosniff` |
| SH2 | Response includes `X-Frame-Options` header | Header present (value depends on Helmet defaults) |
| SH3 | Response includes `Strict-Transport-Security` header | Header present on HTTPS-like requests |
| SH4 | Response does NOT include `X-Powered-By` header | Helmet removes it (prevents Express fingerprinting) |

---

#### Integration: CORS

##### Normal Cases

| # | Test | Expected |
|---|------|----------|
| C1 | Request with allowed `Origin` header gets `Access-Control-Allow-Origin` | Header matches the allowed origin |
| C2 | Preflight `OPTIONS` request returns CORS headers | `Access-Control-Allow-Methods`, `Access-Control-Allow-Headers` present, status 204 |

##### Edge Cases

| # | Test | Expected |
|---|------|----------|
| C3 | Request with disallowed `Origin` | No `Access-Control-Allow-Origin` header in response |

---

#### Integration: Body Parsing

##### Edge Cases

| # | Test | Expected |
|---|------|----------|
| B1 | POST with body >100kb | 413 (Payload Too Large), response is valid JSON error envelope with `error.code` |
| B2 | POST with malformed JSON body (e.g., `{invalid}`) | 400, valid JSON error envelope (not Express default HTML), `error.code: "VALIDATION_ERROR"` or `"BAD_REQUEST"` |
| B3 | POST with valid JSON body within limit | Request reaches handler normally |

---

#### Integration: Response Content Type

##### Normal Cases

| # | Test | Expected |
|---|------|----------|
| CT1 | Success response has `Content-Type: application/json` | Header check on `GET /health` |
| CT2 | Error response has `Content-Type: application/json` | Header check on 404 response |

---

#### Unit: AppError Hierarchy (`src/shared/errors.ts`)

| # | Test | Expected |
|---|------|----------|
| U1 | `AppError` is instance of `Error` | `instanceof Error` is true |
| U2 | `ValidationError` has statusCode 400, code `VALIDATION_ERROR` | Property checks |
| U3 | `UnauthorizedError` has statusCode 401, code `UNAUTHORIZED` | Property checks |
| U4 | `ForbiddenError` has statusCode 403, code `FORBIDDEN` | Property checks |
| U5 | `NotFoundError` has statusCode 404, code `RESOURCE_NOT_FOUND` | Property checks |
| U6 | `ConflictError` has statusCode 409, code `DUPLICATE_ENTRY` | Property checks |
| U7 | `RateLimitError` has statusCode 429, code `RATE_LIMITED` | Property checks |
| U8 | `InternalError` has statusCode 500, code `INTERNAL_ERROR` | Property checks |
| U9 | All AppError subclasses have `isOperational: true` | Operational errors are expected |
| U10 | `AppError` message is set correctly | `error.message === "my message"` |
| U11 | `ValidationError` accepts details array | `error.details` matches input |
| U12 | All subclasses are `instanceof AppError` | `instanceof` check |

---

#### Unit: Response Helpers (`src/shared/response.ts`)

These tests use mock `req` and `res` objects (no HTTP layer).

| # | Test | Expected |
|---|------|----------|
| S1 | `sendSuccess` produces correct envelope | `{ success: true, data: ..., meta: { requestId, timestamp } }` |
| S2 | `sendSuccess` defaults to status 200 | `res.status` called with 200 |
| S3 | `sendSuccess` accepts custom status code (201) | `res.status` called with 201 |
| S4 | `sendPaginatedSuccess` includes pagination in meta | `meta.pagination` has page, limit, total, totalPages |
| S5 | `sendError` produces correct error envelope | `{ success: false, error: { code, message }, meta: { requestId, timestamp } }` |
| S6 | `sendError` includes details when provided | `error.details` is present |
| S7 | `sendError` omits details when not provided | `error.details` is undefined |
| S8 | `meta.timestamp` is a valid ISO 8601 string | Parseable |
| S9 | `meta.requestId` comes from `req.requestId` | Matches the mock value |

---

#### Unit: Pagination Utility (`src/shared/pagination.ts`)

| # | Test | Expected |
|---|------|----------|
| P1 | Default values: no query params | `{ page: 1, limit: 20 }` |
| P2 | Custom page and limit | `{ page: 3, limit: 50 }` |
| P3 | `limit` clamped to max 100 | `parsePagination({ limit: '200' })` → `limit: 100` |
| P4 | `limit` clamped to min 1 | `parsePagination({ limit: '0' })` → `limit: 1` |
| P5 | Negative limit → default | `parsePagination({ limit: '-5' })` → `limit: 1` |
| P6 | Negative page → default | `parsePagination({ page: '-1' })` → `page: 1` |
| P7 | Non-numeric values → defaults | `parsePagination({ page: 'abc', limit: 'xyz' })` → `{ page: 1, limit: 20 }` |
| P8 | Float values are floored | `parsePagination({ page: '2.7' })` → `page: 2` |
| P9 | `buildPaginationMeta` calculates totalPages correctly | 142 items, limit 20 → totalPages 8 (ceiling) |
| P10 | `buildPaginationMeta` with 0 total items | `totalPages: 0` |
| P11 | `buildPaginationMeta` with exact multiple | 100 items, limit 20 → totalPages 5 |
| P12 | `calculateSkip` returns correct offset | page 3, limit 20 → skip 40 |
| P13 | `calculateSkip` page 1 → skip 0 | First page has no offset |

---

#### Unit: Request ID Middleware (`src/middleware/request-id.middleware.ts`)

| # | Test | Expected |
|---|------|----------|
| M1 | Generates `req_` + UUID when no header provided | `req.requestId` matches format |
| M2 | Uses client-provided `X-Request-Id` | `req.requestId === "client-id-123"` |
| M3 | Sets `X-Request-Id` response header | `res.setHeader` called with the ID |
| M4 | Empty `X-Request-Id` header → generates own ID | Doesn't use empty string |
| M5 | Calls `next()` | Middleware chain continues |

---

### Security Considerations

| Concern | How We Test |
|---------|-------------|
| No stack traces in error responses | E7: plain Error produces generic message, not internal details |
| Request body size limit | B1: POST with >100kb body → 413 with JSON envelope |
| Malformed request bodies | B2: Invalid JSON → 400 with JSON envelope (not Express default HTML) |
| Rate limiting works | R3: verify 429 after exceeding limit |
| Security headers present | SH1-SH4: Verify Helmet headers (nosniff, frame options, no X-Powered-By) |
| CORS enforcement | C1-C3: Allowed origins get CORS headers, disallowed origins don't |
| Response content type | CT1-CT2: All responses are application/json (prevents content sniffing) |

### Performance Considerations

| Concern | Approach |
|---------|----------|
| Health check speed | The health endpoint does a lightweight `db.admin().command({ ping: 1 })`, not a heavy query. No collections read. |
| Rate limiter overhead | In-memory store — O(1) lookup per request. No DB or Redis call. |
| Logging overhead | Pino is designed for minimal overhead. JSON serialization is fast. `pino-http` doesn't buffer — writes directly to stdout. |
| Test isolation | Each integration test file gets a fresh app instance via `createApp()`. No shared state between test files. |

---

### Test File Structure

```
tests/
  helpers/
    setup.ts              # DB connection for integration tests, app factory
    test-error-routes.ts  # Test-only routes that throw specific errors (for E1-E12)
  integration/
    health.test.ts         # H1-H9
    not-found.test.ts      # N1-N10
    error-handling.test.ts # E1-E12
    rate-limiting.test.ts  # R1-R4
    request-id.test.ts    # I1-I6
    security-headers.test.ts # SH1-SH4
    cors.test.ts           # C1-C3
    body-parsing.test.ts   # B1-B3
    content-type.test.ts   # CT1-CT2
  unit/
    shared/
      errors.test.ts      # U1-U12
      response.test.ts    # S1-S9
      pagination.test.ts  # P1-P13
    middleware/
      request-id.test.ts  # M1-M5
```

**Total: 82 test cases** across 13 test files.
