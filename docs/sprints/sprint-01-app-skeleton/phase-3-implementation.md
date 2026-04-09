# Sprint 01 — App Skeleton

## Phase 3: Implementation

### Code Walkthrough

This section walks through every source file in the order data flows through the system — from startup to request to response. The goal is to explain not just what the code does, but why it's written this way.

---

#### 1. Environment Configuration (`src/config/env.ts`)

**What it does:** Validates all environment variables at import time using Zod. Exports a typed `config` object that the rest of the app uses.

**How it works:**

```typescript
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']),
  PORT: z.coerce.number().int().positive().default(3000),
  DB_URI: z.string().min(1),
  DB_NAME: z.string().min(1),
  // ...
});
```

`z.coerce.number()` is critical here. Environment variables are always strings (`process.env.PORT` is `"3000"`, not `3000`). `z.coerce` tells Zod to convert the string to a number before validating. Without it, every numeric env var would fail validation.

**Why `safeParse` + `process.exit(1)` instead of `.parse()` (which throws)?** Because `parse()` throws a ZodError, and if nothing catches it, Node.js prints an ugly unhandled exception. With `safeParse`, we control the error output — we print a human-readable summary of what's wrong and exit cleanly. This is the first thing a developer sees when their `.env` is misconfigured, so the error message matters.

**Why validate at import time (module top level)?** Because `env.ts` is imported by nearly every other module (database, middleware, logger). If we deferred validation to a function call, we'd need to ensure that function runs before anything else — and that's fragile. Module-level execution guarantees the validation runs the moment the module is first imported, which is during server startup.

