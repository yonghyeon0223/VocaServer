# Sprint 03 — Extraction Consistency Testing

## Phase 4: Review

### Sprint Outcome

Sprint 03 answered its central question: **can a single Sonnet call produce extraction output rich enough to support downstream personalization?** Yes — but with a latency cost that must be addressed before production.

Sprint 02 ended with a proposed two-call architecture (extract with Haiku → rate separately). Sprint 03 pivoted: instead of building that pipeline, we tested whether a single, more capable model could do everything in one call. Three prompt iterations (v12→v14) validated that Sonnet with a well-crafted prompt produces comprehensive, structurally valid output — definitions, CEFR levels, and importance ratings — all in a single call.

The single-call approach eliminates the need for a separate rating call, a level-caching database layer, and a batch rating endpoint. The architecture simplifies dramatically. But Sonnet is slow: normal prose takes 20-35 seconds per passage.

### Prompt Evolution: What Each Version Taught Us

#### v12 — Haiku, Minimal Prompt (14 lines)

**What we tried:** A compact prompt with rationale fields (`levelRationale`, `importanceRationale`), first with pipe-delimited text, then tool_use with keyed JSON.

**Results:** 28 fixtures, 315 items, avg 6,100ms/fixture, $0.07/run.

**What we learned:**
- tool_use eliminated every parse error — confirmed Sprint 02's finding permanently.
- Haiku's extraction was thin. test-01 (elementary passage) produced only 24 items. Collocations and grammar patterns missed entirely.
- Rationale fields consumed tokens without improving accuracy. The AI wrote plausible explanations regardless of whether the level/importance was correct — chain-of-thought doesn't help if the model lacks the judgment to begin with.
- Haiku included overlaps between phrases and vocabulary despite instructions.

#### v13 — Sonnet, Compact Tuples (43 lines)

**What we changed:** Switched to Sonnet. Dropped rationale fields. Switched from keyed JSON to compact tuples `[term, def, level, imp]`. Added explicit injection defense and overlap rule.

**Results:** 27 fixtures, 460 items (+46%), avg 8,641ms/fixture, $0.15/run.

**What we learned:**
- The Haiku→Sonnet jump was dramatic. test-01 went from 24 to 41 items. Sonnet caught collocations Haiku missed entirely ("has breakfast", "does homework", "plays soccer").
- Compact tuples saved ~40-50% output tokens with zero information loss.
- Phrase extraction quality improved substantially — Sonnet understood the "would a learner who knows every word still get this wrong?" test intuitively.
- Overlap rule mostly followed, but not perfectly.

#### v14 — Sonnet, Expanded Prompt with Caching (300 lines)

**What we changed:** Massively expanded prompt with Korean learner pain points (YES/NO examples for every phrase category), explicit non-phrase examples, refined exclusion list, 7-step self-review checklist, edge case instructions, and 1-hour prompt caching.

**Results:** 27 fixtures, 549 items (+19% over v13, +74% over v12), avg 9,605ms/fixture, $0.32/run (with cache).

**What we learned:**
- Concrete examples work. Documenting Korean pain points with YES/NO examples ("YES: has breakfast — NOT eat breakfast", "YES: interested in — NOT interested about") gave Sonnet the context to catch collocations and preposition pairings that v13 missed.
- The self-review checklist reduces errors. The AI catches its own overlap violations and missing terms when explicitly told to re-check.
- 1-hour prompt caching is essential for the expanded prompt. Without caching, the 4,142-token system prompt would cost ~$0.012/call in input. With caching, subsequent calls cost ~$0.001/call for the cached portion.

### Quality vs Speed vs Cost

| Metric | v12 (Haiku) | v13 (Sonnet) | v14 (Sonnet+cache) |
|--------|-------------|--------------|-------------------|
| Model | Haiku | Sonnet | Sonnet |
| Prompt size | 14 lines | 43 lines | 300 lines |
| Total items (27 fixtures) | 315 | 460 | 549 |
| Items per normal fixture | ~17 avg | ~39 avg | ~67 avg |
| Avg latency/fixture | 6,100ms | 8,641ms | 9,605ms |
| Structural checks | 179/179 | 179/179 | 179/179 |
| Parse errors | 0 | 0 | 0 |
| Cost per run | $0.07 | $0.15 | $0.32 |

