# Sprint 02 — Word Extraction from Text

## Phase 3: Implementation

### What Was Built

Sprint 02 was an R&D sprint focused on prompt experimentation for AI-powered vocabulary extraction. No production server code was written — the entire sprint was about discovering how to reliably extract learning-relevant terms from English text using Haiku.

#### Infrastructure Built

1. **Parallel runner** (`experiments/extraction/parallel-runner.ts`) — Orchestrates multiple Anthropic API calls in parallel, handles server-side post-processing, and supports prompt versioning (v5 through v11).

2. **Prompt versioning system** — 11 prompt versions (v1–v11) stored as text files in `experiments/extraction/prompts/`, each representing a different extraction philosophy. Version detection controls architecture (3-call vs 2-call), tool schemas, and post-processing logic.

3. **36 test fixtures** — Covering normal scenarios (3 passages × 3 student levels), edge cases (bare word lists, dense polysemy/phrases, proper nouns, very short text, above/below level), invalid input (empty, random, numbers), non-English input (Korean, Spanish, Chinese, mixed), tricky content (HTML, uppercase, emojis, URLs, typos, abbreviations), and prompt injection attacks.

4. **Automated scoring pipeline** — Checker (structural validation), scorer (recall, level accuracy, precision, textFit), and HTML reporter with per-call raw JSON output, metric breakdowns, and comparison views.

5. **Comparison report** (`extraction-approach-comparison.md`) — Detailed analysis of old approach (v5–v7) vs new approach (v10), covering every dimension of the design shift.

#### Prompt Evolution

Each version taught us something specific about what the AI can and cannot do:

| Version | Architecture | Key idea | What we learned |
|---------|-------------|----------|-----------------|
| v1 | Single call, JSON output | One prompt does everything | AI wraps JSON in markdown, returns empty lists, echoes student level as term level |
| v2–v4 | Single call, tool use | Force structured JSON via function calling | Tool use solved the format problem. Level accuracy still poor — AI echoes student level. |
| v5 | 3 parallel calls | Separate prompts for phrases, polysemous, vocabulary | Parallel calls work. Phrase recall still low (~30-70%). |
| v6 | 3 parallel calls | Korean pain point philosophy in prompt | Better phrase selection but form problems — AI attaches verbs to preposition phrases. |
| v7 | 3 calls + reviewer | Producer extracts aggressively, reviewer filters | Reviewer made things WORSE. "Would a Korean student struggle with this?" is too subjective for Haiku. |
| v8 | 3 parallel calls | Mechanical type classification, server-side filtering | Server-side type filtering worked but added complexity. Korean pain point still too subjective in level rating. |
| v9 | 2 parallel calls | Combined polysemous+vocabulary into single "words" call with nonDefaultSense flag | Reduced API calls. Added worthStudying + rationale. Korean school stage mapping for levels. |
| v10 | 2 parallel calls | Clean consolidation of v9, simplified filenames | Same contradictions as v9 — AI's worthStudying and levels flip-flop depending on student level for the same text. |
| v11 | 2 sequential calls | Extract all terms with definitions (no levels), then rate new terms separately | Final design. Separates extraction (mechanical) from rating (judgment). Student level removed from extraction entirely. |

#### Server-Side Logic Evolution

The server's role changed dramatically across versions:

**v5–v7 (heavy server):**
- +1 level bump for non-literal phrases
- A2 floor enforcement
- Literal vs non-literal classification
- Cross-list dedup with strict priority (polysemy > phrases > vocabulary)
- Range filtering per list
- Form fixing (strip verbs from preposition phrases, trim phrasal verbs)

**v8–v9 (transitional):**
- Type-based filtering moved to prompt, then back to server, then to prompt again
- worthStudying filter added
- Cross-list dedup removed
- +1 bump removed

**v10 (minimal server):**
- worthStudying filter
- Range filter
- Within-list dedup
- textFit computation

