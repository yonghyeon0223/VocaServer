# Sprint 04 — Word Introduction Prompt Experimentation

## Phase 1: Planning

### Objectives

Battle-test and iterate the **word introduction prompt** — the AI-generated interactive learning experience that introduces extracted terms to Korean learners. This is the app's core learning feature: after extraction identifies what to learn, introduction is how the learner actually learns it.

This sprint is purely experimental. No production code ships. The deliverable is a stable, thoroughly tested prompt and the reviewer feedback that shaped it.

### Context: Where This Fits in the Learning Pipeline

```
Student submits passage
  -> normalizePassage() (Sprint 03 — production-ready)
  -> AI extraction (Sprint 02-03 — v14 prompt stable)
  -> Server filters by student level
  -> ** AI word introduction (THIS SPRINT) **
     For each term the student should learn:
     Generate a branching interactive lesson
  -> Client renders the lesson locally (zero-latency interaction)
  -> Student navigates intro turn + explore turns by choosing options
```

**Key architectural insight:** The prompt generates the *entire* interaction tree in a single AI call. All possible user choices and their responses are pre-computed. The client just navigates the tree — no AI calls during the learning session. This sidesteps the latency problem entirely.

### What We're Testing

A single prompt that takes one term and generates:

1. **Intro turn** — A relatable Korean scenario where the target expression naturally fits. Presents a question with 2-4 choices (no correct answer). Each choice leads to a different story resolution where the target expression appears naturally.

2. **Explore turns (1-5)** — Quiz-style turns that probe the expression's "confusion terrain." Each turn uses one of 12 problem types (context shift, collocation, misuse detection, comparison, etc.). Each has a definitive correct answer with per-choice feedback.

3. **Reasoning block** — The AI's explicit analysis of why it chose specific problem types and ordering, forcing externalized reasoning rather than shortcuts.

### Input Schema

Each term provides four values to the prompt:

| Field | Type | Description |
|-------|------|-------------|
| `word` | string | The target term or expression |
| `definition` | string | The specific meaning to teach (constrains scope) |
| `level` | A1-C2 | Student's reading level — caps English vocabulary in options |
| `importance` | 0-4 | How deeply the student needs to learn this term |

**Importance scale (0-4):**

| Value | Semantics | Impact on generation |
|-------|-----------|---------------------|
| 4 | Critical to passage comprehension | Deep exploration (3-5 turns), production-level mastery |
| 3 | Important for full understanding | Solid exploration (2-4 turns) |
| 2 | Useful but not essential | Moderate exploration (2-3 turns) |
| 1 | Peripheral/supplementary | Light exploration (1-2 turns), recognition-level |
| 0 | Barely relevant / no signal | Minimal (1 turn max) |

**No original passage is provided.** This is intentional — context anchoring causes learners to associate expressions with specific situations rather than learning their typical usage patterns.

### Prompt Design Philosophy

Three core philosophies (in priority order):

1. **Discovery over delivery** — Learners discover meaning through situations and choices, never through direct explanation. The intro scene shows without telling. Explore turns test without lecturing.

2. **Fair stage** — Correct answers are reached through thinking, not surface clues. No target expression in intro choices. Uniform choice length/density. No language mixing within choices (except morphological questions). No evasive choices.

3. **Expression-specific exploration** — Each expression has a unique "confusion terrain." The AI analyzes this terrain and selects from 12 problem types, choosing only what this specific expression needs.

### Explore Turn Type Selection & Ordering

The prompt must instruct the AI to follow this procedure — **generate first, evaluate second, order third:**

1. **Generate candidate problems.** For each of the 12 types, draft a candidate problem for the target expression. Not all types will produce good problems — some will be weak or irrelevant. That's expected.

2. **Evaluate each candidate.** For each drafted problem, assess:
   - **Nuance**: Does this problem reveal something genuinely non-obvious about the expression?
   - **Importance to this expression**: Is this aspect essential for the learner to actually use this expression, or is it "nice to know"?
   - **Difficulty**: Is the problem appropriately challenging given the learner's level?
   - Rate each candidate 상/중/하 based on these factors combined.

3. **Select and deduplicate.** Pick 상-rated candidates. If two candidates reveal the same aspect (e.g., both CX and CL test "where is this expression used"), keep only the stronger one. Fill from 중-rated if turn count is too low for the expression's importance.

