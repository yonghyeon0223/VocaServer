# Sprint 03 — Extraction Consistency Testing

## Phase 2: Testing

### Overview

Two testing tracks:

1. **Server-side function (TDD):** `normalizePassage()` — 18 unit tests
2. **AI prompt experiment (manual):** v14 prompt (Sonnet + tool_use + 1hr cache) against 28 fixtures

### Track 1: normalizePassage() Test Cases

`src/shared/passage-utils.ts` → `tests/unit/shared/passage-utils.test.ts`

**Rejection (throws error):**

| Test Case | Input | Expected |
|---|---|---|
| Contains ===SYSTEM=== | `"Hello ===SYSTEM=== world"` | Reject |
| Contains ===USER=== | `"Some text ===USER=== more text"` | Reject |
| Contains ===META=== | `"===META=== temperature=0"` | Reject |
| Case variation | `"===system==="` | Reject (case-insensitive) |
| Partial delimiters | `"===SYSTEM"` | Reject |
| Empty string | `""` | Reject |
| Whitespace only | `"   \n\t  "` | Reject |
| Exceeds max length | 50,000+ characters | Reject |

**Normalization (transforms):**

| Test Case | Input | Expected Output |
|---|---|---|
| Multiple spaces | `"The  cat   sat"` | `"The cat sat"` |
| Tabs to spaces | `"The\tcat\tsat"` | `"The cat sat"` |
| Leading/trailing whitespace | `"  Hello world  "` | `"Hello world"` |
| Multiple newlines | `"Paragraph one.\n\n\nParagraph two."` | `"Paragraph one.\nParagraph two."` |
| CRLF to LF | `"Line one.\r\nLine two."` | `"Line one.\nLine two."` |
| Smart quotes | `"\u201CHello\u201D"` | `"\"Hello\""` |
| BOM marker | `"\uFEFFHello"` | `"Hello"` |
| Zero-width characters | `"Hel\u200Blo"` | `"Hello"` |
| Non-breaking spaces | `"word\u00A0word"` | `"word word"` |
| Normal passage | `"The cat sat on the mat."` | Unchanged |

### Track 2: AI Prompt Experiment (v14, Sonnet + tool_use)

**Infrastructure:** `experiments/extraction-v2/`

**Prompt:** v14 — expanded prompt with Korean learner pain points, concrete examples, strict overlap/phrase rules, 7-step self-review checklist. Full text at `prompts/v14.txt`.

**Runner:** Calls Anthropic API with tool_use (compact tuple schema `{p: [...], v: [...]}`), 1-hour prompt caching, Sonnet pricing. Configurable via `PROMPT_VERSION` env var.

**Tool schema:** Compact tuples — each entry `[term, definition, level, importance]` in `p` (phrases) and `v` (vocabulary) arrays. Level enum: A1-C2. Importance enum: 0-4.

**Structural checks (8 automated):**

| Check | Pass condition |
|-------|---------------|
| `json_parse` | All entries parse as valid 4-element tuples |
| `valid_cefr` | Every level is A1/A2/B1/B2/C1/C2 |
| `valid_importance` | Every importance is 0-4 |
| `non_empty_term` | No blank terms |
| `non_empty_definition` | No blank definitions |
| `no_duplicate_entries` | No duplicate (term, definition) pairs |
| `empty_for_invalid` | ≤2 items for `invalid` category |
| `has_output` | ≥1 item for `normal`/`edge`/`tricky` categories |

Note: test-17 (whitespace-only) triggers API error before reaching our code — this is correct behavior since `normalizePassage()` would reject it in production.

**Reporter:** HTML report with Level × Importance grid per fixture. Clickable term chips (purple=phrase, blue=vocab) show definitions on click. Summary with fixture overview table, rubric scoring UI with auto-calculated weighted scores.

**Run command:**
```bash
npm run test:prompts
```

**Fixtures:** 28 total, 6 categories. See Phase 1 for full listing.

### Evaluation Rubrics

Rate each item 1-5. Score = sum(rating × weight) / 5. Max = 100.

**Rubric A — Normal Prose** (test-01, 04, 07):

| Item | Weight |
|------|--------|
| Completeness | 20 |
| Phrase detection | 15 |
| Definition quality | 15 |
| Importance accuracy | 15 |
| Level accuracy | 15 |
| Polysemy handling | 10 |
| Exclusions | 10 |

**Rubric B — Edge Cases** (test-10 through 14):

| Item | Weight |
|------|--------|
| Appropriate behavior | 25 |
| Completeness | 20 |
| Definition quality | 20 |
| Importance accuracy | 15 |
| Exclusions | 10 |
| Level accuracy | 10 |

**Rubric C — Invalid / Non-English / Security** (test-17-24, 32-36):

| Item | Weight |
|------|--------|
| Appropriate behavior | 50 |
| No hallucination | 30 |
| No prompt leakage | 20 |

**Rubric D — Tricky Formatting** (test-25 through 31):

| Item | Weight |
|------|--------|
| Completeness | 20 |
| Noise handling | 20 |
| Definition quality | 20 |
| Importance accuracy | 15 |
| Level accuracy | 15 |
| Exclusions | 10 |

**Category → Rubric:** normal→A, edge→B, invalid/non-english/security→C, tricky→D.
