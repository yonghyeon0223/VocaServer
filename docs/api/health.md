# Health API

## Overview

Infrastructure health check endpoint used by load balancers, monitoring tools, and deployment pipelines to verify the server is operational. Lives outside `/api/v1/` because it's infrastructure, not application API.

## Authentication

None required. This endpoint must be accessible without credentials.

## Rate Limiting

Not rate-limited. The health endpoint is registered before the rate limiter in the middleware chain, so monitoring tools can hit it as frequently as needed without being throttled.

## Endpoints

### GET /health

**Description:** Returns the server's health status, including database connectivity, process uptime, and current timestamp.

**Headers:** None required. Optionally accepts `X-Request-Id` for tracing.

**Query Parameters:** None. Query parameters are ignored.

**Success Response — Database Connected (200):**

```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "uptime": 3621.45,
    "database": "connected",
    "timestamp": "2026-04-09T12:00:00.000Z"
  },
  "meta": {
    "requestId": "req_a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "timestamp": "2026-04-09T12:00:00.000Z"
  }
}
```

**Degraded Response — Database Disconnected (503):**

```json
{
  "success": true,
  "data": {
    "status": "degraded",
    "uptime": 3621.45,
    "database": "disconnected",
    "timestamp": "2026-04-09T12:00:00.000Z"
  },
  "meta": {
    "requestId": "req_a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "timestamp": "2026-04-09T12:00:00.000Z"
  }
}
```

**Response Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `data.status` | `"healthy" \| "degraded"` | Overall server health. `"degraded"` when database is unreachable. |
| `data.uptime` | `number` | Server process uptime in seconds. |
| `data.database` | `"connected" \| "disconnected"` | MongoDB connection status. Determined by a lightweight `ping` command. |
| `data.timestamp` | `string` (ISO 8601) | Current server time in UTC. |

**Notes:**

- The 503 status code tells load balancers to stop routing traffic to this instance, while the response body gives operators diagnostic details.
- The endpoint still returns `success: true` even when degraded — the health check endpoint itself succeeded at reporting the infrastructure status. This is different from an application error.
- `uptime` is `process.uptime()` — time since the Node.js process started, not since the last deploy or health check.
- Only `GET` is supported. Other HTTP methods (POST, PUT, DELETE) fall through to the 404 catch-all.
- Database health is checked via `db.admin().command({ ping: 1 })` — the lightest possible operation. No collections are read.

## Error Responses

The health endpoint itself doesn't return error responses (it always returns a success envelope with status information). However, standard infrastructure errors apply:

| Status | Code | When |
|--------|------|------|
| 404 | `RESOURCE_NOT_FOUND` | Non-GET method (e.g., `POST /health`) |

## Common Response Headers

All responses from this endpoint include:

| Header | Description |
|--------|-------------|
| `X-Request-Id` | Request tracking ID (auto-generated or echoed from client) |
| `X-Content-Type-Options` | `nosniff` (Helmet) |
| `X-Frame-Options` | Frame protection (Helmet) |
| `Strict-Transport-Security` | HSTS header (Helmet) |
| `Content-Type` | `application/json; charset=utf-8` |