4. **Order by cognitive flow.** Two evidence-based principles:
   - **Foundational context first.** Turns that establish "where does this expression live" (typically CX, WD) go early. The learner needs a basic frame before details can stick (schema theory / cognitive load).
   - **Synthetic/confirmatory turns last.** Turns that require accumulated understanding (typically MU, MF) go late. These are integration checks, not introduction.
   - **Middle turns are expression-dependent.** The order of discourse function (AR), neighbor comparison (CP), collocation (CL), etc. is NOT fixed. Place whichever aspect is closest to the expression's *identity* earlier. For `conventional wisdom`, discourse function (반전 예고) is identity-defining. For `produce`, neighbor comparison (`make`, `create`) is identity-defining. The AI must judge this per expression.

**Avoid fixed type ordering.** There is no universal sequence that works for all expressions. The prompt explicitly tells the AI not to follow a default template.

### Scene Design: Age Neutrality

Scenes must be relatable across a wide age range of Korean learners (10대-60대). The prompt includes this guidance:

- **No generation-specific trends.** Do not rely on 20-30대 slang, latest platform references, or youth culture markers.
- **Universal Korean daily contexts:** 직장, 가족, 건강, 학업, 친구 관계, 쇼핑, 요리, 여행, 병원, 대중교통 — these work across all age groups.
- **Korean names and settings only.** 민준, 서연, 도윤, 지우 — not John, Mike, Emily. Cafes, offices, 학원, subway, family gatherings — not contexts that require cultural explanation.

### Explore Turn Type Symbols

Each of the 12 problem types is assigned a 2-letter symbol to save output tokens. These symbols are used in the `reasoning.tr` field and each explore turn's `t` field.

| Symbol | Type | Korean | When to use |
|--------|------|--------|-------------|
| `AR` | Action/Result prediction | 행동·결과 예측 | Discourse function (반전 예고, 입장 표명) |
| `CP` | Comparison | 비교 | Confusable neighbor expressions exist |
| `CR` | Cause Reasoning | 원인 추론 | Expression's origin/need is non-obvious |
| `SC` | Sentence Completion | 문장 완성 | Natural context pattern needs anchoring |
| `OP` | Opposite situation | 반대 상황 | Boundary best defined from the other side |
| `CX` | Context shift | 맥락 전환 | Basic "where does this expression live" |
| `PD` | Polysemy Distinction | 다의어 구분 | Multiple meanings, risk of confusion |
| `CL` | Collocation | 콜로케이션 감각 | Usage patterns and word partnerships |
| `IN` | Intensity placement | 강도 배치 | Strength spectrum among similar expressions |
| `MU` | Misuse detection | 오용 판별 | Formality/collectivity/nuance boundaries |
| `MF` | Morphological Form | 형태 변환 인식 | Plural, passive, part-of-speech traps |
| `WD` | Word Decomposition | 구성 요소 분해 | Prefix/suffix, phrasal verb particles, compound structure, Latin/Greek roots help unlock meaning |

**WD (구성 요소 분해) details:**

The core question WD asks is not "what does each piece mean?" but **"왜 이 조각들을 이렇게 합쳐서 이 개념을 표현하려 했을까?"** — why were these pieces assembled this way to capture this concept? This turns decomposition into linguistic exploration rather than vocabulary drilling.

**Two sub-approaches depending on term type:**

*Type A — Decompose → Assemble (for multi-word phrases, compound expressions, phrasal verbs):*
Present each component's meaning, then ask why combining them produces the expression's meaning. Choices represent different interpretive angles — each plausible but only one captures the real design intent.

Example (`bounced back`, B2):
> bounce = 바닥에 부딪혀 튀어 오르다, back = 원래 있던 자리로
>
> 이 두 감각을 합친 "bounced back"이라는 표현을 왜 만들었을까?
> 1. 넘어졌다가 다시 일어서는 과정을 공이 튀는 이미지로 담고 싶었으니까
> 2. 공을 누군가에게 다시 던지는 상황을 표현하고 싶었으니까
> 3. 천천히 원래 상태로 돌아가는 과정을 말하고 싶었으니까

Incorrect options are natural misinterpretations of the components (physical bounce, slow recovery), not absurd fillers.

*Type B — Pattern Inference (for prefixed/suffixed words, Latin/Greek roots):*
Show other words sharing the same root/affix, let the learner discover the pattern, then ask why the target word was assembled this way.

