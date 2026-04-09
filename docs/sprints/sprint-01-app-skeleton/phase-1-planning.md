# Sprint 01 — App Skeleton

## Phase 1: Planning

### Objectives

Build the foundational infrastructure that every future sprint depends on. After this sprint, we have a running Express server that:

- Connects to MongoDB Atlas with proper connection pooling and graceful shutdown
- Validates all environment variables at startup (crash-fast on misconfiguration)
- Has a complete middleware chain: security headers, CORS, body parsing, request ID tracking, request logging, rate limiting, error handling
- Returns consistent JSON response envelopes for every request (success, error, 404)
- Has a health check endpoint for monitoring and deployment verification
- Has structured JSON logging with per-request context
- Has shared utilities (error classes, response helpers, pagination, async handler)
- Has a working test pipeline (Vitest + Supertest)
- Has ESLint + TypeScript strict mode enforced

No feature modules (auth, words, etc.) — just the chassis.

---

### API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | None | Health check — DB connection status, uptime, timestamp |
| ANY | `/*` (unmatched) | N/A | 404 catch-all with standard error envelope |

---

### Request/Response Examples

#### GET /health

**Success (200):**
```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "uptime": 3621,
    "database": "connected",
    "timestamp": "2026-04-09T12:00:00.000Z"
  },
  "meta": {
    "requestId": "req_a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "timestamp": "2026-04-09T12:00:00.000Z"
  }
}
```

**Database down (503):**
```json
{
  "success": true,
  "data": {
    "status": "degraded",
    "uptime": 3621,
    "database": "disconnected",
    "timestamp": "2026-04-09T12:00:00.000Z"
  },
  "meta": {
    "requestId": "req_a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "timestamp": "2026-04-09T12:00:00.000Z"
  }
}
```

Note: The health endpoint doesn't return an error envelope when the DB is down — it still succeeds at the HTTP level but reports degraded status. The 503 status code tells load balancers to route traffic elsewhere, while the body gives operators details. This is standard for health checks: the endpoint itself working but reporting unhealthy infrastructure is different from the endpoint failing.

#### ANY /nonexistent-route (404)

```json
{
  "success": false,
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "The requested resource was not found: GET /nonexistent-route"
  },
  "meta": {
    "requestId": "req_a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "timestamp": "2026-04-09T12:00:00.000Z"
  }
}
```

