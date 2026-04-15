# Sprint 03 — Extraction Consistency Testing

## Phase 1: Planning

### Objectives

Two goals:

1. **Build production-ready passage normalization** — `normalizePassage()` validates and cleans raw user input before any AI call. Includes prompt injection defense. Tested with TDD, ships as production code.

2. **Validate AI extraction quality** — can Sonnet consistently extract and classify vocabulary from English passages in a single call? This sprint iterates on prompt design (v12→v14), testing extraction quality across 28 fixtures covering normal prose, edge cases, invalid input, non-English, tricky formatting, and prompt injection.

### Context: Production Architecture

The production pipeline (future sprint) will follow this workflow:

```
Student submits passage
  -> normalizePassage(): reject injection, validate, clean
  -> AI extraction on full passage (Sonnet, tool_use):
     extracts phrases and vocabulary with definitions,
     CEFR levels, and importance ratings
  -> Server filters results by student preferences
     (level range, review depth)
  -> Further API calls for learning material preparation
```

Caching strategy deferred. Sentence-level caching was rejected because importance is passage-level. All caching deferred to a production sprint.

**This sprint validates:** Whether a single AI extraction call produces outputs rich enough to support downstream personalization without additional AI calls.

### What We're Testing

A single prompt (v14) that asks Sonnet to:

1. **Extract phrases** — multi-word combinations that must be learned as units (phrasal verbs, idioms, collocations, light verbs, verb/adjective+preposition, discourse markers, grammar patterns, contractions in patterns)
2. **Extract vocabulary** — single English words A1+, with polysemous words extracted as separate entries per meaning
3. **Assign CEFR level** (A1-C2) — standard CEFR for each specific meaning
4. **Provide a concise definition** — learner-dictionary style, as used in the input
5. **Rate importance** (0-4) — considering both narrative comprehension and structural/visual cues

### Prompt Design (v14)

Full prompt at `experiments/extraction-v2/prompts/v14.txt`. Key characteristics:

- **Model:** Sonnet 4.6 (`claude-sonnet-4-6`)
- **Output:** tool_use with compact tuple schema `{ "p": [[term, def, level, imp], ...], "v": [...] }`
- **1-hour prompt caching** — system prompt + tool schema (~4,142 tokens) cached across calls
- **Phrase extraction test:** "would a learner who knows every word individually still get this wrong?"
- **Strict no-overlap rule:** words in phrases are NOT extracted in vocabulary, no exceptions
- **Server-side dedup:** parser removes duplicate (term, definition) pairs
- **Max 6 words per phrase**
- **No lemmatization** — exact form from input
- **Korean learner pain points** documented in prompt (phrasal verbs, collocations, verb/adj+preposition, discourse connectors, grammar patterns, modal verbs, degree adverbs)
- **7-step self-review checklist** before responding
- **Prompt injection defense** — dual layer (server + prompt)
- **Edge case handling** — empty input, non-English, mixed languages, HTML, URLs, adversarial input

**Output format example:**
```json
{
  "p": [
    ["take action", "to do something about a problem", "B1", 4],
    ["give up", "to stop trying", "A2", 3]
  ],
  "v": [
    ["ecosystem", "a community of living things and their environment", "B2", 4],
    ["right", "correct", "A1", 3],
    ["right", "opposite of left", "A1", 1]
  ]
}
```

### Prompt Evolution

| Version | Model | Output Format | Key Changes | Result |
|---------|-------|--------------|-------------|--------|
| v12 | Haiku | Pipe-delimited | First attempt, rationale fields | Parse failures — AI ignored newlines, produced markdown tables |
| v12 | Haiku | tool_use (keyed JSON) | Switched to tool_use | Zero parse errors, but Haiku quality limited |
| v13 | Sonnet | tool_use (compact tuples) | Sonnet, no rationale, definitions added, importance 0-4 | Good quality, $0.15/run, no caching |
| v14 | Sonnet | tool_use (compact tuples) | Expanded prompt for 1hr caching, Korean pain points, examples, self-review checklist, strict overlap/phrase rules | Best quality, $0.32/run with cache, 549 items across 28 fixtures |