Example (`counterintuitive`, C1):
> counter**attack** = 반격, counter**part** = 상대편, intuitive = 생각하지 않아도 자연스럽게 아는
>
> 이 조각들을 합쳐서 "counterintuitive"라는 단어를 만든 이유는 뭘까?
> 1. "아무리 생각해도 이상한데, 실제로는 맞는 것"을 가리킬 말이 필요했으니까
> 2. "직감으로는 틀렸다고 느끼지만 논리적으로는 맞는 그 괴리감"을 한 단어로 담고 싶었으니까
> 3. "남들은 당연하다고 생각하는데 나만 이상하다고 느끼는 상황"을 표현하고 싶었으니까

**Feedback style for WD is deliberately more generous than other types.** The value of WD is in the explanation itself — the "아 그래서 이런 뜻이구나" moment. Correct-answer responses can be longer and more teaching-oriented than other types, because this is where structural understanding is built.

**Strong for:** prefixed words (`counter-intuitive`, `re-linquish`), phrasal verbs where particle carries meaning (`bounce` + `back`), compound expressions (`opportunity` + `cost`), Latin/Greek roots (`cogn-` in `cognitive`)
**Weak for:** single words with no decomposable structure (`cat`, `happy`), expressions where parts don't map to the whole meaning (`give up` — "give" + "up" doesn't explain "surrender")

### Output Schema (Compact)

Token-optimized output structure. Input fields (`word`, `level`, `importance`) are not echoed — they're known from the request. Options use `[text, response]` tuples instead of keyed objects. Correct answer stored as a single index instead of per-option booleans.

```json
{
  "r": {
    "ta": "Free-form terrain analysis of this expression's confusion landscape",
    "tr": "AR:상 CP:중 CR:하 SC:하 OP:하 CX:상 PD:하 CL:중 IN:하 MU:중 MF:하 WD:상",
    "st": "CX,CL — CP dropped (overlaps CX for this expression)",
    "tj": "importance 4 + B2 → 2-4 turns. 2 상-rated types → 2 turns."
  },
  "i": {
    "s": "Korean scenario text (no interpretation, no question)",
    "q": "Single question to the learner",
    "o": [
      ["Choice text", "Convergence message — story resolution with target expression"],
      ["Choice text", "Different convergence path"],
      ["Choice text", "Another path"],
      ["Choice text", "Confusion-expressing path"]
    ]
  },
  "e": [
    {
      "t": "CX",
      "q": "Question text for this explore turn",
      "a": 0,
      "o": [
        ["Choice text", "Feedback for this choice"],
        ["Choice text", "Feedback for this choice"],
        ["Choice text", "Feedback for this choice"],
        ["Choice text", "Feedback for this choice"]
      ]
    }
  ]
}
```

**Field reference:**

| Path | Type | Description |
|------|------|-------------|
| `r.ta` | string | Terrain analysis — confusion landscape of this expression |
| `r.tr` | string | Type ratings — all 12 types rated 상/중/하 after drafting candidate problems for each |
| `r.st` | string | Selected types with dedup reasoning + ordering justification (which aspect is identity-defining) |
| `r.tj` | string | Turn count justification (importance + level + terrain) |
| `i.s` | string | Intro scene (no interpretation, no question embedded) |
| `i.q` | string | Single question to learner |
| `i.o` | [text, response][] | Intro options — 2-4 tuples, no correct answer |
| `e[].t` | string | 2-letter type symbol from pool above |
| `e[].q` | string | Explore turn question |
| `e[].a` | integer | Index of correct option (0-based) |
| `e[].o` | [text, response][] | Explore options — 2-4 tuples |