#### Validation Error (400) — Not triggered in this sprint, but the infrastructure is in place

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [
      { "field": "email", "message": "Invalid email format" },
      { "field": "password", "message": "Must be at least 8 characters" }
    ]
  },
  "meta": {
    "requestId": "req_a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "timestamp": "2026-04-09T12:00:00.000Z"
  }
}
```

#### Rate Limited (429)

```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests. Please try again later."
  },
  "meta": {
    "requestId": "req_a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "timestamp": "2026-04-09T12:00:00.000Z"
  }
}
```

#### Unexpected Server Error (500)

```json
{
  "success": false,
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "An unexpected error occurred"
  },
  "meta": {
    "requestId": "req_a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "timestamp": "2026-04-09T12:00:00.000Z"
  }
}
```

In production, `message` is generic — never leaks stack traces or internal details. In development, we can include the original error message for debugging convenience.

---

### Database Design

No application collections in this sprint. We connect to MongoDB and verify the connection works.

**Connection configuration:**
- Single `MongoClient` instance, created at startup, shared across the app
- Write concern: `w: "majority"` (explicit, not relying on defaults)
- Read preference: `primary` (default, appropriate for a single-region app)
- Connection pool: `maxPoolSize: 10` (appropriate for a small app; Atlas free tier allows 500 connections, but we'll use few)
- Server selection timeout: `5000ms` (fail fast if the cluster is unreachable)
- Socket timeout: `30000ms` (matches our non-AI request timeout)

**Index setup script** (`src/config/db-indexes.ts`):
- Established as a pattern in this sprint, but no indexes to create yet
- Exports an `ensureIndexes(db: Db)` function that future sprints will populate
- Called during server startup, after DB connection is established

---

### Design Decisions

#### 1. Express 5 over Express 4

**Decision:** Use Express 5.x.

**Why:** Express 5 automatically catches rejected promises from async route handlers and forwards them to error middleware. In Express 4, an unhandled promise rejection in a route handler would crash the process or hang the request. Express 5 eliminates the need for `express-async-errors` or manual try/catch wrappers — we get correct async error handling for free.

**Trade-off:** Express 5 has some breaking changes from Express 4 (removed `app.del()`, changed `req.query` behavior, path matching changes). Since we're building from scratch, there's no migration cost.

#### 2. TypeScript 6 over 5.8

**Decision:** Use TypeScript 6.x.

**Why:** New project with no legacy constraints. TypeScript 6 is the current stable release. We get the latest type inference improvements and stricter checks.

**Trade-off:** Some community tooling may lag behind. If we hit compatibility issues, we can pin to 5.8.x — but for a new project this is unlikely.

#### 3. Zod 4 over Zod 3

**Decision:** Use Zod 4.x.

**Why:** Zod 4 is the current stable release with better performance and improved APIs. Since we're writing all schemas from scratch, there's no migration cost.

**Trade-off:** Fewer Stack Overflow examples available compared to Zod 3. We'll refer to the official Zod 4 docs.

#### 4. Response envelope helpers as functions, not middleware

**Decision:** `sendSuccess()` and `sendError()` are plain functions that controllers call explicitly, not Express middleware that auto-wraps responses.

**Why:** Explicit is better than implicit. When a controller calls `sendSuccess(res, data, 201)`, the reader immediately sees what's happening. A middleware that intercepts `res.json()` and wraps it is clever but invisible — when something goes wrong with the response shape, you'd be debugging middleware interception order instead of looking at the controller.

**Alternative considered:** Extending `res` with `res.sendSuccess()` via middleware. Rejected because it's non-standard, makes TypeScript typing harder, and hides behavior.

#### 5. Request ID format: `req_` + UUID v4

**Decision:** Generate request IDs as `req_` + UUID v4 (e.g., `req_a1b2c3d4-e5f6-7890-abcd-ef1234567890`).

**Why:** The `req_` prefix makes request IDs immediately identifiable in logs — you can grep for them without ambiguity. UUID v4 ensures uniqueness without coordination. If the client sends an `X-Request-Id` header, we use that instead (enables end-to-end tracing from mobile client through server).

#### 6. Pino over Winston

**Decision:** Use Pino for structured logging.

**Why:** Pino is significantly faster than Winston (benchmarks show 5-10x throughput difference). It outputs structured JSON by default, which is what we want for production log aggregation. It has first-class support for child loggers (critical for per-request context). `pino-http` integrates directly with Express for automatic request/response logging.

**Trade-off:** Pino's output is JSON — not human-readable in development. We use `pino-pretty` as a dev transport to solve this.

#### 7. Rate limiter store: in-memory (for now)

**Decision:** Use `express-rate-limit`'s default in-memory store.

**Why:** We're a single-process server. In-memory rate limiting is accurate and fast. When we need to scale to multiple processes or instances, we'll switch to a Redis or MongoDB store. This is an explicit decision to defer distributed rate limiting until we need it.

**Trade-off:** Rate limits reset on server restart. In development, this is a feature (no stale counters). In production, we'll revisit when we deploy.

#### 8. AppError class hierarchy

**Decision:** Single `AppError` base class with `statusCode` and `code` properties. Specific error types are factory functions or subclasses.

```
AppError (base)
├── ValidationError (400, VALIDATION_ERROR)
├── UnauthorizedError (401, UNAUTHORIZED)
├── ForbiddenError (403, FORBIDDEN)
├── NotFoundError (404, RESOURCE_NOT_FOUND)
├── ConflictError (409, DUPLICATE_ENTRY)
├── RateLimitError (429, RATE_LIMITED)
└── InternalError (500, INTERNAL_ERROR)
```

**Why:** The error handler middleware needs to distinguish operational errors (subclasses of `AppError` — expected, send the error response) from programmer errors (random `TypeError` — unexpected, send generic 500, log the real error). The class hierarchy makes this a simple `instanceof` check.

#### 9. ESLint flat config with strict TypeScript rules

**Decision:** Use ESLint 10 flat config (`eslint.config.js`) with `@typescript-eslint` strict preset.

**Why:** ESLint 10 dropped legacy config. The strict preset catches real bugs (no explicit `any`, no unused vars, consistent type imports). We enforce consistent code style without a separate formatter — ESLint handles both linting and basic formatting concerns.

#### 10. Project structure: `src/` and `tests/` as siblings

**Decision:** Tests live in a top-level `tests/` directory, not colocated with source files.

**Why:** This is specified in the CLAUDE.md architecture. `tests/unit/` mirrors the `src/` structure (e.g., `tests/unit/shared/errors.test.ts` tests `src/shared/errors.ts`). `tests/integration/` contains API-level tests that hit the running app. `tests/fixtures/` and `tests/helpers/` are shared test utilities.

**Trade-off:** Colocated tests (e.g., `errors.test.ts` next to `errors.ts`) are slightly more convenient for navigation. But separated tests keep the `src/` tree clean and make it obvious what's deployed vs what's test-only.

---

### Implementation Plan

#### File-by-File Breakdown

Here's every file we'll create, in dependency order (files later in the list can depend on files earlier):

```
src/
  config/
    env.ts                  # Zod-validated environment config
    database.ts             # MongoDB connection management
    db-indexes.ts           # Index creation script (empty body, pattern established)
  shared/
    types.ts                # Shared TypeScript types (response envelopes, pagination)
    errors.ts               # AppError class hierarchy
    response.ts             # sendSuccess() and sendError() helpers
    pagination.ts           # Pagination utility (parse query params, build meta)
    logger.ts               # Pino logger setup
  middleware/
    request-id.middleware.ts    # Generate/extract request ID, attach to req
    request-logger.middleware.ts # Per-request child logger + request/response logging
    rate-limiter.middleware.ts  # Global rate limiter
    not-found.middleware.ts     # 404 catch-all (registered after all routes)
    error-handler.middleware.ts # Global error handler (registered last)
  app.ts                    # Express app assembly (middleware + routes)
  server.ts                 # Entry point: connect DB, start server, graceful shutdown
