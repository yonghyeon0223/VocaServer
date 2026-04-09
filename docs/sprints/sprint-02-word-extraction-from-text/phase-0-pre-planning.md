# Sprint 02 — Word Extraction from Text

## Phase 0: Pre-Planning

This document captures decisions and context from Sprint 01 discussions that inform Sprint 02 planning. Written at the end of Sprint 01 for continuity into the next session.

---

### Sprint Ordering Decision

The original roadmap had Auth as Sprint 02. We changed the order:

| Sprint | Original Plan | Revised Plan |
|--------|--------------|--------------|
| 02 | Auth | **AI wrappers + Word extraction from text** |
| 03 | Wordsets | Word info lookup + Exercise generation |
| 04 | Words + AI extraction | **Auth** |

**Why:** AI prompt tuning is the highest-risk, highest-uncertainty work in the project. If extraction doesn't produce good results, the app's core value proposition doesn't work. Auth is well-understood boilerplate that can wrap existing endpoints later without changing business logic. De-risk the hard stuff first.

**Testing without auth is easy:** Our module pattern (routes → controller → service → model) means auth is just a middleware on routes. Without it, endpoints are open — everything else works the same.

---

### Sprint 02 Scope

Two main deliverables:

#### 1. AI Client Wrappers (`src/shared/ai/`)

Shared infrastructure for calling AI APIs. Per CLAUDE.md architecture:

- **Never call AI APIs directly from service code.** Always go through the wrapper.
- Wrapper handles: token tracking, budget checks, retries, timeouts, error normalization.
- Track every call in the database: user ID (null for now — no auth), model used, input/output tokens, feature that triggered it, timestamp.
- Per-user daily budgets enforced at the service layer (deferred until auth exists — but the tracking schema should be ready).
- 90-second timeout on AI calls.
- Clear error distinction: budget exhausted vs provider unavailable vs timeout.

**Model choice:** Haiku 4.5 for all tasks initially. Only upgrade to Sonnet for specific tasks if Haiku quality is insufficient after prompt tuning.

**Anthropic SDK:** Use `@anthropic-ai/sdk` package.

#### 2. Prompt Experiment Runner

A development tool for iterating on AI prompts outside the server. **This is critical** — the user needs to manually test and fine-tune prompts before they become production code.

**Workflow:**
1. Input files: text articles (`.txt`) or images (`.png`, `.jpg`) placed in an input directory
2. Prompt files: prompt templates (`.txt`) with version numbers
3. Run the experiment script pointing at an input + prompt
4. Output: AI response saved to a file with naming convention that links it to its input/prompt combo
5. A run log tracks metadata (timestamp, model, tokens, latency) for cost comparison

**Proposed directory structure:**
```
experiments/
  extraction/
    inputs/
      article-01.txt
      article-02.txt
      photo-01.png
    prompts/
      v1.txt
      v2.txt
    outputs/
      article-01_v1.json
      article-01_v2.json
      photo-01_v1.json
    runs.log
  run.ts              # The experiment runner script
```

**Key requirements:**
- Input as file, prompt as file, output as file — all recorded for later reference
- Easy to compare outputs across prompt versions (same input, different prompts)
- Images supported (Haiku 4.5 has vision)
- Uses the same AI client wrapper the server will use — prompt work translates directly to production
- Not a CLI tool — file-based I/O, not interactive

#### 3. Word Extraction Endpoint (stretch goal)

If prompt iteration produces a stable extraction prompt during the sprint:
- `POST /api/v1/extract` — accepts text, returns extracted words
- No auth required (deferred)
- Uses the finalized prompt from experimentation
- Implements the parallel call pattern (see below)

This may be deferred to Sprint 03 depending on how much prompt iteration is needed.

---

### Critical Architecture Decision: Parallel Small Calls

**Problem from v1:** The previous version of the app had ~60 second response times on Haiku. The cause: requesting ~6,000 output tokens in a single call (extracting 30+ words with full details in one shot). LLM output generation is sequential — 6,000 tokens ≈ 30-60 seconds regardless of model.

**Solution:** Break large tasks into small parallel calls.

```
Before (v1):
  1 call → "Extract 30 words with definitions, examples, pronunciation..."
  → 6,000 output tokens → ~50 seconds

After (v2):
  Call 1: "Extract vocabulary words from this text. Return just the words."
  → ~200 tokens → ~2 seconds

  Calls 2-31 (parallel): "For word 'X', give definition, examples, etc."
  → ~200 tokens each → ~2 seconds each (all concurrent)

  Total: ~4 seconds (2s + 2s parallel)
```

**Trade-off:** ~20% more total tokens (slight cost increase), but 10x latency improvement.

**Implementation notes:**
- The AI client wrapper needs a `Promise.all`/`Promise.allSettled` pattern for parallel calls
- Need to handle partial failures (some word lookups fail while others succeed)
- Rate limiting on the AI provider side: Anthropic has requests-per-minute limits. Parallel calls must respect this. May need a semaphore or queue.

---

### Environment Variables to Add

```
# AI Providers
AI_ANTHROPIC_KEY=sk-ant-...
AI_DEFAULT_MODEL=claude-haiku-4-5-20251001

# AI Budget (deferred enforcement until auth, but config ready)
AI_DAILY_BUDGET_TOKENS=1000000
AI_REQUEST_TIMEOUT_MS=90000
```

---

### Dependencies to Add

| Package | Purpose |
|---------|---------|
| `@anthropic-ai/sdk` | Anthropic API client |

OpenAI SDK deferred until/unless needed. Start with Anthropic only.

---

### Database Schema Considerations

**AI usage tracking collection** (`ai_usage_logs`):
```typescript
interface AiUsageLog {
  _id: ObjectId;
  userId: ObjectId | null;     // null until auth exists
  model: string;               // e.g., "claude-haiku-4-5-20251001"
  feature: string;             // e.g., "word_extraction", "word_lookup"
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  timestamp: Date;
  requestId: string;           // links to the HTTP request that triggered it
}
```

**Indexes:**
- `{ userId: 1, timestamp: -1 }` — for per-user budget queries
- `{ feature: 1, timestamp: -1 }` — for per-feature analytics
- `{ timestamp: 1 }` — for time-range queries and TTL cleanup

---

### Open Questions for Phase 1 Planning

1. **Experiment runner output format:** Should outputs be raw AI response JSON, or parsed/structured? Leaning toward raw — easier to compare, and parsing logic comes later.

2. **Image support priority:** Should Sprint 02 handle image extraction, or focus on text only and add images in Sprint 03? Images add complexity (base64 encoding, vision model params).

3. **Prompt template variables:** Should prompt files support placeholders (e.g., `{{TEXT}}`) that the runner substitutes, or should the runner just append the input to the prompt?

4. **Run log format:** Simple TSV/CSV, or structured JSON lines? JSON lines is more parseable but less human-readable.

5. **How many sample articles should we prepare for testing?** Suggest 3-5 articles of varying length and difficulty to test extraction across different inputs.

---

### What's Ready from Sprint 01

Everything Sprint 02 builds on:

- **Express app** with full middleware chain — just register new routes
- **MongoDB connection** — ready for new collections
- **`db-indexes.ts`** — add new indexes here
- **Error classes** — `AppError` hierarchy ready for AI-specific errors (budget exceeded, provider unavailable, timeout)
- **Response helpers** — `sendSuccess`, `sendError` with standard envelope
- **Structured logging** — Pino with per-request context
- **Rate limiting** — global limit in place, per-route limits can be added
- **Config pattern** — extend `env.ts` with new AI env vars