**Estimated savings:** ~250-300 tokens/term vs verbose keyed JSON. Across 47 terms, ~12,000-14,000 output tokens saved per full run (~$0.18-0.21 at Sonnet pricing).
```

### Prompt Changes from User's v1 Draft

Three updates applied to the prompt before testing:

1. **Importance scale: `high/medium/low` → `0-4`**
   The extraction pipeline outputs importance as integers 0-4. The prompt's importance section is rewritten to use this scale directly, mapping each value to depth of exploration (see table above).

2. **Choice count: "3-4, default 4" → "2-4, prefer more when possible"**
   Updated to allow minimum 2 choices when only 2 quality options exist, while encouraging the AI to provide more options when it can construct them without sacrificing quality. The previous floor of 3 sometimes forced weak filler choices.

3. **Reasoning field added**
   New `reasoning` object in the output schema. The AI must externalize its confusion terrain analysis, type ratings, selection decisions, and turn count justification before generating content. This prevents the AI from shortcutting the 12-type evaluation process.

### Fixtures

47 terms selected from Sprint 03's v14 extraction results across 14 source passages. Selection maximizes variety across:

- **CEFR level**: A1 (9), A2 (9), B1 (9), B2 (9), C1 (8), C2 (3)
- **Importance**: 0-4 spread (heavier on 3-4 since that dominates real data)
- **Type**: 26 vocabulary + 21 phrases
- **Complexity**: concrete nouns, abstract concepts, phrasal verbs, collocations, idioms, discourse markers, adjectives, multi-word academic terms

Full fixture list in `experiments/introduction-v1/fixtures/terms.json`.

**Testing approach:**
- Run 5 terms at a time during iteration (quick feedback cycles)
- Full 47-term run after prompt stabilizes
- Each iteration: run → review in HTML report → write feedback → refine prompt → repeat

### Evaluation Method

**Structural checks (automated):**

| Check | What it validates |
|-------|-------------------|
| `json_parse` | Output is valid JSON matching compact schema |
| `has_reasoning` | All 4 reasoning fields (`r.ta`, `r.tr`, `r.st`, `r.tj`) are non-empty strings |
| `type_ratings_format` | `r.tr` contains all 12 type symbols (AR,CP,CR,SC,OP,CX,PD,CL,IN,MU,MF,WD) with 상/중/하 ratings |
| `intro_structure` | `i.s`, `i.q` present, `i.o` has 2-4 `[text, response]` tuples |
| `intro_no_target_in_options` | Target expression does not appear in any intro option text (`i.o[][0]`) |
| `explore_count` | `e` array has 1-5 elements |
| `explore_answer_valid` | Each `e[].a` is a valid index into its `e[].o` array |
| `explore_types_valid` | Each `e[].t` is one of: AR, CP, CR, SC, OP, CX, PD, CL, IN, MU, MF, WD |
| `option_count` | Every `i.o` and `e[].o` has 2-4 tuples, each tuple has exactly 2 strings |

**Manual review (in HTML report):**
- Play through the interaction (click choices, read responses)
- One feedback textarea per term — holistic notes saved to result JSON
- Focus areas: scene naturalness, choice balance, discovery vs. delivery, confusion terrain fit, Korean conversational tone

### Experiment Infrastructure

```
experiments/introduction-v1/
  prompts/
    v1.txt                    # Prompt (===SYSTEM===, ===USER===, ===META=== sections)
  fixtures/
    terms.json                # 47 terms array
  results/
    {word}_{version}_{timestamp}.json
  reports/
    report-YYYYMMDD-HHMMSS.html
  runner.ts                   # Calls Sonnet, saves results
  structural-checks.ts        # Validates output schema
  reporter.ts                 # Interactive HTML report