tests/
  helpers/
    setup.ts                # Test setup: create app instance, DB connection
    request.ts              # Supertest helper with typed response assertions
  integration/
    health.test.ts          # Health endpoint tests
    not-found.test.ts       # 404 catch-all tests
    error-handling.test.ts  # Error middleware tests
  unit/
    shared/
      errors.test.ts        # AppError hierarchy tests
      response.test.ts      # Response helper tests
      pagination.test.ts    # Pagination utility tests
    middleware/
      request-id.test.ts    # Request ID middleware tests
```

#### Detailed Function Signatures

##### `src/config/env.ts`

```typescript
// Zod schema validates all env vars at import time.
// If validation fails, the process crashes with a clear error message.
// The rest of the app imports `config` — never touches process.env directly.

import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']),
  PORT: z.coerce.number().int().positive().default(3000),
  
  // Database
  DB_URI: z.string().min(1),
  DB_NAME: z.string().min(1),
  
  // Rate limiting
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900000), // 15 min
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(100),
  
  // CORS
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  
  // Logging
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type EnvConfig = z.infer<typeof envSchema>;
export const config: EnvConfig;
```

JWT-related env vars (`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, etc.) are deferred to Sprint 02 (Auth). They'll be added to the env schema when we implement authentication.

##### `src/config/database.ts`

```typescript
import { MongoClient, Db } from 'mongodb';

let client: MongoClient | null = null;
let db: Db | null = null;

// Called once at startup. Stores the client and db instances.
// Throws if connection fails — server.ts catches this and exits.
export async function connectDatabase(uri: string, dbName: string): Promise<Db>;

// Returns the cached Db instance. Throws if called before connectDatabase().
export function getDb(): Db;

// Returns the cached MongoClient. Used for health checks (client.db().admin().ping())
// and graceful shutdown (client.close()).
export function getClient(): MongoClient;

// Called during graceful shutdown. Closes the connection pool.
export async function closeDatabase(): Promise<void>;
```

**Why module-level variables instead of a class?** Database connection is a true singleton — there's exactly one MongoClient per process. Module-level state models this naturally. A class adds ceremony (constructor, private fields, getInstance()) without benefit. The functions are the public API; the module scope is the private state.

##### `src/config/db-indexes.ts`

```typescript
import { Db } from 'mongodb';

// Called at startup after DB connection. Creates all required indexes.
// Each sprint adds its collection's indexes here.
// Uses createIndex with { background: true } to avoid blocking.
export async function ensureIndexes(db: Db): Promise<void>;
```

##### `src/shared/types.ts`

