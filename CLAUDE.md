# CLAUDE.md — Voca Server

## Project Overview

Vocabulary learning app server — AI-assisted, personalized word learning platform. Features include auto-extraction from text, word information lookup, exercise generation, and progress tracking. This is a ground-up rebuild of an existing React Native + Express prototype, prioritizing accuracy, performance, robustness, and security over speed of delivery.

## Tech Stack

- **Runtime:** Node.js with TypeScript (strict mode)
- **Framework:** Express.js
- **Database:** MongoDB on Atlas (native `mongodb` driver — no Mongoose)
- **Auth:** JWT (access + refresh token pair)
- **Validation:** Zod for all input validation
- **Testing:** Vitest + Supertest (test-driven development)
- **CI:** GitHub Actions (lint + type-check + test gates on every PR)
- **AI Providers:** Anthropic (Haiku), OpenAI (GPT-4o) — usage tracked and budget-controlled

## Architecture Principles

### API Design
- RESTful API with versioning: all routes under `/api/v1/`
- Every route validates request body, params, and query with Zod schemas before touching business logic. No exceptions.
- HTTP methods used correctly: GET reads, POST creates, PUT/PATCH updates, DELETE removes
- Use proper HTTP status codes: 200, 201, 204, 400, 401, 403, 404, 409, 422, 429, 500

### Response Envelope
Every endpoint returns the same JSON shape. No exceptions.

**Success response:**
```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "requestId": "req_abc123",
    "timestamp": "2026-04-09T12:00:00.000Z"
  }
}
```

**Success response with pagination (all list endpoints):**
```json
{
  "success": true,
  "data": [ ... ],
  "meta": {
    "requestId": "req_abc123",
    "timestamp": "2026-04-09T12:00:00.000Z",
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 142,
      "totalPages": 8
    }
  }
}
```

**Error response:**
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable description",
    "details": [{ "field": "email", "message": "Invalid email format" }]
  },
  "meta": {
    "requestId": "req_abc123",
    "timestamp": "2026-04-09T12:00:00.000Z"
  }
}
```

- **`meta`** is always present on every response (success and error). Contains `requestId` and `timestamp`. List endpoints add `pagination`.
- **`error.code`** is a machine-readable constant the client switches on (e.g., `VALIDATION_ERROR`, `UNAUTHORIZED`, `RESOURCE_NOT_FOUND`, `AI_BUDGET_EXCEEDED`, `RATE_LIMITED`, `DUPLICATE_ENTRY`). Never switch on `message`.
- **`error.details`** is optional — only present for validation errors (maps to Zod error output).
- **HTTP status code vs `error.code`:** Status code is for HTTP-level behavior (retries, caching). `error.code` is for app-level logic. A 400 could be `VALIDATION_ERROR` or `DUPLICATE_ENTRY` — clients need to distinguish.

### Pagination
- **All list endpoints must support pagination** via `?page=1&limit=20` query params.
- Default `limit` is 20, max `limit` is 100. Invalid values are clamped, not rejected.
- Pagination is implemented as a shared utility — not re-implemented per endpoint.
- Even for small bounded lists (e.g., words in a single wordset), pagination support is built in. Clients can request `?limit=100` to get everything in one call.

### Request ID Tracking
- Middleware generates a UUID with `req_` prefix for every incoming request.
- If the client sends an `X-Request-Id` header, use that instead (enables mobile-to-server tracing).
- The request ID is:
  - Attached to the request object for downstream access
  - Injected into every log entry via a child logger scoped to the request
  - Returned in every response's `meta.requestId`
  - Included in error responses for user-reported debugging

### Project Structure
```
src/
  config/          # Environment config, DB connection, constants
  middleware/       # Auth, validation, error handling, rate limiting, request ID
  modules/         # Feature modules (each with routes, controller, service, model, validation, types)
    auth/
    users/
    words/
    ...
  shared/          # Shared utilities, types, error classes, AI client wrappers
  app.ts           # Express app setup (middleware, routes)
  server.ts        # Entry point (starts server, connects DB)
tests/
  unit/            # Unit tests mirroring src/ structure
  integration/     # API-level tests with real DB
  fixtures/        # Shared test data
  helpers/         # Test utilities (DB setup/teardown, auth helpers)
docs/
  sprints/         # Sprint folders (sprint-01-app-skeleton/, sprint-02-auth/, ...)
  api/             # API documentation per module
```

### Module Pattern
Each feature module follows this structure:
```
modules/feature/
  feature.routes.ts       # Route definitions only
  feature.controller.ts   # Request/response handling, calls service
  feature.service.ts      # Business logic, calls model
  feature.model.ts        # Database operations (queries, aggregations)
  feature.validation.ts   # Zod schemas for this module's inputs
  feature.types.ts        # TypeScript types/interfaces for this module
