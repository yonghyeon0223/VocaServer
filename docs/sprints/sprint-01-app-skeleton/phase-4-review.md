# Sprint 01 — App Skeleton

## Phase 4: Review

### Test Results

**All tests pass. All quality gates pass.**

| Metric | Result |
|--------|--------|
| Test files | 13 passed / 13 total |
| Test cases | 105 passed / 105 total |
| Lint (ESLint) | 0 errors, 0 warnings |
| Type check (tsc --noEmit) | 0 errors |
| Duration | ~9 seconds |

#### Test Breakdown by File

| File | Tests | Category |
|------|-------|----------|
| `tests/unit/shared/errors.test.ts` | 25 | Unit — AppError hierarchy |
| `tests/unit/shared/pagination.test.ts` | 13 | Unit — Pagination utility |
| `tests/unit/shared/response.test.ts` | 9 | Unit — Response helpers |
| `tests/unit/middleware/request-id.test.ts` | 5 | Unit — Request ID middleware |
| `tests/integration/error-handling.test.ts` | 12 | Integration — Error handler |
| `tests/integration/not-found.test.ts` | 10 | Integration — 404 catch-all |
| `tests/integration/health.test.ts` | 9 | Integration — Health endpoint |
| `tests/integration/request-id.test.ts` | 6 | Integration — Request ID tracking |
| `tests/integration/rate-limiting.test.ts` | 4 | Integration — Rate limiter |
| `tests/integration/security-headers.test.ts` | 4 | Integration — Helmet headers |
| `tests/integration/cors.test.ts` | 3 | Integration — CORS enforcement |
| `tests/integration/body-parsing.test.ts` | 3 | Integration — Body size/parse |
| `tests/integration/content-type.test.ts` | 2 | Integration — JSON content type |

#### Notable Edge Cases and What They Caught

- **E8 (thrown string):** Exposed a bug in the error handler — `'type' in err` throws when `err` is not an object. Fixed by adding a `typeof` guard at the top of the handler.
- **E7 (plain Error, no leak):** Verifies that non-AppError exceptions never expose internal messages in production/test mode. When `NODE_ENV=development`, the original message is shown (intentional dev convenience), which is why the test requires `NODE_ENV=test`.
- **P4/P5 (limit clamping):** Caught a logic error where `limit=0` and `limit=-5` fell into the "not a valid number" branch (returning default 20) instead of the "too small" branch (clamping to 1). Fixed by separating "invalid" from "out of range".
- **R2 (remaining decreases):** Exposed that a max rate limit of 2 was too low for the full test suite — earlier tests consumed the budget before R2 ran. Fixed by bumping to 5.
- **H5 (DB disconnected):** Exercises the full degraded health path — disconnects the DB mid-test, verifies 503 response, then reconnects. Validates that the health endpoint handles infrastructure failures gracefully.

### Project Structure (Final State)

```
voca-server/
├── .env.example
├── .gitignore
├── CLAUDE.md
├── eslint.config.js
├── package.json
├── package-lock.json
├── tsconfig.json
├── vitest.config.ts
├── docs/
│   ├── api/
│   │   └── health.md
│   └── sprints/
│       └── sprint-01-app-skeleton/
│           ├── phase-1-planning.md
│           ├── phase-2-testing.md
│           ├── phase-3-implementation.md
│           └── phase-4-review.md
├── src/
│   ├── app.ts                              # Express app factory
│   ├── server.ts                           # Entry point, startup, shutdown
│   ├── config/
│   │   ├── env.ts                          # Zod-validated environment config
│   │   ├── database.ts                     # MongoDB connection management
│   │   └── db-indexes.ts                   # Index creation (empty, pattern established)
│   ├── shared/
│   │   ├── types.ts                        # Response envelope types, Express augmentation
│   │   ├── errors.ts                       # AppError class hierarchy
│   │   ├── response.ts                     # sendSuccess, sendPaginatedSuccess, sendError
│   │   ├── pagination.ts                   # Parse, clamp, build pagination
│   │   └── logger.ts                       # Pino logger setup
│   ├── middleware/
│   │   ├── request-id.middleware.ts         # Request ID generation/passthrough
│   │   ├── request-logger.middleware.ts     # pino-http request/response logging
│   │   ├── rate-limiter.middleware.ts       # express-rate-limit with custom 429 handler
│   │   ├── not-found.middleware.ts          # 404 catch-all
│   │   └── error-handler.middleware.ts      # Global error handler
│   └── modules/                            # Empty — feature modules added in future sprints
└── tests/
    ├── helpers/
    │   ├── setup.ts                        # Test DB lifecycle, app factory
    │   └── test-error-routes.ts            # Routes that throw specific errors
    ├── integration/
    │   ├── health.test.ts
    │   ├── not-found.test.ts
    │   ├── error-handling.test.ts
    │   ├── rate-limiting.test.ts
    │   ├── request-id.test.ts
    │   ├── security-headers.test.ts
    │   ├── cors.test.ts
    │   ├── body-parsing.test.ts
    │   └── content-type.test.ts
    └── unit/
        ├── shared/
        │   ├── errors.test.ts
        │   ├── response.test.ts
        │   └── pagination.test.ts
        └── middleware/
            └── request-id.test.ts
```