```typescript
// ---- Response Envelope Types ----

export interface SuccessResponse<T> {
  success: true;
  data: T;
  meta: ResponseMeta;
}

export interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: ValidationErrorDetail[];
  };
  meta: ResponseMeta;
}

export interface ResponseMeta {
  requestId: string;
  timestamp: string;
  pagination?: PaginationMeta;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ValidationErrorDetail {
  field: string;
  message: string;
}

// ---- Pagination Input ----

export interface PaginationParams {
  page: number;
  limit: number;
}

// ---- Express Augmentation ----
// Extends Express Request to include our custom properties.
// This tells TypeScript that req.requestId and req.log exist.

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      log: import('pino').Logger;
    }
  }
}
```

**Why `declare global` instead of a custom `TypedRequest` interface?** Because every middleware and controller receives an Express `Request`. If we used a custom type, we'd need to cast or wrap at every usage point. By augmenting the global Express namespace, TypeScript knows that `req.requestId` exists everywhere — middleware, controllers, error handlers — without any casting.

##### `src/shared/errors.ts`

```typescript
export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: ValidationErrorDetail[],
  );
  
  // True for operational errors (bad input, auth failures) that we expect.
  // False for programmer errors that shouldn't happen.
  public isOperational: boolean;
}

export class ValidationError extends AppError;     // 400, VALIDATION_ERROR
export class UnauthorizedError extends AppError;   // 401, UNAUTHORIZED
export class ForbiddenError extends AppError;      // 403, FORBIDDEN
export class NotFoundError extends AppError;       // 404, RESOURCE_NOT_FOUND
export class ConflictError extends AppError;       // 409, DUPLICATE_ENTRY
export class RateLimitError extends AppError;      // 429, RATE_LIMITED
export class InternalError extends AppError;       // 500, INTERNAL_ERROR
```

##### `src/shared/response.ts`

```typescript
import { Response } from 'express';
import { Request } from 'express';

// Sends a success response with the standard envelope.
// statusCode defaults to 200.
export function sendSuccess<T>(
  req: Request,
  res: Response,
  data: T,
  statusCode?: number,
): void;

// Sends a success response with pagination metadata.
export function sendPaginatedSuccess<T>(
  req: Request,
  res: Response,
  data: T[],
  pagination: PaginationMeta,
): void;

// Sends an error response. Used by the error handler middleware.
// Not typically called directly by controllers — they throw AppError subclasses.
export function sendError(
  req: Request,
  res: Response,
  statusCode: number,
  code: string,
  message: string,
  details?: ValidationErrorDetail[],
): void;
```

**Why pass `req` to response helpers?** Because the response envelope includes `meta.requestId`, which lives on `req.requestId`. The helper reads it from the request to build the meta object. This keeps the calling code clean: `sendSuccess(req, res, data)` instead of `sendSuccess(res, data, { requestId: req.requestId })`.

##### `src/shared/pagination.ts`

```typescript
import { PaginationParams, PaginationMeta } from './types';

// Parses page and limit from query params.
// Defaults: page=1, limit=20. Clamps limit to [1, 100].
// Invalid/missing values get defaults, never rejected.
export function parsePagination(query: Record<string, unknown>): PaginationParams;

// Builds the pagination meta object for response envelope.
export function buildPaginationMeta(
  page: number,
  limit: number,
  total: number,
): PaginationMeta;

// Calculates MongoDB skip value from page and limit.
export function calculateSkip(page: number, limit: number): number;
```

##### `src/shared/logger.ts`

```typescript
import pino from 'pino';

// Creates the root logger instance.
// In development: pino-pretty transport for readable output.
// In production/test: raw JSON to stdout.
// Log level from config.LOG_LEVEL.
export const logger: pino.Logger;
```

##### `src/middleware/request-id.middleware.ts`

```typescript
import { RequestHandler } from 'express';

// Generates a request ID (req_ + UUID v4) or uses X-Request-Id header.
// Attaches to req.requestId and sets X-Request-Id response header.
export const requestIdMiddleware: RequestHandler;
```

##### `src/middleware/request-logger.middleware.ts`

```typescript
import { RequestHandler } from 'express';

// Creates a pino child logger scoped with requestId.
// Attaches it to req.log for use in controllers and services.
// Logs request start (method, url) and response finish (status, duration).
export const requestLoggerMiddleware: RequestHandler;
```

**Why a custom middleware instead of pino-http?** `pino-http` does auto request/response logging, but its customization options are limited. We want to control exactly what gets logged (skip health check noise, add custom fields), and we need `req.log` to be a child logger with `requestId` context. A thin custom middleware gives us full control and is ~15 lines of code.

Actually — let me reconsider. `pino-http` does support custom props, serializers, and auto-logging with `req.log` child loggers. Let's use `pino-http` and configure it, rather than reinventing it. It handles edge cases we'd miss (response time measurement, stream errors).