```

**Runner** — adapted from Sprint 03's extraction runner:
- Reads prompt file (===SYSTEM/USER/META=== format)
- Iterates over selected terms (filterable by level, importance, or term name)
- Substitutes `{{WORD}}`, `{{DEFINITION}}`, `{{LEVEL}}`, `{{IMPORTANCE}}` into user message
- Calls Sonnet with tool_use for structured output + 1-hour prompt caching
- Saves per-term result JSON with structural checks
- Environment variable filtering: `TERMS=...`, `LEVEL=B2`, `IMPORTANCE=4`, `PROMPT_VERSION=v1`

**Reporter** — new interactive design:
- **Summary dashboard**: total terms, pass/fail counts, cost, token usage
- **Per-term card** (expandable):
  - Term metadata (word, definition, level, importance, source fixture)
  - Structural checks bar
  - Reasoning block (terrain analysis, type ratings, selections, justification)
  - **Interactive intro turn**: scene text displayed, clickable choice buttons, clicking reveals that choice's response inline (can click different choices to compare)
  - **Interactive explore turns**: all turns visible, each with clickable choices showing correct/incorrect feedback. Correct choice highlighted green, incorrect red (after clicking)
  - Stats bar (tokens, latency, cost)
  - **Feedback textarea**: one per term, saves to result JSON's `feedback` field
- **Save mechanism**: JavaScript saves feedback back to a companion JSON file (`{reportId}-feedback.json`) that maps term → feedback text. Runner merges this into result files on next report generation.

### Tool Schema for Sonnet

```typescript
const INTRODUCTION_TOOL: Anthropic.Tool = {
  name: 'generate_introduction',
  description: 'Generate an interactive word introduction lesson for a Korean English learner.',
  input_schema: {
    type: 'object',
    properties: {
      r: {
        type: 'object',
        description: 'Reasoning — externalized confusion terrain analysis',
        properties: {
          ta: { type: 'string', description: 'Terrain analysis' },
          tr: { type: 'string', description: 'Type ratings: "AR:상 CP:중 ..." for all 12 types' },
          st: { type: 'string', description: 'Selected types with dedup reasoning' },
          tj: { type: 'string', description: 'Turn count justification' }
        },
        required: ['ta', 'tr', 'st', 'tj']
      },
      i: {
        type: 'object',
        description: 'Intro turn — scene + question + option tuples',
        properties: {
          s: { type: 'string', description: 'Scene text' },
          q: { type: 'string', description: 'Single question' },
          o: {
            type: 'array',
            description: 'Options as [text, response] tuples',
            items: {
              type: 'array',
              prefixItems: [
                { type: 'string', description: 'Choice text' },
                { type: 'string', description: 'Convergence response' }
              ],
              minItems: 2, maxItems: 2
            },
            minItems: 2, maxItems: 4
          }
        },
        required: ['s', 'q', 'o']
      },
      e: {
        type: 'array',
        description: 'Explore turns',
        items: {
          type: 'object',
          properties: {
            t: { type: 'string', description: '2-letter type symbol (AR,CP,CR,SC,OP,CX,PD,CL,IN,MU,MF,WD)' },
            q: { type: 'string', description: 'Question text' },
            a: { type: 'integer', description: '0-based index of correct option' },
            o: {
              type: 'array',
              description: 'Options as [text, response] tuples',
              items: {
                type: 'array',
                prefixItems: [
                  { type: 'string', description: 'Choice text' },
                  { type: 'string', description: 'Feedback response' }
                ],
                minItems: 2, maxItems: 2
              },
              minItems: 2, maxItems: 4
            }
          },
          required: ['t', 'q', 'a', 'o']
        },
        minItems: 1, maxItems: 5
      }
    },
    required: ['r', 'i', 'e']
  }
};
```

### Cost Estimate

**Per term (Sonnet 4.6):**
- Input: ~3,500 tokens (prompt) + ~100 tokens (term) = ~3,600 tokens
- With 1-hour cache: first call pays full input, subsequent calls pay ~100 tokens at $3/M + ~3,500 at $0.30/M = ~$0.001 input
- Output: ~1,500-3,000 tokens depending on explore turn count
- Output cost: ~$0.02-0.05 per term at $15/M

**Per 5-term iteration run:** ~$0.10-0.25
**Full 47-term run:** ~$1.00-2.50
**Expected total sprint (multiple iterations):** ~$5-15

### Decisions Log

| Decision | Why |
|----------|-----|
| Sonnet, not Haiku | Korean conversational tone + pedagogical sophistication requires Sonnet-level quality |
| tool_use output | Guarantees valid JSON structure, eliminates parsing failures (proven in Sprint 03) |
| 1-hour prompt caching | Prompt is ~3,500 tokens; caching saves 90% on input cost across batch runs |
| One AI call per term | Pre-generates entire interaction tree; client renders with zero latency |
| No original passage input | Prevents context anchoring — expressions taught in typical usage, not passage-specific |
| Reasoning field required | Forces externalized confusion terrain analysis; prevents AI from shortcutting the 12-type evaluation |
| 0-4 importance (not high/med/low) | Matches extraction pipeline output directly; finer granularity for turn count decisions |
| 2-4 choices (not 3-4) | Some expressions genuinely have only 2 strong angles; forcing 3 creates filler |
| Feedback stored in result JSON | Persists across report regenerations; readable by both human and machine for pattern synthesis |
| Mirror Sprint 03 infrastructure | Proven runner/reporter pattern; minimizes infrastructure iteration, maximizes prompt iteration |