**Cost is clearly worth it.** $0.32 for a full 27-fixture test run. In production, a single extraction is roughly $0.01. Even at scale, this is negligible.

**Speed is a real concern.** The average latency is ~10 seconds, but normal prose — what students actually submit — is much worse:

| Fixture | Passage length | Items | Latency |
|---------|---------------|-------|---------|
| test-01 (elementary) | ~130 words | 51 | 25,111ms |
| test-04 (middle school) | ~200 words | 57 | 21,963ms |
| test-07 (모의고사) | ~600 words | 94 | 35,677ms |

A student pastes a paragraph and waits **25-35 seconds**. This is not a prompt problem we can fix with better engineering. It's a fundamental quality-vs-latency tradeoff:
- Sonnet generates tokens slower than Haiku — that's why it's smarter.
- v14 produces more items with richer definitions — more output tokens = more time.
- Output tokens are generated sequentially — there is no parallelism in token generation.

This is the most important finding of the sprint and the top priority for production architecture.

### Key Decisions

| Decision | What it replaced | Why |
|----------|-----------------|-----|
| Single call (Sonnet) | Two calls (Haiku extract + rate) | v14 proves Sonnet produces definitions AND levels in one call — the split architecture was a workaround for Haiku's limitations |
| Sonnet over Haiku | Haiku (Sprint 02) | 74% more items, dramatically better phrase detection and definition quality |
| Compact tuples `[term, def, level, imp]` | Keyed JSON `{term, definition, ...}` | ~40-50% output token savings, zero information loss |
| 1-hour prompt caching | No caching | 90% discount on repeated input cost; essential for the 300-line prompt |
| No rationale fields | v12 had rationale | Consumed tokens without improving accuracy |
| 300-line prompt with examples | 14-line minimal prompt | Korean pain point examples dramatically improved phrase detection |
| 7-step self-review checklist | No review | AI catches its own overlap/completeness errors |
| Dual injection defense | Server-only | Server catches delimiter patterns + prompt ignores user instructions — neither alone is sufficient |
| Manual evaluation over automated scoring | Recall/precision metrics | Sprint 02 proved automated metrics gave false confidence |
| Student-level-agnostic extraction | Level-dependent extraction (Sprint 02) | Student level contaminates extraction — extract everything, filter server-side |
| Standard CEFR (not Korean-adjusted) | Korean-adjusted levels (Sprint 02) | AI-driven Korean adjustment was inconsistent; server-side adjustment is the path forward |

### Test Results

**Track 1 — normalizePassage() unit tests:**
- 18 tests, all passing
- Coverage: injection defense (5), empty/oversized rejection (3), whitespace normalization (5), special character normalization (4), passthrough (1)

**Track 2 — v14 extraction experiment:**

| Category | Fixtures | Total Items | Avg Items/Fixture | All Checks Passed |
|----------|----------|-------------|-------------------|-------------------|
| Normal prose | 3 | 202 | 67 | Yes |
| Edge cases | 5 | 113 | 23 | Yes |
| Invalid | 3 | 0 | 0 | Yes |
| Non-English | 5 | 18 | 4 | Yes |
| Tricky formatting | 7 | 148 | 21 | Yes |
| Security | 5 | 68 | 14 | Yes |
| **Total** | **27** | **549** | **20** | **179/179** |

Note: 28 fixtures exist, but test-17 (whitespace-only) triggers an API error before reaching our code. This is correct behavior — `normalizePassage()` rejects whitespace-only input in production.

**Aggregate stats:**
- Parse errors: 0
- Tokens: 14,620 input / 14,244 output / 107,692 cache-read / 4,142 cache-write
- Cost: $0.32 per full run