**Revised decision:** Use `pino-http` configured with our custom options. The middleware file becomes a thin config wrapper around `pinoHttp()`.

##### `src/middleware/rate-limiter.middleware.ts`

```typescript
import { RequestHandler } from 'express';

// Global rate limiter using express-rate-limit.
// Window and max from config. In-memory store (single process).
// Returns 429 with standard error envelope when limit exceeded.
export const rateLimiterMiddleware: RequestHandler;
```

**Custom handler:** `express-rate-limit` sends a plain text response by default. We must override the handler to return our standard JSON error envelope with `RATE_LIMITED` error code.

##### `src/middleware/not-found.middleware.ts`

```typescript
import { RequestHandler } from 'express';

// Registered after all routes. Any request that reaches this middleware
// didn't match a route — return 404 with standard error envelope.
export const notFoundMiddleware: RequestHandler;
```

##### `src/middleware/error-handler.middleware.ts`

```typescript
import { ErrorRequestHandler } from 'express';

// Global error handler — the last middleware in the chain.
// Distinguishes AppError (operational, send structured response) from
// unknown errors (programmer error, send generic 500, log full error).
// In development, includes original error message in response.
// In production, sends generic message for non-operational errors.
export const errorHandlerMiddleware: ErrorRequestHandler;
```

##### `src/app.ts`

```typescript
import express from 'express';

// Creates and configures the Express app.
// Exported as a function so tests can create fresh instances.
export function createApp(): express.Application;
```

**Middleware registration order** (this order matters):

1. `helmet()` — Security headers. First, so every response gets them.
2. `cors()` — CORS headers. Before routes so preflight requests are handled.
3. `express.json({ limit: '100kb' })` — Body parsing. Before any route that reads `req.body`.
4. `requestIdMiddleware` — Generates/extracts request ID. Before logging so the ID is available.
5. `requestLoggerMiddleware` (`pino-http`) — Creates `req.log`, logs request/response. After request ID so it can include it.
6. **Health route** — `GET /health`. Before rate limiter so monitoring/load balancers are never throttled.
7. `rateLimiterMiddleware` — Rate limiting. After logging so rate-limited requests are logged. Before API routes so abusive traffic is rejected early.
8. **API Routes** — Future: `/api/v1/*` routes. All API routes are rate-limited.
9. `notFoundMiddleware` — After all routes. Anything that falls through is a 404.
10. `errorHandlerMiddleware` — Last. Catches all errors from routes and middleware above.

**Why this specific order?** Each middleware depends on what came before:
- Helmet and CORS are stateless and go first
- Body parsing must happen before routes read `req.body`
- Request ID must exist before logging reads it
- Logging must exist before rate limiting so blocked requests are logged
- Health check is before rate limiter — load balancers and monitoring tools hit `/health` frequently (every 5-30s) and must never be throttled
- Rate limiting must happen before API routes so abusive traffic is rejected early
- Not-found must come after routes (it's the fallback)
- Error handler must be last (it's the safety net)

##### `src/server.ts`

```typescript
// Entry point. Does three things:
// 1. Connects to MongoDB
// 2. Ensures indexes
// 3. Starts the Express server
// Also registers SIGTERM/SIGINT handlers for graceful shutdown.

async function startServer(): Promise<void>;

// Graceful shutdown:
// 1. Stop accepting new connections (server.close())
// 2. Wait for in-flight requests to finish (with 10s timeout)
// 3. Close MongoDB connection pool
// 4. Exit process
async function gracefulShutdown(signal: string): Promise<void>;
```

---

### Middleware Chain Diagram

```
Request
  │
  ▼
┌─────────────────────────┐
│ 1. Helmet                │  Security headers added to response
├─────────────────────────┤
│ 2. CORS                  │  CORS headers, preflight handled
├─────────────────────────┤
│ 3. express.json()        │  Body parsed (100kb limit)
├─────────────────────────┤
│ 4. Request ID            │  req.requestId set, X-Request-Id header set
├─────────────────────────┤
│ 5. Request Logger        │  req.log created (child logger with requestId)
│    (pino-http)           │  Auto-logs request start + response finish
├─────────────────────────┤
│ 6. Health Route          │  GET /health (not rate-limited)
├─────────────────────────┤
│ 7. Rate Limiter          │  → 429 RATE_LIMITED if over limit
├─────────────────────────┤
│ 8. API Routes            │  Future: /api/v1/* (rate-limited)
│                          │  → Matched route handles request
├─────────────────────────┤
│ 9. 404 Not Found         │  → 404 RESOURCE_NOT_FOUND if no route matched
├─────────────────────────┤
│ 10. Error Handler        │  Catches all errors from above
│                          │  → AppError: structured response
│                          │  → Unknown error: generic 500
└─────────────────────────┘
  │
  ▼
Response
```

---

### Configuration Files

#### `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2024",
    "module": "Node16",
    "moduleResolution": "Node16",
    "lib": ["ES2024"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": false
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

Key choices:
- `"target": "ES2024"` — Node 24 supports all ES2024 features natively
- `"module": "Node16"` — Enables ESM with proper Node.js module resolution
- `"strict": true` — Enables all strict checks (noImplicitAny, strictNullChecks, etc.)
- `"noUncheckedIndexedAccess": true` — Array/object indexing returns `T | undefined`, catching real bugs
- `"exactOptionalPropertyTypes": false` — This one's too aggressive for MongoDB query building where `undefined` and missing are semantically different

#### `vitest.config.ts`

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/server.ts'], // Entry point tested via integration
    },
    testTimeout: 10000,
    hookTimeout: 10000,
  },
});
```

#### `.env.example`

```
NODE_ENV=development
PORT=3000