**Source files:** 15 (in `src/`)
**Test files:** 15 (in `tests/`, including 2 helpers)

### Deferred Work

| Item | Reason | Target Sprint |
|------|--------|---------------|
| JWT env vars (`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, etc.) | Not needed until auth is implemented | Sprint 02 (Auth) |
| Authentication middleware | No auth features in skeleton sprint | Sprint 02 (Auth) |
| Feature modules (auth, users, words) | Skeleton only — module structure is ready | Sprint 02+ |
| AI client wrappers | Deferred until first AI feature | Sprint TBD |
| Distributed rate limiting (Redis/MongoDB store) | In-memory store is fine for single-process | When multi-instance deployment is needed |
| CI/CD pipeline (GitHub Actions) | Focus was on local dev and test pipeline | Sprint 02 or standalone |
| Docker / containerization | Deployment concern, not needed for development | Pre-deployment sprint |
| Idempotency-Key support | Documented in CLAUDE.md, not needed until create endpoints exist | Sprint with first create endpoint |
| Admin/metrics endpoint for rate limit monitoring | Agreed to defer during planning | Future sprint |
| `npm audit` in CI | No CI pipeline yet | When CI is set up |

### Notes for Next Sprint

#### Sprint 02: Authentication

1. **Env vars to add:** `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN` in `src/config/env.ts`. The Zod schema is ready to extend.

2. **Dependencies to add:** `jsonwebtoken`, `bcrypt`, and their type packages. Not installed in Sprint 01 — install with exact pinned versions.

3. **New middleware needed:** Auth middleware that extracts JWT from `Authorization: Bearer <token>` header, verifies it, and attaches user info to `req`. Should follow the same pattern as `request-id.middleware.ts` — a single exported `RequestHandler`.

4. **Database indexes:** Sprint 02 will need indexes on the `users` collection (at minimum, a unique index on `email`). Add these to `src/config/db-indexes.ts`. Document all indexes — not just new ones.

5. **`createApp` route registration:** Currently, API routes would go in the `registerRoutes` callback or be registered directly in `createApp`. Sprint 02 should establish the pattern for how feature module routes are wired in — likely importing route files and mounting them: `app.use('/api/v1/auth', authRoutes)`.

6. **Error classes ready:** `UnauthorizedError` (401), `ForbiddenError` (403), `ConflictError` (409) are already implemented and tested. Auth endpoints can throw these immediately.

7. **Rate limiting:** Auth endpoints (login, register, refresh) need stricter per-route rate limits beyond the global limit. `express-rate-limit` supports per-route instances — create a stricter limiter for auth routes.

8. **Test helpers ready:** `setupTestDb()` and `teardownTestDb()` handle the test database lifecycle. Auth tests will need an additional helper for creating authenticated test requests (generate a valid JWT for a test user).

9. **DNS workaround:** `dns.setServers()` in `database.ts` is a workaround for SRV resolution on some networks. If Atlas connection issues reappear, check this first. Long-term, consider using the non-SRV connection string format or ensuring the deployment environment has proper DNS resolution.

10. **Request logger type casting:** The `pino-http` middleware uses type assertions (`req as IncomingMessage & { requestId: string }`) because pino-http types don't know about our Express augmentation. This is safe but ugly. If pino-http updates its types to support generics, revisit.