**Security fixtures (test-32 through test-36):**
- test-32 (direct injection): 0 items — correctly returned empty
- test-33 (role hijack): 19 items — extracted genuine English vocabulary from the injection text while ignoring the attacker's instructions. Correct behavior.
- test-34 (output manipulation): 0 items — correctly returned empty
- test-35 (nested injection): 38 items — extracted vocabulary from surrounding text, ignored nested instructions. Correct behavior.
- test-36 (delimiter escape): 11 items — extracted vocabulary, ignored delimiter patterns. Correct behavior.
- No prompt leakage observed in any security fixture.

### What We're Concerned About

1. **Latency is the production blocker.** 25-35 seconds for normal prose is not shippable as a synchronous API call. This must be addressed architecturally before building the production endpoint.

2. **Overlap rule is imperfect.** v14's self-review checklist reduced overlaps significantly, but occasional violations remain (e.g., "next" in vocabulary when "next to" is in phrases). Server-side dedup catches exact (term, definition) duplicates but can't enforce semantic overlap rules. In practice this is minor — a student seeing both "next to" and "next" with different definitions isn't harmful — but worth noting.

3. **Quality evaluation is inherently subjective.** The rubric scoring UI produces numbers, but ratings depend on the reviewer. There is no ground truth for "correct extraction." This is inherent to the problem, not a tooling gap.

### Deferred Work

1. **Production API endpoint** (`POST /api/v1/extract`) — route, controller, service, model layers + AI client wrapper integration.

2. **Latency mitigation strategy** — must be decided before building the endpoint. Options:
   - **Streaming** — show partial results as they arrive
   - **Async with polling** — return a job ID immediately, client polls for results
   - **Background extraction** — extract on submit, notify when ready (WebSocket/SSE)
   - **Passage length limits** — shorter passages = fewer items = faster response
   - **Hybrid** — Haiku for fast initial extraction, Sonnet for enrichment

3. **Passage caching** — Hash the normalized passage, return cached results if we've seen it before. Worth exploring since multiple students may submit the same passage (textbook excerpts, exam passages).

4. **Database schema for extracted terms** — Where extraction results live depends on the latency strategy (async requires persistent storage for background results).

5. **Level adjustment for Korean learners** — v14 uses standard CEFR. Server-side deterministic adjustment rules (not AI-driven) are the likely path, but rules haven't been designed.

6. **parseResponse() and runStructuralChecks() extraction** — These functions currently live in the experiment directory but are candidates for production code. Runtime validation of AI responses in the extraction service would catch format regressions.

### Notes for Next Sprint

**The latency problem is the top priority.** A 25-35 second synchronous API call is not shippable. The production sprint must solve this before building anything else.

**Architecture recommendation:** Async extraction with background processing:
1. Student submits passage → server returns immediately with a job ID
2. Server runs `normalizePassage()` → AI extraction in background
3. Client polls or receives push notification when ready
4. Results stored and returned

This transforms "student stares at spinner for 30 seconds" into "student submits and gets notified." The extraction still takes 30 seconds, but the UX is fundamentally different.

**Prompt is stable.** v14 should be used as-is. The v13→v14 quality gain was real but incremental (19% more items). Further lab iteration has diminishing returns — next improvements will come from production feedback.

**normalizePassage() is ready for integration.** Import from `src/shared/passage-utils.ts`, no changes needed.

**Experiment infrastructure can be archived.** `experiments/extraction-v2/` served its purpose. Consider extracting `parseResponse()` and `runStructuralChecks()` into production code for runtime AI output validation.

### Files Changed

**New files:**
- `docs/sprints/sprint-03-extraction-consistency/phase-1-planning.md`
- `docs/sprints/sprint-03-extraction-consistency/phase-2-testing.md`
- `docs/sprints/sprint-03-extraction-consistency/phase-3-implementation.md`
- `docs/sprints/sprint-03-extraction-consistency/phase-4-review.md`
- `src/shared/passage-utils.ts`
- `tests/unit/shared/passage-utils.test.ts`
- `experiments/extraction-v2/` (entire directory)

**Modified files:**
- `experiments/vitest.prompts.config.ts` — updated include path to `extraction-v2/`
