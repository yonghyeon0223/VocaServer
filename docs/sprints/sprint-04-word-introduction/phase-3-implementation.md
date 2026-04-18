# Sprint 04 — Word Introduction Prompt Experimentation

## Phase 3: Implementation

### Overview

This sprint built experiment infrastructure for iterating on the **word introduction prompt** — the AI-generated interactive learning experience that introduces extracted terms to Korean learners. No production code was shipped. The deliverables are:

1. A battle-tested prompt (v1.txt) shaped by 32 rounds of feedback
2. Experiment infrastructure (runner, reporter, structural checks, feedback server)
3. 93 test fixtures across A1-C2 levels
4. 19 HTML reports documenting the iteration journey

### Experiment Infrastructure

#### File Structure

```
experiments/introduction-v1/
  prompts/v1.txt              # The prompt (iterated 32 times)
  fixtures/terms.json          # 93 terms across A1-C2
  runner.ts                    # Sonnet API caller with caching + retry
  structural-checks.ts         # 11 automated output validation checks
  reporter.ts                  # Interactive HTML report generator
  feedback-server.ts           # Local server for feedback persistence + report serving
  main.ts                      # Entry point with .env-based filtering
  .env                         # Batch configuration (gitignored)
  results/                     # Per-term JSON results (gitignored)
  reports/                     # HTML reports (committed)
```

#### Runner (`runner.ts`)

Calls Sonnet 4.6 via the Anthropic SDK with:
- **tool_use** with forced tool choice (`generate_introduction`) for guaranteed JSON schema
- **1-hour prompt caching** — system prompt + tool schema cached across batch calls
- **Temperature 0.3** — low for reproducibility (results will be cached in production)
- **8192 max tokens** — accommodates up to 4 explore turns with full responses
- **Deterministic name injection** — word hash selects from a 40-name pool to avoid repetition across independent sessions
- **Auto-retry** — up to 2 retries on parse failure (Sonnet occasionally stringifies JSON fields)

Variable substitution: `{{WORD}}`, `{{DEFINITION}}`, `{{LEVEL}}`, `{{NAME}}` injected into the user message template.

Filtering via environment variables:
- `WORDS=cat,give up` — filter by word text
- `LEVEL=B2` — filter by CEFR level
- `TERMS=term-01,term-06` — filter by term ID
- `PROMPT_VERSION=v1` — select prompt version

#### Structural Checks (`structural-checks.ts`)

11 automated pass/fail checks on every AI output:

| # | Check | What it validates |
|---|-------|-------------------|
| 1 | `json_parse` | Valid JSON matching schema |
| 2 | `intro_structure` | Scene + question + 2-3 option tuples |
| 3 | `target_balance` | Target term in all options or none (per turn) |
| 4 | `explore_count` | 1-4 explore turns |
| 5 | `explore_answer_valid` | Answer index within bounds |
| 6 | `explore_types_valid` | Type symbol from 12-type pool |
| 7 | `has_objectives` | 1-5 learning objectives |
| 8 | `has_summary` | Non-empty summary |
| 9 | `option_count` | 2-3 options per turn, each a valid [text, response] tuple |

JSON repair pipeline for Sonnet's intermittent stringification:
1. Direct `JSON.parse()`
2. Korean-context quote escaping
3. Inner quote replacement (all `"` → `'` in long strings)
4. Each field individually coerced via `coerceField()`

#### Reporter (`reporter.ts`)

Generates interactive HTML reports with:
- **Summary dashboard** — total terms, check pass rate, avg turns, cost, output tokens
- **Overview table** — per-term row with level, turns, checks, tokens, latency, cost
- **Per-term cards** (expandable):
  - Structural checks bar
  - **Playable intro turn** — click choices to reveal convergence responses (toggle, compare multiple)
  - **Playable explore turns** — click choices to reveal correct/incorrect feedback (green/red highlight)
  - Learning objectives list
  - Summary (closing turn)
  - Stats bar (tokens in/out, latency, cost, source fixture)
  - Feedback textarea with save button
- **Keyboard shortcut** — Ctrl+S saves all unsaved feedback

#### Feedback Server (`feedback-server.ts`)

Lightweight HTTP server (port 3456) that:
- Serves the latest HTML report at `http://localhost:3456`
- Lists all reports at `/reports`
- Accepts feedback via `POST /feedback` (persists to `feedback.json` + updates result files)
- CORS enabled for local development

### Prompt Design (v1.txt)

#### Output Schema (Compact)

```json
{
  "i": {
    "s": "scene text",
    "q": "question",
    "o": [["choice", "response"], ...]
  },
  "e": [
    {
      "t": "CX",
      "q": "question",
      "a": 0,
      "o": [["choice", "response"], ...]
    }
  ],
  "l": ["learning objective 1", ...],
  "s": "summary text"
}
```

Token-optimized: short keys, tuples instead of objects, answer as index instead of per-option booleans.

#### 12 Problem Types