# Database
DB_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net
DB_NAME=voca_dev

# JWT (added in Sprint 02)
# JWT_ACCESS_SECRET=
# JWT_REFRESH_SECRET=

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# CORS
CORS_ORIGINS=http://localhost:3000

# Logging
LOG_LEVEL=debug
```

#### `.gitignore`

```
node_modules/
dist/
.env
.env.local
.env.*.local
coverage/
*.log
.DS_Store
```

---

### Dependencies

**Production:**
| Package | Version | Purpose |
|---------|---------|---------|
| express | 5.2.1 | HTTP framework |
| mongodb | 7.1.1 | Database driver |
| zod | 4.3.6 | Schema validation |
| pino | 10.3.1 | Structured logging |
| pino-http | 11.0.0 | Express request/response logging |
| helmet | 8.1.0 | Security headers |
| cors | 2.8.6 | CORS middleware |
| express-rate-limit | 8.3.2 | Rate limiting |
| uuid | 11.0.0 | Request ID generation |

Note: `jsonwebtoken` and `bcrypt` are not installed in this sprint — they'll be added in Sprint 02 (Auth). We validate the env vars for JWT secrets now, but don't need the packages yet.

**Development:**
| Package | Version | Purpose |
|---------|---------|---------|
| typescript | 6.0.2 | Type checking and compilation |
| @types/express | 5.0.6 | Express type definitions |
| @types/cors | 2.8.19 | CORS type definitions |
| pino-pretty | 13.1.3 | Readable dev logging |
| vitest | 4.1.3 | Test framework |
| supertest | 7.2.2 | HTTP assertions |
| @types/supertest | 7.2.0 | Supertest type definitions |
| eslint | 10.2.0 | Linting |
| @typescript-eslint/eslint-plugin | 8.58.1 | TypeScript ESLint rules |
| @typescript-eslint/parser | 8.58.0 | TypeScript ESLint parser |
| tsx | 4.21.0 | Run TypeScript in dev (no compile step) |

---

### npm Scripts

```json
{
  "dev": "tsx watch src/server.ts",
  "build": "tsc",
  "start": "node dist/server.js",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:coverage": "vitest run --coverage",
  "lint": "eslint src/ tests/",
  "lint:fix": "eslint src/ tests/ --fix",
  "typecheck": "tsc --noEmit"
}
```

---

### What's Not In This Sprint

- **Authentication** (Sprint 02): JWT tokens, login, register, refresh, password hashing
- **Feature modules**: No auth/, users/, words/ modules
- **AI client wrappers**: Deferred until the sprint that introduces the first AI feature
- **MongoDB store for rate limiting**: Using in-memory. Revisit if/when we deploy multi-instance
- **Redis**: No Redis dependency. Evaluate if a use case emerges (session store, caching, pub/sub)
- **Docker / containerization**: Deferred until deployment planning
- **CI/CD pipeline**: GitHub Actions setup is deferred (mentioned in CLAUDE.md but not a sprint 01 deliverable)
- **Idempotency-Key support**: The pattern is documented in CLAUDE.md but explicitly scoped for later sprints
