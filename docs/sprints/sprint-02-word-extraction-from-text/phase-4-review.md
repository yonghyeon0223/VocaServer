# Sprint 02 — Word Extraction from Text

## Phase 4: Review

### Sprint Outcome

Sprint 02 achieved its primary objective: **we now have a proven extraction architecture and know exactly what the AI can and cannot do.** The sprint did not produce a production-ready prompt — instead, it produced something more valuable: a clear understanding of where the AI/server boundary should be, validated through 11 prompt iterations and extensive testing.

### What Succeeded

1. **Experiment infrastructure works.** The parallel runner, fixture system, checker, scorer, and HTML reporter form a reusable testing framework. The framework correctly identified problems with every prompt version and gave clear signal about what was failing and why.

2. **Tool use (function calling) solved the format problem permanently.** After v1's markdown-wrapped JSON and empty list disasters, switching to Anthropic's tool_use guaranteed structured output. This was never a problem again.

3. **Parallel architecture works.** 2–3 parallel Haiku calls complete faster than a single Sonnet call and produce better results because each call has a focused task. This validated the "many small calls" strategy over "one big call."

4. **36 fixtures cover the full input space.** Normal scenarios, edge cases, invalid input, non-English, tricky content, and prompt injection attacks. The fixture matrix is reusable for Sprint 03.

5. **The AI excels at mechanical extraction.** When asked to simply list words and phrases with definitions (v11 approach), Haiku is thorough and consistent. The problems only arise when we ask it to make judgment calls.

### What Failed

1. **AI-driven level assignment is inconsistent.** Levels for the same phrase changed depending on student level, prompt wording, and even run-to-run variation. "put on" was rated A1, A2, or B1 depending on context. This inconsistency is fundamental — not fixable by better prompting.

2. **AI-driven pedagogical filtering contradicts itself.** worthStudying rationales for the same phrase directly contradicted across student levels. "have breakfast" was essential for A1 students and worthless for A2 students, with the rationale flipping from "Korean students need this" to "predictable and taught early." The underlying Korean difficulty didn't change.

3. **Korean pain point philosophy is too subjective for Haiku.** Every attempt to encode "would a Korean student struggle with this?" into a prompt produced inconsistent results. v6's detailed Korean grammar comparison, v7's reviewer, v8's type classification, v9's school stage mapping — all failed to produce stable output.

4. **Atomic form enforcement is a losing battle.** Haiku consistently attaches verbs to preposition phrases and adds trailing context to phrasal verbs. No combination of prompt instructions, examples, reviewer passes, or server-side fixing solved this reliably.

5. **Complex server rules are brittle.** The +1 bump, A2 floor, literal/non-literal classification, and cross-list dedup all introduced edge cases faster than they solved problems. Each rule worked for some fixtures and broke others.

### Key Lessons

1. **Separate extraction from judgment.** The AI should extract (mechanical, consistent) and the server should judge (deterministic, cacheable). Mixing these in one call produces inconsistency.

2. **Never put student level in the extraction prompt.** It contaminates everything — levels, filtering decisions, even which terms the AI notices. Extraction should be universal for a given text.

3. **Cache AI judgments in the database.** Level ratings for (term, definition) pairs should be computed once and stored forever. This eliminates run-to-run variation and reduces cost over time.

4. **Simpler prompts produce better results.** v11's extraction prompt is 15 lines. v6's was 50+ lines with detailed Korean grammar explanations. The simpler prompt is more consistent because Haiku has less to misinterpret.

5. **Test infrastructure is never wasted.** The checker, scorer, and reporter framework will carry forward to Sprint 03. The fixtures need updating for the new schema but the test scenarios remain valid.

### Deferred Work

Everything below moves to Sprint 03:

1. **v11 implementation and testing** — Build the two-call pipeline (extract + rate), test against fixtures adapted for the new schema.

2. **Database schema for (term, definition, level)** — Design the collection that caches AI-rated terms.

3. **Paragraph splitting logic** — Server-side text chunking before extraction.

4. **Production API endpoint** — `POST /api/v1/extract` that runs the full pipeline.

5. **Fixture updates for v11 schema** — Existing fixtures need adapting from three-list targets to universal extraction targets.

