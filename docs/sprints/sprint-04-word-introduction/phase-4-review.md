# Sprint 04 — Word Introduction Prompt Experimentation

## Phase 4: Review

### Objectives vs Outcomes

**Original objective:** Battle-test and iterate the word introduction prompt — the AI-generated interactive learning experience that introduces extracted terms to Korean learners.

**Outcome:** Delivered. The prompt went through 32 rounds of feedback-driven iteration. No production code shipped (as planned). The deliverable is a stable v1 prompt, experiment infrastructure, and a documented body of feedback ready for future sprint production integration.

### What Changed from Planning

| Planned | Actual | Why |
|---------|--------|-----|
| Reasoning block in output JSON | Removed — AI reasons internally | Extended thinking incompatible with forced tool_choice. Reasoning in output wastes tokens. AI follows the procedure without externalizing it. |
| importance as input (0-4) | Removed entirely | User decided: if a learner chose to study a term, it's equally important. Turn count driven by level only. |
| level = learner proficiency | level = term's objective CEFR difficulty | Learner level is not provided. Level determines turn count and complexity. |
| 11 problem types | 12 — added WD (구성 요소 분해) | Emerged from discussion about etymology/decomposition. Became the highest-priority type for B1+. |
| 3-4 options per turn | 2-3, with 2 as default | 3 only when all choices genuinely compelling. Eliminates filler options. |
| Max 5 explore turns | Max 4 | C2 testing showed 4 turns sufficient. Considered reducing to 3 but kept 4 after C2 validation. |
| Extended thinking for reasoning | Abandoned | `tool_choice: {type: "tool"}` and `tool_choice: {type: "any"}` both rejected by API when thinking enabled. |
| temperature 0.7 | temperature 0.3 | Results will be cached in production — reproducibility matters. |
| Rubric scoring in report | Replaced with interactive playthrough + free-text feedback | More natural review workflow. Feedback saved via local server. |

### Experimentation Progress

#### Test Runs

| Batch | Terms | Focus | Key Findings |
|-------|-------|-------|-------------|
| Batch 1 | cat, give up, end up in, bounced back, counterintuitive | Breadth (A1-C1) | Established baseline. Found: definition paraphrasing problem, English sentence overuse in options. |
| Batch 2 | happy, polysemous, renewable energy sources, go back to square one, data | Edge cases | Importance 0 terms, long expressions, Korean cognates. |
| Batch 3 | opportunity cost, runs a tight ship, cutting corners, far-reaching, runs like the wind | WD focus | Validated WD Type A (decompose→assemble) works well for phrases. |
| Batch 4 | paradox of choice, decision fatigue, fatigue, paralyze, mitigate | Scene diversity | All from test-07 — tested if scenes diversify despite shared source. |
| Batch 5 | playground, turtle, delicious, forgot, visited | Simple terms | Tested if prompt stays interesting for trivially easy words. |
| Batch C2 | ubiquitous, pernicious, ameliorate, juxtapose, acquiesce | C2 SAT terms | Validated 4 turns add unique value. Decided to keep max 4. |
| Final test 1 | 15 terms (A1-C2) | Full spread | Post-feedback validation. Found: definition direct translation persists, MU response confusion. |
| Final test 2 | 20 terms (A1-C2) | Comprehensive | Largest batch. Found: name repetition (재하), turn-to-turn context reuse, English not explained in feedback. |
| Final test 3 | 5 terms (B1-C1) | Final validation | dilute, at the expense of, entail, fall short of, tangible. Parse failures still occur intermittently. |

#### Parse Failure Analysis

Sonnet 4.6 intermittently stringifies JSON fields instead of returning objects. Root cause: unescaped Korean double quotes inside JSON strings (e.g., dialogue with `"어머!"` breaks the JSON structure).

**Mitigation implemented:**
- 4-strategy JSON repair pipeline in parser
- Up to 2 automatic API retries
- Prompt instruction: use single quotes/꺾쇠 for Korean dialogue, never double quotes

**Remaining risk:** ~5-10% of calls still produce malformed output on first attempt. Retry resolves most cases. In production, a 3rd retry or fallback should be considered.

### 32 Feedback Rounds — Summary

Feedbacks grouped by theme:

**Prompt Philosophy (5)**
- Korean equivalents mandatory — don't paraphrase definitions
- term/단어/표현 terminology boundaries
- importance removed, level redefined
- Discovery philosophy clarified: hiding Korean equivalents was never the intent