**Deferred to Sprint 02:** JWT-related env vars (`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, etc.) will be added to the schema when authentication is implemented.

---

#### 2. Logger (`src/shared/logger.ts`)

**What it does:** Creates a single Pino logger instance used throughout the app.

**How it works:**

- In development: uses `pino-pretty` transport for colored, human-readable output
- In production/test: raw JSON to stdout (what log aggregation tools expect)
- Log level comes from `config.LOG_LEVEL`
- In tests, `LOG_LEVEL=silent` suppresses all log output to keep test output clean

**Why Pino over console.log?** Pino produces structured JSON logs. Each log entry is a JSON object with a timestamp, level, message, and any additional context fields. This is what production log aggregation tools (Datadog, CloudWatch, ELK stack) parse and index. `console.log` produces unstructured text that can't be reliably searched or filtered.

**Why a single root logger?** Pino supports child loggers — `logger.child({ requestId: 'req_123' })` creates a new logger that inherits the parent's configuration but adds `requestId` to every log entry. This is how we get per-request context without creating a new logger from scratch for each request.

---

#### 3. Database Connection (`src/config/database.ts`)

**What it does:** Manages the MongoDB connection lifecycle — connect, get reference, close.

**Key design decisions:**

**Module-level state (not a class):** The database connection is a true process-level singleton. Module scope naturally models this — `let client` and `let db` are private to the module, and the exported functions are the public API. A class would add ceremony (constructor, private fields, getInstance()) without benefit.

**DNS workaround:** Node.js's built-in DNS resolver can't handle SRV lookups on some networks. We set Google DNS (`8.8.8.8`, `8.8.4.4`) as resolvers at module load time. This ensures `mongodb+srv://` URIs resolve correctly everywhere. This was discovered during testing — the Atlas connection string uses SRV, and without this fix, `connectDatabase()` fails with `querySrv ECONNREFUSED`.

**Connection options explained:**
- `maxPoolSize: 10` — MongoDB driver maintains a pool of TCP connections. 10 is appropriate for a small app. Atlas free tier allows 500 connections, but each connection consumes memory on both client and server. Pool too small = requests queue waiting for a connection. Pool too large = wasted memory and server resources.
- `serverSelectionTimeoutMS: 5000` — If the driver can't find a suitable server (primary for writes) within 5 seconds, it throws. This prevents the app from hanging on startup if the cluster is unreachable. Default is 30 seconds, which is too long for a startup health check.
- `socketTimeoutMS: 30000` — Matches our non-AI request timeout. If a query hasn't completed in 30 seconds, something is wrong.
- `writeConcern: { w: 'majority' }` — Explicit, not relying on defaults. Ensures writes are acknowledged by a majority of replica set members before returning success. This prevents data loss if the primary crashes immediately after acknowledging a write. The CLAUDE.md architecture doc requires this explicitly.

**Ping after connect:** `await db.admin().command({ ping: 1 })` verifies the connection actually works. `client.connect()` succeeds as soon as the TCP handshake completes, but that doesn't mean authentication succeeded or the database exists. The ping is a lightweight round-trip that confirms everything is functional.

---

#### 4. Database Indexes (`src/config/db-indexes.ts`)

**What it does:** Placeholder for index creation. Called at startup after DB connection.

Sprint 01 has no collections, so the function body is empty. Future sprints will add `createIndex()` calls here. The pattern is established now so every sprint that adds a collection adds its indexes to this single, auditable location.

**Why a centralized index file?** Indexes scattered across individual model files are hard to audit. When debugging query performance, you want one place to see all indexes across all collections, check for redundancy, and understand how they interact.

---

#### 5. Shared Types (`src/shared/types.ts`)

**What it does:** Defines TypeScript interfaces for the response envelope, pagination, and Express augmentation.

**Express augmentation — why `declare global`?**

```typescript
declare global {
  namespace Express {
    interface Request {
      requestId: string;
      log: Logger;
    }
  }
}
```

Express's `Request` type doesn't know about our custom properties. Without this declaration, `req.requestId` would be a TypeScript error everywhere. We use `declare global` to merge our properties into Express's `Request` interface at the type level. This is the standard pattern for extending Express types — used by `passport`, `express-session`, and most Express middleware.

The alternative — creating a custom `TypedRequest` interface and using it everywhere — requires casting at every middleware boundary and breaks the natural Express typing chain.

---

#### 6. Error Classes (`src/shared/errors.ts`)

**What it does:** Defines the `AppError` hierarchy used throughout the app.

**The `Object.setPrototypeOf` line:**

```typescript
Object.setPrototypeOf(this, new.target.prototype);
```

This is necessary because of a JavaScript quirk with extending built-in classes (like `Error`). When TypeScript compiles `class AppError extends Error`, the generated code may not correctly set up the prototype chain, causing `instanceof` checks to fail. `Object.setPrototypeOf(this, new.target.prototype)` fixes this by explicitly setting the prototype to the correct subclass.

`new.target` (not `AppError`) is used because it refers to the class that was actually instantiated. If you create a `ValidationError`, `new.target` is `ValidationError`, not `AppError`. This ensures the entire subclass chain works: `new ValidationError() instanceof AppError` is true, `new ValidationError() instanceof ValidationError` is true, and `new ValidationError() instanceof Error` is also true.

**Why `isOperational = true` on every error?**

The error handler middleware uses this to distinguish operational errors (bad input, auth failures — expected, return structured response) from programmer errors (null reference, type error — unexpected, return generic 500, log for debugging). All `AppError` subclasses are operational by definition. A random `TypeError` thrown by a bug has no `isOperational` property, so the error handler falls through to the generic 500 branch.

---

#### 7. Response Helpers (`src/shared/response.ts`)

**What it does:** Three functions that build and send the standard JSON response envelope.

**Why `...(details ? { details } : {})` instead of just `details`?**

```typescript
error: {
  code,
  message,
  ...(details ? { details } : {}),
}
```

If we wrote `details` directly, the JSON output would include `"details": undefined` when no details are provided — some JSON serializers omit `undefined`, but it's not guaranteed, and it's semantically wrong. The spread pattern ensures the `details` key is completely absent when not provided, which is cleaner for clients parsing the response.

**Why pass `req` to every helper?** The response envelope includes `meta.requestId`, which lives on `req.requestId`. Passing the entire request object keeps the calling code clean (`sendSuccess(req, res, data)`) and avoids the caller needing to know which request fields the helper needs.

---

#### 8. Pagination Utility (`src/shared/pagination.ts`)

**What it does:** Parses, validates, and clamps pagination parameters.

**Key behavior — clamping vs defaulting:**

```typescript
if (!Number.isFinite(limit)) {
  limit = DEFAULT_LIMIT;        // NaN, Infinity, non-numeric → default (20)
} else if (limit < MIN_LIMIT) {
  limit = MIN_LIMIT;            // 0, -5 → clamp to 1
} else if (limit > MAX_LIMIT) {
  limit = MAX_LIMIT;            // 200 → clamp to 100
}
```

The distinction matters: if a client sends `limit=abc` (non-numeric), they probably didn't intend a specific value, so we use the default (20). But if they send `limit=0` or `limit=-5`, they sent a number — it's just out of range, so we clamp to the nearest valid value (1). This is more forgiving than rejecting invalid values outright, which aligns with the CLAUDE.md principle: "Invalid values are clamped, not rejected."

**Why `Math.floor` before validation?** To handle float values like `page=2.7`. We silently round down to `page=2`. This is more user-friendly than rejecting or returning fractional pages.

---

#### 9. Middleware Chain

The middleware chain is the backbone of the request lifecycle. Each middleware runs in registration order, and the order matters.

##### 9a. Request ID (`src/middleware/request-id.middleware.ts`)

Generates `req_` + UUID v4 for each request, or uses the client-provided `X-Request-Id` header. Sets the ID on `req.requestId` and the `X-Request-Id` response header.

**Why accept client-provided IDs?** Enables end-to-end tracing. A mobile app can generate an ID before sending a request, then use that same ID to correlate the request with server logs. This is how distributed tracing works — the ID travels with the request across service boundaries.

**Why reject empty strings?** `req.get('X-Request-Id')` returns `''` for an empty header. Using an empty string as the request ID would break log correlation and look like a bug. We check `clientId && clientId.length > 0`.

##### 9b. Request Logger (`src/middleware/request-logger.middleware.ts`)

Wraps `pino-http` with our configuration. Creates a child logger on `req.log` scoped with the request ID.

**Configuration details:**
- `genReqId`: Returns the already-generated `req.requestId` instead of creating a new one. This ensures pino-http's internal request ID matches ours.
- `customProps`: Adds `requestId` to every log entry from this request's child logger.
- `autoLogging.ignore`: Skips automatic request/response logging for `GET /health`. Health checks happen every 5-30 seconds from load balancers — logging each one creates noise without value.

**Type casting:** `pino-http` types expect `IncomingMessage`, but our augmented Express `Request` has `requestId`. We cast with `req as IncomingMessage & { requestId: string }` to bridge the type gap. This is safe because by the time this middleware runs, `requestIdMiddleware` has already set `req.requestId`.

##### 9c. Rate Limiter (`src/middleware/rate-limiter.middleware.ts`)

Uses `express-rate-limit` with in-memory store. Configured from env vars.

**`standardHeaders: 'draft-7'`:** Uses the IETF draft-7 rate limit header format — a single `RateLimit` header with `limit=N, remaining=N, reset=N` fields, plus a `RateLimit-Policy` header. This is the newer standard (draft-6 used separate headers).

**Custom handler:** `express-rate-limit` sends a plain text response by default when the limit is exceeded. We override with our standard JSON error envelope using `sendError()`, ensuring clients always get the same response shape regardless of the error type.

**Registered after the health route:** The health endpoint is registered at step 6, before the rate limiter at step 7. This means health checks are never rate-limited — load balancers can hit `/health` as frequently as they need without being blocked.

##### 9d. Not Found (`src/middleware/not-found.middleware.ts`)

A simple middleware registered after all routes. Any request that reaches this point didn't match any route — it's a 404. The response includes the HTTP method and path in the message for debugging.

##### 9e. Error Handler (`src/middleware/error-handler.middleware.ts`)

The safety net at the bottom of the middleware chain. Express error-handling middleware has four parameters `(err, req, res, next)` — the four-parameter signature is how Express identifies it as an error handler.

**The error classification flow:**

1. **Non-object errors** (thrown strings, numbers): Log and return generic 500. The `typeof err !== 'object'` guard prevents `'type' in err` from throwing on non-objects.
2. **Express body parser errors**: Detected by the `type` property (`entity.parse.failed`, `entity.too.large`). These are specific error types from Express's `body-parser` that we translate to our error codes.
3. **AppError instances**: Operational errors we expect. Send the structured error response with the correct status code and error code.
4. **Everything else**: Programmer errors — bugs. Log the full error for debugging, but send a generic message to the client. In development mode, we include the original error message for convenience. In production/test, we never leak internal details.

**Why `req.log ?? logger`?** If the error occurs before `requestLoggerMiddleware` runs (e.g., in body parsing), `req.log` won't exist yet. We fall back to the root logger so errors are always logged.

---

#### 10. App Assembly (`src/app.ts`)

**What it does:** Creates and configures the Express app with the full middleware chain.

**`createApp(registerRoutes?)` — the factory pattern:**

The function accepts an optional callback `registerRoutes` that injects routes between the rate limiter and the 404 catch-all. This serves two purposes:

1. **Tests** use it to inject test-only routes (error-triggering routes, echo routes) without polluting the production app.
2. **Future sprints** could use it to compose route modules, though in practice we'll likely register routes directly in `createApp`.

**CORS configuration:**

```typescript
const origins = config.CORS_ORIGINS.split(',').map((o) => o.trim());
```

`CORS_ORIGINS` is a comma-separated string in the env (`http://localhost:3000,http://localhost:5173`). We split it into an array for the `cors()` middleware. The `origin` option accepts an array of allowed origins — requests from unlisted origins don't get `Access-Control-Allow-Origin` headers, causing the browser to reject the response.

**Health check implementation:**

The health route uses an async handler (Express 5 catches async errors automatically). It attempts to ping the database:
- Success → 200, `status: "healthy"`, `database: "connected"`
- Failure (DB not initialized or ping fails) → 503, `status: "degraded"`, `database: "disconnected"`

The `try/catch` around `getClient()` handles the case where the database was never connected (e.g., during tests that don't call `setupTestDb()`). The ping command is the lightest possible DB operation — it doesn't read any collections.

---

#### 11. Server Entry Point (`src/server.ts`)

**What it does:** Connects to MongoDB, ensures indexes, starts the HTTP server, and handles graceful shutdown.

**Startup sequence:**
1. `connectDatabase()` — establishes the MongoDB connection pool
2. `ensureIndexes()` — creates any missing indexes (idempotent)
3. `createApp()` + `app.listen()` — starts accepting HTTP requests

If any step fails, `logger.fatal()` logs the error and `process.exit(1)` terminates immediately. There's no point continuing if the database is unreachable or indexes can't be created.

**Graceful shutdown:**

When the process receives `SIGTERM` (deployment/orchestrator) or `SIGINT` (Ctrl+C):

1. `server.close()` — stops accepting new connections. Existing connections continue.
2. Wait up to 10 seconds for in-flight requests to complete. The `Promise` resolves either when `server.close()` callback fires (all connections drained) or when the timeout expires (force shutdown).
3. `closeDatabase()` — closes the MongoDB connection pool cleanly.
4. `process.exit(0)` — clean exit.

**Why 10 seconds?** Long enough for most HTTP requests to complete (our non-AI timeout is 30 seconds, but most requests finish in <1 second). Short enough that deployment pipelines don't hang. If a request is still running after 10 seconds, it's better to terminate than block the deployment.

---

### Key Implementation Details

#### Deviations from Phase 1 Plan

1. **DNS workaround in database.ts:** Not planned. Discovered during testing when Atlas SRV lookups failed with Node.js's default DNS resolver. Added `dns.setServers(['8.8.8.8', '8.8.4.4'])` at module load time.

2. **Health check uses async ping instead of topology check:** The plan mentioned `client.topology.isConnected()`, but this is unreliable — the topology object may not exist or may report stale state. An actual `ping` command is the authoritative check.

3. **pino-http named export:** The plan assumed default import (`import pinoHttp from 'pino-http'`). TypeScript's ESM resolution required using the named export (`import { pinoHttp } from 'pino-http'`) due to how pino-http's type declarations are structured.

4. **Rate limiter test bumped from 2 to 5 max requests:** The initial limit of 2 was too low — by the time R2 (remaining decreases) ran, the limit was already exhausted from R1. Bumped to 5 to give enough headroom for all test cases.

5. **Error handler non-object guard:** The plan didn't account for thrown non-objects (strings, numbers). Express 5 passes these to the error handler, but `'type' in err` throws on non-objects. Added a `typeof err !== 'object'` guard at the top of the handler.

#### Security Measures

- **No stack traces in production responses:** The error handler only includes original error messages in `development` mode. In `production` and `test`, non-AppError errors get a generic message.
- **Helmet security headers:** X-Content-Type-Options, X-Frame-Options, Strict-Transport-Security, and X-Powered-By removal are all enforced.
- **CORS enforcement:** Only explicitly configured origins are allowed. No wildcard (`*`).
- **Body size limit:** 100kb default, enforced by `express.json({ limit })`.
- **Rate limiting:** Global rate limit with configurable window and max. Custom 429 response in our error envelope format.