### Fixtures

28 fixtures from Sprint 02, with duplicates and level-specific variants removed:

| Category | Count | Fixture IDs | Tests |
|----------|-------|-------------|-------|
| Normal prose | 3 | test-01, 04, 07 | Elementary, middle school, 모의고사 |
| Edge cases | 5 | test-10, 11, 12, 13, 14 | Bare wordlist, polysemy, phrases, proper nouns, very short |
| Invalid | 3 | test-17, 18, 19 | Empty, random chars, numbers only |
| Non-English | 5 | test-20, 21, 22, 23, 24 | Korean, Spanish, Chinese, Konglish, multilingual |
| Tricky formatting | 7 | test-25-31 | HTML, uppercase, emoji, URLs, repetitive, typos, SMS |
| Security | 5 | test-32-36 | Direct injection, role hijack, output manipulation, nested, delimiter escape |

Removed: test-02/03/05/06/08/09 (duplicate passages), test-15/16 (level-specific edge cases).

### Evaluation Method

**Track 1 — Server-side function (TDD):** `normalizePassage()` with 18 automated unit tests.

**Track 2 — AI prompt quality (manual review):** Run 28 fixtures through v14, generate HTML report with Level × Importance grid, review output quality. Manual assessment: extraction captures most important phrases and vocabulary, is mostly consistent across runs.

### Implementation Scope

**Production code:**

| Component | Location |
|-----------|----------|
| `normalizePassage()` | `src/shared/passage-utils.ts` |
| Unit tests (18) | `tests/unit/shared/passage-utils.test.ts` |

**Experiment infrastructure:**

```
experiments/extraction-v2/
  prompts/v12.txt, v13.txt, v14.txt
  fixtures/  (28 files, simplified format)
  results/   (raw API responses)
  reports/   (HTML reports)
  runner.ts, reporter.ts, structural-checks.ts, extraction.test.ts
```

### Cost

| Run | Model | Cache | Items | Actual Cost |
|-----|-------|-------|-------|-------------|
| v12 (Haiku) | Haiku | None | 315 | $0.07 |
| v13 (Sonnet) | Sonnet | None | 460 | $0.15 |
| v14 (Sonnet) | Sonnet | 1hr | 549 | $0.32 |

### Decisions Log

| Decision | Why |
|----------|-----|
| Sonnet over Haiku | Better instruction following, more accurate extractions, worth 4x cost |
| tool_use over pipe-delimited | Eliminates parse errors — AI inconsistently produced newlines/tables with plain text |
| Compact tuples over keyed JSON | Saves ~40-50% output tokens at $15/M |
| 1-hour prompt caching | Cuts input cost — 4,142 tokens cached at $0.30/M instead of $3.00/M |
| Two lists (p/v) over single list | Different extraction logic for phrases vs vocabulary |
| Definitions included | Essential for polysemy disambiguation |
| No rationale fields | Trust Sonnet, save tokens — tested in v12 with marginal benefit |
| Importance 0-4 | 0 handles word lists/fragments with no ranking basis |
| Standard CEFR | Korean-adjusted levels were inconsistent in Sprint 02 |
| No lemmatization | Avoids ambiguous lemma errors (left→leave vs left as adj) |
| Strict no-overlap rule | Words in phrases NOT in vocabulary, no exceptions |
| Max 6 words per phrase | Prevents full clause extraction |
| Caching deferred | Importance is passage-level, sentence caching doesn't work |
| splitSentences/computeSentenceHash removed | Caching deferred, functions were dead code |
| Dual injection defense | Server rejects delimiters + prompt ignores user instructions |
| Server-side dedup | Parser removes duplicate entries AI produces |