**Question Design (10)**
- WD type added and redesigned with "왜 이렇게 만들었을까?" approach
- Target term all-or-none in options (not just intro)
- Options self-contained (no label-only selection)
- CP tautology ban
- 2 options default, 3 only when all compelling
- "모르겠다" optional, not mandatory
- Bold key conditions in questions
- MU reverse-question response clarity
- 5-step final review added
- Turn-to-turn context diversity

**Language Rules (5)**
- English scope restricted to learning-relevant terms
- Parenthetical translation ban
- English explanation mandatory in feedback
- New English in feedback needs Korean gloss
- Colloquial ending examples removed (caused unnatural ~거든 repetition)

**Structural (7)**
- Intro-explore overlap ban
- Turn ordering: no fixed template
- Natural acquisition priority (WD/CP/MU/CL/IN)
- WD highest priority for B1+
- Age-neutral scenes
- Diverse character names (server-side injection)
- Learning objectives + closing turn added

**Technical (5)**
- Token optimization (compact JSON, symbols)
- Extended thinking abandoned
- Temperature 0.3
- Auto-retry on parse failure
- JSON repair pipeline

### Remaining Room for Improvement

#### Prompt Quality Issues Still Observed

1. **Label-only options still appear occasionally** — Despite "절대 금지" instruction and 금지 사항 entry, Sonnet sometimes falls back to ①번/②번 style. May need structural enforcement in the schema rather than prompt instruction alone.

2. **English in feedback not always explained** — Feedback #27 added the rule, but compliance is inconsistent. High-level terms (C1+) are more likely to have unexplained English in feedback. This may improve with more prompt emphasis or few-shot examples (at the cost of bias).

3. **Scene/name diversity** — Server-side name injection (40-name pool via word hash) solves repetition. Scene diversity still relies on the prompt instruction, which generally works but some terms in similar domains (business terms) may get similar office scenarios.

4. **Parse failures** — 5-10% first-attempt failure rate. The repair pipeline catches most cases, but production should consider: (a) streaming to catch partial output, (b) structured output mode if Anthropic adds thinking+forced tool support, (c) Sonnet model updates may improve compliance.

5. **Turn quality variance** — Later explore turns (3rd, 4th) sometimes feel weaker than earlier ones. The AI may be running low on genuine insights for simple terms. The max-4-turn cap helps, but some terms genuinely only need 2 turns.

#### Architecture Decisions Deferred

1. **Caching strategy** — Same (word, definition, level) should produce the same introduction. Production needs a cache layer (DB or Redis) to avoid redundant API calls. Temperature 0.3 supports this.

2. **Batch generation** — Currently one API call per term. Batching multiple terms per call could reduce per-term overhead, but risks degraded quality per term and complicates error handling.

3. **Haiku evaluation** — Ruled out early based on prior Sprint 02-03 experience with Haiku's instruction-following limitations. Could revisit if Haiku improves, but the prompt complexity is high.

4. **Client rendering** — The HTML report is a reviewer tool. Production client rendering (React Native) needs: choice selection state, turn-by-turn progression, correct/incorrect visual feedback, summary card.

### Notes for Next Sprint

1. **Production integration** — The prompt is ready to be wired into a production API endpoint. The key decisions:
   - Where to call: `POST /api/v1/introduction` or as part of a wordset creation flow
   - Caching: cache by (word, definition, level) hash
   - Error handling: what to show the user when AI call fails or parse fails after retries
   - Rate limiting: introduction generation is expensive (~$0.04/term)

2. **CEFR level assessment** — Discussed at sprint start but deferred. The user expressed interest in adaptive testing but deprioritized it for this sprint. Could be Sprint 05 or later.

3. **Exercise/quiz generation** — The learning objectives (`l` field) are designed to feed into future exercise generation. Each objective is a testable statement that can become a quiz question.

4. **Prompt v2 considerations** — If production testing reveals systematic issues, consider:
   - Few-shot examples (trade-off: bias vs compliance)
   - Splitting into 2 calls: intro turn generation + explore turn generation (different system prompts, better focus)
   - Model upgrade path: if future Sonnet versions improve instruction following, some prompt guardrails can be relaxed

### Test Results

- **Total terms tested:** 93 fixtures, ~50+ actually run across 19 report batches
- **Structural check pass rate:** ~85-90% on first attempt, ~95%+ after retry
- **Parse failure rate:** ~5-10% first attempt (Sonnet stringification)
- **Total experiment cost:** ~$15-20 across all iteration runs
- **Prompt iterations:** 32 feedback rounds

### Sprint Duration

- Phase 1 (Planning): 2026-04-16 — 2026-04-17
- Phase 2 (Testing): 2026-04-17
- Phase 3 (Implementation + Iteration): 2026-04-17 — 2026-04-18
- Phase 4 (Review): 2026-04-19