| Symbol | Type | Korean |
|--------|------|--------|
| AR | Action/Result prediction | 행동·결과 예측 |
| CP | Comparison | 비교 |
| CR | Cause Reasoning | 원인 추론 |
| SC | Sentence Completion | 문장 완성 |
| OP | Opposite situation | 반대 상황 |
| CX | Context shift | 맥락 전환 |
| PD | Polysemy Distinction | 다의어 구분 |
| CL | Collocation | 콜로케이션 |
| IN | Intensity placement | 강도 배치 |
| MU | Misuse detection | 오용 판별 |
| MF | Morphological Form | 형태 변환 |
| WD | Word Decomposition | 구성 요소 분해 |

WD is prioritized for B1+ terms when decomposition is possible. WD has two sub-approaches: Type A (decompose→assemble for phrases) and Type B (pattern inference for prefixed/rooted words).

#### 5-Step Type Selection Procedure

1. **Generate candidates** for all 12 types (with target balance + length balance as built-in premises)
2. **Evaluate** on 4 criteria: nuance, importance to term, difficulty, natural acquisition difficulty (WD/CP/MU/CL/IN prioritized)
3. **Select and deduplicate** — remove overlaps between explore turns AND with intro turn
4. **Order by cognitive flow** — foundational context first, synthetic/confirmatory last, middle is expression-dependent
5. **Final review** — surface clues, balance, tautology, logic, Korean equivalents, English explanation coverage

#### Turn Count by Level

- A1-A2: 1-2 turns
- B1-B2: 2-3 turns
- C1-C2: 3-4 turns
- Maximum: 4 turns

#### 32 Feedback Iterations

The prompt was refined through 32 rounds of feedback:

| # | Feedback | Impact |
|---|----------|--------|
| 1 | WD type added | New problem type for word decomposition |
| 2 | WD redesign | "왜 이렇게 만들었을까?" approach with Type A/B |
| 3 | Turn ordering | No fixed template, expression-identity-based |
| 4 | Age-neutral scenes | No generation-specific trends |
| 5 | importance removed | Not an input — all terms equal |
| 6 | level = objective CEFR | Not learner proficiency |
| 7 | Vocabulary cap removed | AI decides appropriate level |
| 8 | Token optimization | Compact JSON, 2-letter symbols, max 3 options |
| 9 | Extended thinking abandoned | Incompatible with forced tool_choice |
| 10 | Temperature 0.3 | Reproducibility for caching |
| 11 | Definition direct translation ban | Use Korean equivalents, not English paraphrases |
| 12 | English sentence restriction | Learning-scope English only |
| 13 | Parenthetical translation ban | No `word (뜻)` in options |
| 14 | Example removal | Prevent AI bias |
| 15 | MU response clarity | Reverse-question confusion prevention |
| 16 | 2 options default | 3 only when all compelling |
| 17 | Intro-explore overlap ban | No redundant exploration |
| 18 | "모르겠다" optional | Only when genuinely needed |
| 19 | Bold key conditions | `**어색한**` in questions, never in options |
| 20 | term/단어/표현 distinction | "term" for generic reference |
| 21 | Korean equivalents mandatory | No roundabout explanations |
| 22 | Closing turn added | 1-3 sentence summary |
| 23 | Auto-retry on parse failure | Handle Sonnet stringification |
| 24 | Target term all-or-none | In all options or none |
| 25 | CP tautology ban | Concrete situation-based comparison |
| 26 | 5-step final review | Comprehensive quality gate |
| 27 | English explanation mandatory | Every English word/phrase in feedback |
| 28 | Natural acquisition priority | WD/CP/MU/CL/IN for hard-to-acquire senses |
| 29 | Learning objectives (l) added | 1-5 formal objectives for future exercises |
| 30 | Colloquial ending examples removed | AI self-selects natural Korean |
| 31 | Options self-contained | No label-only selection (①번, ②번) |
| 32 | Turn-to-turn context diversity | No scene/sentence reuse across turns |

#### JSON Parsing Robustness

Sonnet 4.6 intermittently stringifies JSON object fields instead of returning proper objects. The parser handles this with:
- `coerceField()` — attempts `JSON.parse()` on string values, with Korean quote repair fallback
- 4-strategy repair pipeline (direct parse → Korean quote escape → inner quote replacement → give up)
- 2 automatic API retries on complete parse failure

### Test Fixtures

93 terms total across 6 batches:

| Batch | Source | Count | Levels |
|-------|--------|-------|--------|
| Original v14 extraction | Sprint 03 results | 48 | A1-C2 |
| SAT terms | Manual selection | 5 | C2 |
| Final test 1 | Manual selection | 15 | A1-C2 |
| Final test 2 | Manual selection | 20 | A1-C2 |
| Final test 3 | Manual selection | 5 | B1-C1 |

### Cost Summary

Per-term cost (Sonnet 4.6 with prompt caching):
- Input: ~$0.001 (cached after first call)
- Output: ~$0.03-0.06 depending on turn count
- Total per term: ~$0.03-0.06
- Full 93-term run: ~$3-6

### NPM Scripts

```bash
npm run test:intro-prompt    # Run prompt test (reads .env for batch config)
npm run feedback-server      # Start feedback server on localhost:3456
```