6. **P2 and P3 fixture review** — test-07 through test-09 (P3 모의고사 passage) were not updated in this sprint. All fixtures need review under the v11 philosophy.

### Notes for Sprint 03

**Architecture to implement:**
```
Text → split paragraphs (server)
     → v11-extract per paragraph (Haiku, parallel)
     → deduplicate (term, definition) pairs (server)
     → check DB for existing pairs (server)
     → new pairs → v11-rate (Haiku, batch)
     → store rated pairs in DB (server)
     → filter by student level (server)
     → return to client
```

**Key decisions already made:**
- Extraction prompt is student-level-agnostic
- Level rating uses Korean school stage bias
- Definitions reference standard dictionary (Oxford Learner's)
- Levels are cached in DB — rated once, used forever
- Server handles all student-level filtering
- No cross-list dedup — overlaps are allowed
- No +1 bump, no A2 floor, no literal/non-literal distinction

**Open questions for Sprint 03 planning:**
- Should the extraction call run per-paragraph or per-text? Per-paragraph reduces per-call complexity but increases call count.
- How to batch the rating call — all new terms in one call, or chunked?
- DB schema: separate collection or embedded in a larger document?
- How to handle definition variations — "run" defined as "to manage" vs "to manage or operate" are semantically identical but string-different. Fuzzy matching? Normalization?
- Should the rating prompt see part of speech? (Probably yes — helps disambiguate.)
- Cost budget: extraction is per-text (always runs), rating is per-new-term (amortizes). Model the expected cost per extraction request.

### Test Results

Sprint 02's test results are exploratory, not pass/fail. Key observations from the final v10 run on P1 fixtures:

- **Phrase recall for A1 student:** ~43% (6/14 terms found) — AI finds phrasal verbs and collocations but misses discourse patterns and over-filters with worthStudying
- **Phrase recall for A2 student:** ~13% (1/8 terms found) — worthStudying filter kills almost everything
- **Phrase recall for B1 student:** ~100% (1/1 term found) — only "run like the wind" survives, which the AI consistently finds
- **Level accuracy:** Poor — AI rates most phrases A1 instead of Korean-adjusted A2, ignoring the school stage instructions
- **textFit:** Inconsistent — "appropriate" for A1 when "stretch" expected

These results confirm the decision to move to v11's separated architecture in Sprint 03.

### Files Changed

**New files:**
- `docs/sprints/sprint-02-word-extraction-from-text/extraction-approach-comparison.md`
- `docs/sprints/sprint-02-word-extraction-from-text/phase-3-implementation.md`
- `docs/sprints/sprint-02-word-extraction-from-text/phase-4-review.md`
- `experiments/extraction/prompts/v8-phrases-produce.txt`
- `experiments/extraction/prompts/v8-polysemous.txt`
- `experiments/extraction/prompts/v8-vocabulary.txt`
- `experiments/extraction/prompts/v9-phrases-produce.txt`
- `experiments/extraction/prompts/v9-polysemous.txt`
- `experiments/extraction/prompts/v9-vocabulary.txt`
- `experiments/extraction/prompts/v9-words.txt`
- `experiments/extraction/prompts/v10-phrases.txt`
- `experiments/extraction/prompts/v10-words.txt`
- `experiments/extraction/prompts/v11-extract.txt`
- `experiments/extraction/prompts/v11-rate.txt`

**Modified files:**
- `experiments/extraction/parallel-runner.ts` — Complete rewrite for version-aware routing, 2-call architecture, per-call raw JSON tracking
- `experiments/extraction/reporter.ts` — Per-call raw JSON dropdowns, version-aware rendering
- `experiments/extraction/extraction.test.ts` — perCallRaw passthrough
- `experiments/extraction/fixtures/test-01-elementary-a1-student.json` — Korean-adjusted levels, expanded targets
- `experiments/extraction/fixtures/test-02-elementary-a2-student.json` — Same
- `experiments/extraction/fixtures/test-03-elementary-b1-student.json` — Same
- `experiments/extraction/fixtures/test-04-middle-school-a2-student.json` — Same
- `experiments/extraction/fixtures/test-05-middle-school-b1-student.json` — Same
- `experiments/extraction/fixtures/test-06-middle-school-b2-student.json` — Same