```

- **Routes** only define paths and wire middleware + controller
- **Controllers** handle HTTP concerns (parse request, send response). No business logic.
- **Services** contain all business logic. No direct DB calls — delegate to model.
- **Models** are the only layer that talks to MongoDB. Return plain objects, not cursors.
- Services and models are class-based with dependency injection for testability.

### Database (MongoDB Native Driver)
- **No Mongoose.** Use native `mongodb` driver for performance and control.
- **Schema decision per feature:** Embed when data is small and bounded. Reference (separate collections) when data can grow unbounded. The 16MB document limit is real — a user accumulating words over months/years will hit it if everything is embedded.
- **Every collection must have a documented schema** in its module's types file, even without Mongoose. TypeScript interfaces are the schema.
- **Indexes must be explicitly created** in a dedicated setup script (`src/config/db-indexes.ts`). No implicit indexes besides `_id`.
- **All queries must use projections** — never fetch entire documents when you only need specific fields.
- **Use MongoDB aggregation pipelines** for complex queries rather than pulling data into application code.
- **Connection pooling:** Use a single MongoClient instance shared across the app. Never create connections per request.
- **Write concern:** Explicitly set `w: "majority"` in connection config. Never rely on defaults — if Atlas or a future setup changes the default, we lose durability guarantees.
- **Transactions** when multiple collections must be updated atomically.

### Security
- **JWT access tokens:** Short-lived (15 min). Stored in memory on client.
- **JWT refresh tokens:** Longer-lived. Stored in DB with rotation — issuing a new refresh token invalidates the old one. Detect reuse (potential token theft).
- **Password hashing:** bcrypt with minimum 12 rounds.
- **All environment variables validated at startup** with Zod. Server crashes immediately if any required var is missing, has the wrong type, or has an unexpected value. Validated in `src/config/env.ts` which exports a typed `config` object. The rest of the app imports from `config` — nobody touches `process.env` directly outside this module.
- **Request body size limit:** Default 100KB via `express.json({ limit: '100kb' })`. Specific routes that accept larger payloads (e.g., text extraction where users paste articles) get higher limits configured per-route.
- **CORS:** Explicitly configured, never `*` in production. In development, allow localhost origins. Production origins list deferred until deployment.
- **Helmet.js** for security headers.
- **No secrets in code.** All secrets via environment variables.
- **Sanitize all user input** before DB operations to prevent NoSQL injection.
- **Admin role:** RBAC via user roles in JWT payload. Admin APIs check role in middleware. Admin dashboard features are out of scope for now but the role system must be in place from sprint 1.

### AI Usage & Cost Control
- **Track every AI API call** in the database: user ID, model used, input/output tokens, feature that triggered it, timestamp.
- **Per-user daily budgets** enforced at the service layer before making AI calls. Configurable per model.
- **AI client wrappers** in `src/shared/ai/` — never call AI APIs directly from service code. Always go through the wrapper which handles: tracking, budget checks, retries, timeouts, error normalization.
- **Fail gracefully** when AI budget is exhausted — return a clear error to the client, never silently degrade.
- **Timeouts:** 90 second timeout on AI API calls (Haiku, GPT-4o). Non-AI request timeout is 30 seconds. When an AI call times out, the response must clearly tell the client what happened and whether the operation can be retried.
- **AI features are core** — many learning features depend on AI responses. When AI is unavailable, the error response must distinguish between "your budget is exhausted" (user action needed) vs "AI provider is temporarily unavailable" (retry later) vs "request timed out" (retry possible).

### Error Handling
- **Custom error classes** extending a base `AppError` class with HTTP status codes and error codes.
- **Global error handler middleware** — catches all thrown errors and formats them into the standard response envelope.
- **Never expose stack traces or internal details in production responses.**
- **Operational vs programmer errors:** Operational errors (bad input, not found, unauthorized) are expected and handled. Programmer errors (undefined reference, type errors) crash the process and get restarted by the process manager.
- **All async route handlers wrapped** to catch rejected promises and forward to error middleware.

### Logging
- **Structured JSON logging** with `pino` — never `console.log` in production code.
- **Request ID on every log entry.** Child logger created per request in middleware, scoped with the request ID.
- **Log levels used correctly:** error (failures needing attention), warn (unexpected but handled), info (significant operations), debug (development detail).
- **Log AI API calls** with token counts and latency for cost monitoring.
- **Never log sensitive data:** passwords, tokens, full request bodies containing credentials.
- **Output:** JSON to stdout. In production, the process manager (pm2) or cloud platform captures and routes logs. In development, `pino-pretty` transport for readable colored terminal output.

### Rate Limiting
- **Global rate limit** on all routes to prevent abuse.
- **Stricter per-user limits on AI-powered endpoints** — aligned with daily AI budget system.
- **Auth endpoints** (login, register, refresh) get aggressive rate limits to prevent brute force.
- Use `express-rate-limit` with a MongoDB or Redis store for distributed rate limiting if needed.

### Health Check
- `GET /health` endpoint — lives outside `/api/v1/` (it's infrastructure, not API).
- Returns DB connection status, uptime, and timestamp.
- No auth required — load balancers, monitoring tools, and deployment pipelines depend on this.
- Must respond quickly — do a lightweight DB ping, not a heavy query.

### Graceful Shutdown
- On SIGTERM/SIGINT: stop accepting new connections, finish in-flight requests (with a timeout), close the MongoDB connection pool, then exit.
- Prevents corrupted operations and connection leaks during deploys and restarts.
- Implemented in `server.ts` — not scattered across modules.

### Date/Time Handling
- **All dates stored in MongoDB as native `Date` objects** (UTC internally).
- **All dates in API responses as ISO 8601 strings** (e.g., `"2026-04-09T12:00:00.000Z"`).
- **All date logic in application code uses UTC.** No local timezone math on the server.
- **Client is responsible for converting to the user's local timezone** for display.
- This is critical for: spaced repetition intervals, daily AI budget resets, word learning timestamps, exercise history.

### Data Mutability Policy
- **Words within a wordset are immutable** — no edit, no delete. This ensures data integrity and simplifies the schema.
- **Wordsets can be deleted** (hard delete). When a wordset is deleted, the cascade behavior for related data (exercise history, progress stats, AI usage) must be explicitly defined per feature during sprint planning.
- **Cursor-based pagination** will be evaluated for time-ordered data when we implement exercise/review features. For now, page-based pagination is the default.
- **Idempotency** — Critical create endpoints (wordset creation, exercise generation, etc.) should support an `Idempotency-Key` header to prevent duplicate creation on network retries. The client sends a UUID; the server checks if that key was already processed and returns the original response instead of creating a duplicate. Not built in sprint 1, but adopted as features are built.

## Development Process

### Test-Driven Development (TDD)
For every feature in every sprint:
1. **Discuss** normal cases, special cases, and edge cases for every input of every API endpoint
2. **Write tests first** — unit tests for services/models, integration tests for API endpoints
3. **Implement** until all tests pass
4. **Refactor** with test safety net

Test categories for every endpoint:
- **Normal cases:** Valid inputs, expected happy-path behavior
- **Special cases:** Boundary values, optional fields present/absent, empty arrays, pagination edges
- **Edge cases:** Malformed input, missing auth, expired tokens, duplicate entries, concurrent modifications, Unicode/emoji in text, extremely long strings, SQL/NoSQL injection attempts

### Sprint Process
Each sprint happens in a separate Claude Code session. To maintain continuity:

1. **Phase 1 — Planning:** Discuss features, API design, schema, auth, error handling down to function signatures and implementation details. User is involved in every decision. Document the plan before writing any code.
2. **Phase 2 — Testing:** Discuss normal, special, and edge cases. Discuss security and performance considerations. Write all tests before implementation.
3. **Phase 3 — Implementation:** Write code until all tests pass. Refactor with test safety net.
4. **Phase 4 — Review:** Write sprint report, verify test results, document deferred work and handoff notes.

### Sprint Documentation

Each sprint gets its own folder under `docs/sprints/` with a descriptive name:
```
docs/sprints/
  sprint-01-app-skeleton/
  sprint-02-auth/
  sprint-03-wordsets/
  ...