**v11 (redesigned):**
- Paragraph splitting
- DB lookup for existing (term, definition) pairs
- Range filter by student level (using DB-stored levels)
- textFit computation

#### Key Code Changes in This Session

1. **parallel-runner.ts** — Complete rewrite. Version-aware routing (`runV9` vs `runLegacy`), numeric version parsing, 2-call architecture for v9+, per-call raw JSON tracking.

2. **reporter.ts** — Added per-call raw JSON dropdowns (phrases, words, polysemous, vocabulary), version-aware rendering.

3. **extraction.test.ts** — Added perCallRaw passthrough to result entries.

4. **Fixtures test-01 through test-06** — Updated for v10 philosophy: Korean-adjusted levels (no +1 bump), expanded phrase targets, cleaned mustNotContain lists.

5. **12 new prompt files** — v8 through v11 prompt iterations.

6. **extraction-approach-comparison.md** — Full comparison document of old vs new approach.

### Why Each Change Was Made

#### Removing the +1 Level Bump

The bump was meant to represent Korean students' extra difficulty with non-literal phrases. But it was a fixed arithmetic adjustment applied to a nuanced problem — an idiom might deserve +2, a semi-transparent collocation might deserve +0. We moved the adjustment into the AI's level rating instructions (Korean school stage mapping), which lets the AI apply proportional adjustment. When we later discovered the AI couldn't do this consistently either (levels flip-flopped between student levels), we moved level rating into a separate, context-free call (v11).

#### Dropping Atomic Form Enforcement

We tried every approach to get Haiku to return "next to" instead of "sit next to": prompt instructions, examples, a reviewer pass, server-side form fixing with hardcoded verb lists. None worked reliably. The insight: form normalization is a losing battle with Haiku because it requires understanding which words are "part of the pattern" vs "context" — a subjective judgment. We accepted non-atomic forms as a minor precision loss that buys major recall and consistency gains.

#### Removing Cross-List Dedup

The strict priority rule (polysemy > phrases > vocabulary) dropped valid learning targets. "get the right answer" (phrase) and "right" (polysemous, meaning "correct") teach completely different things. Removing dedup lets each list serve its purpose independently. In v11, the concept becomes moot — a single extraction call returns everything, and the server categorizes.

#### Combining Polysemous + Vocabulary

Two separate prompts that both analyze individual words were redundant. A single "words" call with a `nonDefaultSense` boolean is simpler, cheaper (2 API calls instead of 3), and more consistent (one AI judgment per word instead of two prompts potentially disagreeing).

#### Adding worthStudying + Rationale (and Then Removing It)

We added worthStudying to let the AI make pedagogical decisions per term. The rationale field was meant to make the AI's reasoning transparent and consistent. Testing revealed the opposite: the AI contradicted itself across student levels. "have breakfast" was worthStudying=true for A1 ("Korean students say 'eat breakfast'") and worthStudying=false for A2 ("predictable and taught early"). The Korean pain point didn't change — only the student level did. This proved that pedagogical filtering cannot be an AI responsibility. In v11, worthStudying is removed entirely; the server handles all student-level logic.

#### The v11 Redesign: Separate Extraction from Rating

The fundamental insight from 11 prompt versions: **the AI is excellent at mechanical extraction and terrible at pedagogical judgment.** v11 splits these:

1. **Extraction** (mechanical): "Here's text. List every word and phrase with its dictionary definition." No levels, no student info, no filtering. Haiku excels at this.

2. **Rating** (judgment, but context-free): "Here are (term, definition) pairs. Rate each by CEFR level for a Korean student." No passage context, no student level. One consistent rating per (term, definition) pair, stored in DB forever.

3. **Filtering** (server, deterministic): Student level determines what they see. Pure arithmetic. Never changes, never contradicts itself.

This separation means:
- The same passage always produces the same extraction (deterministic for a given model)
- Level ratings are assigned once and cached in DB (cost decreases over time)
- Student-level filtering is entirely server-side (no AI inconsistency)