```

Each sprint folder contains the phase documents for that sprint. The folder name follows the pattern `sprint-NN-short-description` (kebab-case).

**Sprint scope:**
- Each sprint covers 1-2 main features (roughly 2-6 new API endpoints).
- Sprints should be modular — each sprint's feature set should be as self-contained as possible, minimizing half-built dependencies on future sprints.
- If a feature requires more than 6 endpoints, split it across sprints with clear boundaries (e.g., "sprint-03-wordsets-crud" then "sprint-04-wordsets-ai-extraction").

Each sprint folder contains the report divided into the four phases.

**Critical rules for sprint docs:**
- **Cumulative, not just diffs.** When adding a new index, document ALL indexes on that collection — why each exists, how the new one interacts with existing ones, whether any existing index is now redundant.
- **Code walkthroughs are teaching-level.** Explain not just what the code does, but WHY it's written that way, what would go wrong if done differently, and the underlying concepts (MongoDB internals, Express middleware chains, auth flows, etc.). The user is a student and wants to learn professional patterns.
- **Planning is granular.** Include function signatures, error handling branches, which MongoDB operations to use and why, middleware chain order, etc. No black boxes.

```markdown
# Sprint NN — [Title]

## Phase 1: Planning

### Objectives
What we're building and why. Business context and user-facing behavior.

### API Endpoints
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST   | /api/v1/... | Required | ... |

### Request/Response Examples
Actual JSON for every endpoint — both success and every possible error response.

### Database Design
- Full collection schemas (not just new fields — the complete picture)
- All indexes on affected collections with reasoning for each
- Embedding vs referencing decisions with justification
- Impact analysis: does this change affect query performance on existing endpoints?

### Design Decisions
For each decision:
- What we decided
- What alternatives we considered
- Why we chose this approach
- Trade-offs accepted

### Implementation Plan
- Function signatures and module interactions
- Middleware chain and execution order
- Error handling strategy per endpoint
- Dependencies between components

## Phase 2: Testing

### Test Cases
#### Normal Cases
#### Special Cases
#### Edge Cases

### Security Considerations
Input validation gaps, auth edge cases, injection vectors tested.

### Performance Considerations
Query efficiency, index usage, payload sizes, N+1 query risks.

## Phase 3: Implementation

### Code Walkthrough
Detailed, teaching-level explanation of how the code works:
- What each file/function does and why it exists
- How data flows through the layers (route → controller → service → model → DB)
- Why specific patterns were chosen over alternatives
- Underlying concepts explained (e.g., how JWT verification works, why bcrypt is slow on purpose, how MongoDB indexes are structured)
- Common mistakes and how the code avoids them

### Key Implementation Details
Non-obvious implementation choices, performance optimizations, security measures.

## Phase 4: Review

### Test Results
- Total tests: N passed / N total
- Coverage summary
- Notable edge cases and what they caught

### Deferred Work
What's explicitly not done, why, and what future sprint should pick it up.

### Notes for Next Sprint
Handoff context: known limitations, indexes that will be needed for upcoming features, schema decisions that upcoming features should revisit, etc.
```

### API Documentation

API docs live at `docs/api/module-name.md`. These are the **living reference** — updated in place across sprints as endpoints evolve. Sprint docs are the journal (what happened); API docs are the current truth.

```markdown
# Module Name API

## Overview
What this module does. Domain context.

## Authentication
What auth is required for this module's endpoints.

## Endpoints

### POST /api/v1/...
- **Description:** What it does
- **Headers:** Required headers
- **Request Body:** Schema described in plain terms + example JSON
- **Success Response:** Example JSON with status code
- **Error Responses:** Each possible error code with example
- **Rate Limits:** If applicable
- **Notes:** E.g., "triggers AI call, counts against daily budget"
```

## Conventions

### TypeScript
- Strict mode enabled (`strict: true` in tsconfig)
- No `any` — use `unknown` and narrow with type guards when type is truly unknown
- Prefer interfaces for object shapes, type aliases for unions/primitives
- All function parameters and return types explicitly typed
- Use `as const` assertions for fixed string sets

### Naming
- Files: `kebab-case` (e.g., `auth.controller.ts`)
- Variables/functions: `camelCase`
- Classes: `PascalCase`
- Constants: `UPPER_SNAKE_CASE`
- Database collections: `snake_case` plural (e.g., `user_words`)
- Environment variables: `UPPER_SNAKE_CASE` prefixed by category (e.g., `DB_URI`, `JWT_ACCESS_SECRET`, `AI_ANTHROPIC_KEY`)

### Code Comments
- **Don't comment what the code does** — the code should be readable enough. If it isn't, rewrite the code.
- **Do comment why** — when a non-obvious decision was made, when a workaround exists for a known issue, when a performance optimization makes the code less intuitive.
- **Do comment complex MongoDB aggregation pipelines** — stage by stage, what each stage accomplishes.
- **No TODO comments without a sprint reference** — `// TODO(sprint-3): add cursor pagination` is fine, bare `// TODO` is not.
- **Detailed explanations belong in sprint docs**, not in code. Code comments are signposts, not essays.

### Dependencies
- **Pin exact versions** — no `^` or `~` in package.json. Deterministic builds.
- **Minimal dependencies** — before adding a package, ask: can Node's standard library do this in under 30 lines? If yes, skip the package. Every dependency is an attack surface.
- **No unmaintained packages** — check last publish date, open issues, download count. If a security-relevant package hasn't been updated in 2+ years, find an alternative.
- **`npm audit`** runs in CI — build fails on high/critical vulnerabilities.
- **`package-lock.json` is always committed** to git.

### Git
- Conventional commits: `feat:`, `fix:`, `test:`, `docs:`, `refactor:`, `chore:`
- One logical change per commit
- Tests and implementation may be in the same commit if they're for the same feature
- **Commit and push at the end of each sprint** — after Phase 4 (Review) is complete, create a commit with all sprint work and push to the remote repository
