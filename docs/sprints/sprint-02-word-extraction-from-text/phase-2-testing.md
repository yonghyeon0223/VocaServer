# Sprint 02 — Word Extraction from Text

## Phase 2: Testing

### Test Strategy

This sprint has **two distinct test categories** that run via separate commands:

| Command | Purpose | Speed | Cost | Determinism |
|---------|---------|-------|------|-------------|
| `npm run test` | Framework code tests (runner/checker/scorer/reporter) | Fast (~seconds) | Free | Fully deterministic |
| `npm run test:prompts` | Prompt experiments (AI extraction quality) | Slow (minutes) | Real $$ | Non-deterministic |

The `npm run test:prompts` command supports environment variable filters: `FIXTURE`, `GROUP`, `PROMPT`, `DRY_RUN`, `FAIL_FAST`. See `experiments/.env.experiments.example` for full documentation.

**Why split:** Framework tests are normal unit tests — they verify our code parses prompts correctly, scores results correctly, generates valid HTML, etc. They must be fast, free, and deterministic. Prompt tests hit the Anthropic API — slow, cost money, produce different results each run. Mixing them would make the standard test suite unreliable.

**Test database:** Not needed this sprint. No production code, no MongoDB collections. The framework tests use mocked data and in-memory file operations where possible.

---

## Part A: Framework Code Tests

These tests verify the experiment runner infrastructure works correctly. They use mocked Anthropic responses (no real API calls), fixture files, and prompt files to test each component in isolation.

### Test File Structure

```
experiments/
  extraction/
    __tests__/
      runner.test.ts        # Tests for runner.ts (including filters)
      checker.test.ts       # Tests for checker.ts
      scorer.test.ts        # Tests for scorer.ts
      reporter.test.ts      # Tests for reporter.ts (including manual feedback schema)
      fixtures/             # Test fixtures used by these tests (not the AI test fixtures)
        valid-prompt.txt
        prompt-with-meta.txt
        prompt-missing-section.txt
        valid-fixture.json
        fixture-with-overrides.json
        fixture-with-groups.json
        invalid-fixture.json
        mock-ai-responses/
          valid-extraction.json
          invalid-json.txt
          empty-array.json
          extra-fields.json
          terms-with-phrases.json
```

These framework tests live in `experiments/extraction/__tests__/`. They're picked up by the standard `vitest.config.ts` (so `npm run test` runs them) but kept separate from the prompt experiment file (`experiments/extraction/extraction.test.ts`) which is only run by `npm run test:prompts`.

**Why `__tests__` folder instead of `tests/unit/experiments/`:** The `tests/` folder is for production server code. Experiment framework code lives entirely under `experiments/` and its tests should colocate. This is a deliberate exception to the project's "tests as siblings of src" rule because experiments are dev tooling, not production.

---

### Test Cases — `runner.ts`

#### `loadPrompt(promptPath)` — Parses prompt files

##### Normal Cases

| # | Test | Expected |
|---|------|----------|
| RU1 | Valid prompt with `===SYSTEM===` and `===USER===` sections | Returns `{ system, user, meta: {} }` with correct content |
| RU2 | Prompt with `===SYSTEM===`, `===USER===`, `===META===` sections | Returns `{ system, user, meta }` with parsed meta key/value pairs |
| RU3 | Meta section parses `temperature=0.3` correctly | `meta.temperature === '0.3'` |
| RU4 | Meta section parses multiple keys | Multiple key/value pairs in returned meta object |
| RU5 | Section content preserves whitespace and newlines | Multi-line content within sections is preserved verbatim |

##### Edge Cases

| # | Test | Expected |
|---|------|----------|
| RU6 | Prompt missing `===SYSTEM===` section | Throws error with clear message |
| RU7 | Prompt missing `===USER===` section | Throws error with clear message |
| RU8 | Prompt with sections in unusual order (USER before SYSTEM) | Parses correctly regardless of order |
| RU9 | Prompt with empty section content | Returns empty string for that section |
| RU10 | Prompt file does not exist | Throws error with file path |
| RU11 | Meta value contains `=` character (e.g., `key=val=ue`) | Parses correctly — splits only on first `=` |

#### `substituteVariables(template, variables)`

##### Normal Cases

| # | Test | Expected |
|---|------|----------|
| RU12 | Single variable substitution `{{LEVEL}}` → `B1` | Template with `B1` in place of `{{LEVEL}}` |
| RU13 | Multiple variables substituted in one call | All `{{X}}` placeholders replaced |
| RU14 | Same variable used multiple times | All occurrences replaced |
| RU15 | Variable not provided in input map | Placeholder left as-is (not replaced with empty string) |
| RU16 | Template with no variables | Returns template unchanged |

##### Edge Cases

| # | Test | Expected |
|---|------|----------|
| RU17 | Variable value contains `{{` characters | Substituted literally, no recursive substitution |
| RU18 | Variable value contains special regex characters | Substituted literally |
| RU19 | Empty string variable value | Replaces with empty string |

#### `loadFixtures(fixturesDir)`

##### Normal Cases

| # | Test | Expected |
|---|------|----------|
| RU20 | Loads all `.json` files from directory | Returns array of parsed Fixture objects |
| RU21 | Skips non-JSON files in directory | Ignores `.txt`, `.md`, etc. |
| RU22 | Fixture with all required fields parses correctly | Object matches Fixture interface |
| RU23 | Fixture with extra unknown fields | Ignored (not in interface) |
| RU24 | Fixture schema matches latest spec | No `overrides` field — removed for simplicity |

##### Edge Cases

| # | Test | Expected |
|---|------|----------|
| RU25 | Fixture file with malformed JSON | Throws error with file path and JSON error |
| RU26 | Fixture missing required field (e.g., `level`) | Throws validation error with field name |
| RU27 | Empty fixtures directory | Returns empty array |
| RU28 | Fixtures directory does not exist | Throws error with path |
| RU29 | Fixture with extra unknown fields | Ignored (not in interface, not validated) |

#### `runSingle(client, prompt, config)` — Single API call

##### Normal Cases (using mocked Anthropic client)

| # | Test | Expected |
|---|------|----------|
| RU30 | Mock client returns valid response | RunResult contains rawResponse, parsed JSON, token usage, latency |
| RU31 | Latency measured correctly | `latencyMs` reflects mock delay |
| RU32 | Token usage extracted from response | `tokenUsage.inputTokens` and `outputTokens` populated |
| RU33 | Model and temperature recorded | Match the config values used |

##### Edge Cases

| # | Test | Expected |
|---|------|----------|
| RU34 | Mock client throws error | Error propagates with context |
| RU35 | Mock client times out | RunResult marked as failed with timeout reason |
| RU36 | Mock returns response that's not parseable JSON | `parsedResponse` is `null`, `rawResponse` still saved |

#### `runAll(fixtures, promptPaths, defaults, filters)` — Orchestration

| # | Test | Expected |
|---|------|----------|
| RU37 | Runs all fixture × prompt combinations | Result count = fixtures × prompts |
| RU38 | Prompt META overrides default config | Final config used by call reflects META values |
| RU39 | No fixture-level overrides exist | Confirmed by schema — fixtures use runner config as-is |
| RU40 | Sequential execution (no parallelism) | Calls happen in order to avoid rate limits |
| RU41 | One failing call doesn't stop the run (failFast=false) | Other calls complete, failed call recorded |
| RU42 | failFast=true stops on first failure | Subsequent calls not attempted |
| RU43 | dryRun=true skips API calls | No mock client calls invoked, results contain dry-run markers |
| RU44 | Saves raw responses to results directory | Files exist with expected naming |

#### `parseFilters()` — Reads env vars

| # | Test | Expected |
|---|------|----------|
| RU45 | All env vars unset | Returns `{ }` (empty filter — caller defaults to "default" group) |
| RU46 | `FIXTURE=test-05` set | `filters.fixtureIds === ["test-05"]` |
| RU46a | `FIXTURE=test-01,test-04,test-07` set | `filters.fixtureIds === ["test-01", "test-04", "test-07"]` |
| RU46b | `FIXTURE=" test-01 , test-04 "` (with whitespace) | Whitespace trimmed: `["test-01", "test-04"]` |
| RU47 | `GROUP=normal` set | `filters.groups === ["normal"]` |
| RU48 | `GROUP=normal,edge,injection` set | `filters.groups === ["normal", "edge", "injection"]` |
| RU49 | `GROUP=" normal , edge "` (with whitespace) | Whitespace trimmed: `["normal", "edge"]` |
| RU50 | `PROMPT_VERSION=v2` set | `filters.promptVersion === "v2"` |
| RU51 | `DRY_RUN=true` set | `filters.dryRun === true` |
| RU52 | `DRY_RUN=false` set | `filters.dryRun === false` |
| RU53 | `DRY_RUN=anything-else` set | `filters.dryRun === false` (only "true" enables) |
| RU54 | `FAIL_FAST=true` set | `filters.failFast === true` |

#### `filterFixtures(fixtures, filters)` — Filtering logic

| # | Test | Expected |
|---|------|----------|
| RU55 | No filters set | Returns fixtures tagged "default" |
| RU56 | `fixtureIds` set (single) | Returns only the matching fixture |
| RU56a | `fixtureIds` set (multiple) | Returns all matching fixtures |
| RU57 | `fixtureIds` doesn't match any fixture | Returns empty array |
| RU58 | `groups: ["normal"]` set | Returns all fixtures with "normal" in groups array |
| RU59 | `groups: ["normal", "edge"]` set | Returns fixtures matching ANY of the listed groups (union) |
| RU60 | Fixture in multiple groups counted once | No duplicates in result |
| RU61 | `fixtureIds` and `groups` both set | `fixtureIds` takes precedence (groups ignored) |
| RU62 | Empty fixtures array | Returns empty array regardless of filters |

#### `filterPrompts(promptPaths, filters)` — Prompt filtering

| # | Test | Expected |
|---|------|----------|
| RU63 | No `promptVersion` filter | Returns all prompt paths |
| RU64 | `promptVersion="v2"` and "v2.txt" exists | Returns only the v2 prompt path |
| RU65 | `promptVersion="v3"` and no "v3.txt" exists | Returns empty array |
| RU66 | Filename matching is exact (no v1 vs v10 confusion) | "v1" matches "v1.txt", not "v10.txt" |

#### `mergeConfig(defaults, promptMeta)` — Priority chain

| # | Test | Expected |
|---|------|----------|
| RU67 | No prompt META | Returns defaults unchanged |
| RU68 | Prompt META overrides defaults | META values used for overlapping keys |
| RU69 | Numeric META string values are coerced to numbers | `temperature="0.3"` becomes `0.3` |
| RU70 | Unknown META keys are ignored | Don't break the merge |

---

### Test Cases — `checker.ts`

The checker validates the new three-list output schema with `textFit`. All checks operate on the `ExtractionOutput` shape:

```typescript
{ textFit, phrases: [], polysemous: [], vocabulary: [] }
```

#### `checkValidJson(raw)`

| # | Test | Expected |
|---|------|----------|
| CH1 | Valid JSON object with textFit + 3 lists | `passed: true` |
| CH2 | Empty object `{}` | `passed: true` (parses; schema check catches missing fields) |
| CH3 | Invalid JSON syntax | `passed: false`, message includes parse error |
| CH4 | Markdown code fence around JSON (` ```json ... ``` `) | `passed: false` (we want raw JSON) |
| CH5 | JSON with trailing comma | `passed: false` (strict JSON) |
| CH6 | Empty string | `passed: false` |
| CH7 | Plain prose response | `passed: false` |
| CH8 | JSON wrapped in explanatory text | `passed: false` |

#### `checkTopLevelSchema(parsed)`

| # | Test | Expected |
|---|------|----------|
| CH9 | Object with all 4 fields (textFit + 3 lists) | `passed: true` |
| CH10 | Missing `textFit` field | `passed: false`, message names missing field |
| CH11 | Missing `phrases` field | `passed: false` |
| CH12 | Missing `polysemous` field | `passed: false` |
| CH13 | Missing `vocabulary` field | `passed: false` |
| CH14 | `phrases` is not an array | `passed: false` |
| CH15 | `polysemous` is not an array | `passed: false` |
| CH16 | `vocabulary` is not an array | `passed: false` |
| CH17 | Top-level is array instead of object | `passed: false` |
| CH18 | All three lists empty, valid textFit | `passed: true` (empty lists are valid) |
| CH19 | Extra top-level fields beyond the 4 | `passed: false` (or warning) |

#### `checkTextFitValid(parsed)`

| # | Test | Expected |
|---|------|----------|
| CH20 | `textFit: "appropriate"` | `passed: true` |
| CH21 | `textFit: "stretch"` | `passed: true` |
| CH22 | `textFit: "too_hard"` | `passed: true` |
| CH23 | `textFit: "too_easy"` | `passed: true` |
| CH24 | `textFit: "easy"` | `passed: true` |
| CH25 | `textFit: "not_applicable"` | `passed: true` |
| CH26 | `textFit: "challenging"` (invalid enum) | `passed: false` |
| CH27 | `textFit: ""` | `passed: false` |
| CH28 | `textFit: "Appropriate"` (case mismatch) | `passed: false` |
| CH29 | `textFit` is null | `passed: false` |

#### `checkTermObjectsValid(parsed)`

Validates each term object inside any of the three lists.

| # | Test | Expected |
|---|------|----------|
| CH30 | All terms have `term` and `level` only | `passed: true` |
| CH31 | All terms have `term`, `level`, `context` array | `passed: true` |
| CH32 | Multi-word `term` field (e.g., "break down") in phrases list | `passed: true` |
| CH33 | Term object missing `term` field | `passed: false`, message names missing field |
| CH34 | Term object missing `level` field | `passed: false` |
| CH35 | `term` field is not a string | `passed: false` |
| CH36 | `level` field is not a string | `passed: false` |
| CH37 | `context` is a string instead of array | `passed: false` |
| CH38 | `context` array contains non-string items | `passed: false` |
| CH39 | Term object validation works across all 3 lists (phrases, polysemous, vocabulary) | All terms in all lists checked |

#### `checkNoHallucinatedFields(parsed)`

| # | Test | Expected |
|---|------|----------|
| CH40 | All term objects contain only allowed fields (`term`, `level`, `context`) | `passed: true` |
| CH41 | Term object contains extra field (e.g., `definition`) | `passed: false`, message names the extra field |
| CH42 | Term object contains AI-added metadata (e.g., `confidence`) | `passed: false` |

#### `checkNoDuplicateTerms(output)`

Checks within each list — no duplicates inside `phrases`, no duplicates inside `polysemous`, no duplicates inside `vocabulary`.

| # | Test | Expected |
|---|------|----------|
| CH43 | All unique terms in each list | `passed: true` |
| CH44 | Two entries with same term in `phrases` | `passed: false` |
| CH45 | Case-insensitive duplicate detection in `vocabulary` ("Run" vs "run") | `passed: false` |
| CH46 | Phrase duplicates ("break down" twice in phrases) | `passed: false` |
| CH47 | Same term legitimately in different lists is OK at this stage | `passed: true` (cross-list duplicates checked separately) |
| CH48 | All three lists empty | `passed: true` |

#### `checkValidLevels(output)`

Checks levels in all three lists.

| # | Test | Expected |
|---|------|----------|
| CH49 | All levels are valid CEFR (A1-C2) | `passed: true` |
| CH50 | Invalid level value ("D1") in phrases list | `passed: false` |
| CH51 | Lowercase level ("b1") in vocabulary list | `passed: false` |
| CH52 | Level with extra characters ("B1+") in polysemous list | `passed: false` |

#### `checkNoCrossListDuplicates(output)`

A term should appear in exactly ONE of the three lists, not multiple.

| # | Test | Expected |
|---|------|----------|
| CH53 | Same term in `phrases` and `vocabulary` | `passed: false`, message names the term and lists |
| CH54 | Same term in all three lists | `passed: false` |
| CH55 | Each term in exactly one list | `passed: true` |
| CH56 | Empty lists | `passed: true` (vacuously) |

#### `runChecks(rawResponse)` — Orchestration

| # | Test | Expected |
|---|------|----------|
| CH57 | Valid response passes all checks | `allPassed: true`, `parsedOutput` populated with the full ExtractionOutput |
| CH58 | Invalid JSON fails JSON check, downstream checks skipped | First check fails, schema check not run |
| CH59 | Returns parsed output when JSON parses successfully | Even if other checks fail |
| CH60 | Returns null parsed output when JSON parse fails | `parsedOutput: null` |
| CH61 | All-empty-lists output passes all checks | `allPassed: true` (this is the expected response for non-English/garbage input) |

---

### Test Cases — `scorer.ts`

The scorer produces per-list scores (recall + strict level accuracy for phrases, polysemous, vocabulary separately) plus cross-list metrics (textFitAccuracy with partial credit, global precision). No aggregated averages — per-list scores are shown individually.

#### `cefrDistance(level1, level2)` — Helper

| # | Test | Expected |
|---|------|----------|
| SC1 | Same level (B1, B1) | 0 |
| SC2 | Adjacent levels (B1, B2) — signed positive | +1 |
| SC3 | Adjacent levels (B2, B1) — signed negative | -1 |
| SC4 | Two levels apart (A2, B2) | +2 |
| SC5 | Maximum distance (A1, C2) | +5 |
| SC6 | Invalid level | Throws error |

#### `textFitScore(actual, expected)` — Partial credit helper

| # | Test | Expected |
|---|------|----------|
| SC7 | Exact match (appropriate, appropriate) | 100 |
| SC8 | Off by 1 step (stretch, appropriate) | 50 |
| SC9 | Off by 1 step (easy, appropriate) | 50 |
| SC10 | Off by 2 steps (too_hard, appropriate) | 0 |
| SC11 | Off by 3 steps (too_hard, easy) | 0 |
| SC12 | Off by 4 steps (too_hard, too_easy) | 0 |
| SC13 | not_applicable matches not_applicable | 100 |
| SC14 | not_applicable vs any other value | 0 |
| SC15 | any value vs not_applicable | 0 |

#### `normalizeTerm(term)` and `termsMatch(extracted, target)` — Matching helpers

| # | Test | Expected |
|---|------|----------|
| SC16 | `normalizeTerm("Sustainable")` | `"sustainable"` |
| SC17 | `normalizeTerm("  break down  ")` | `"break down"` |
| SC18 | `normalizeTerm("BREAK DOWN")` | `"break down"` |
| SC19 | `termsMatch("Sustainable", "sustainable")` | `true` |
| SC20 | `termsMatch(" Run ", "run")` | `true` |
| SC21 | `termsMatch("running", "run")` | `false` (no lemmatization) |
| SC22 | `termsMatch("break down", "Break Down")` | `true` |
| SC23 | `termsMatch("breakdown", "break down")` | `false` (whitespace matters) |

#### `scoreList(extracted, target)` — Per-list scoring

| # | Test | Expected |
|---|------|----------|
| SC24 | All target terms found | recall: 100% |
| SC25 | Half of target terms found | recall: 50% |
| SC26 | No target terms found | recall: 0% |
| SC27 | All matched terms have EXACT level match | levelAccuracy: 100% |
| SC28 | One matched term off by 1 level (e.g., expected B2, got B1) | levelAccuracy: < 100% (strict — no tolerance) |
| SC29 | One matched term off by 2 levels | levelAccuracy: < 100% |
| SC30 | Empty extracted, empty target | recall: 100% (vacuously) |
| SC31 | Empty extracted, non-empty target | recall: 0% |
| SC32 | Non-empty extracted, empty target | recall: 100% (no targets to miss) |
| SC33 | Details lists `targetTermsFound` correctly | Found targets enumerated |
| SC34 | Details lists `targetTermsMissed` correctly | Missed targets enumerated |
| SC35 | Details lists `levelMismatches` with expected vs actual | Mismatches enumerated |

#### `scoreResult(output, fixture)` — Main scoring function

| # | Test | Expected |
|---|------|----------|
| SC36 | Output with all 3 lists scored | `phrases`, `polysemous`, `vocabulary` ListScore objects populated independently |
| SC37 | textFit exact match | `textFitAccuracy: 100` |
| SC38 | textFit off by 1 step | `textFitAccuracy: 50` |
| SC39 | textFit off by 2+ steps | `textFitAccuracy: 0` |
| SC40 | Global precision: no mustNotContain violations | `precision: 100` |
| SC41 | Global precision: one violation in phrases list | `precision: < 100`, violation listed in `mustNotContainViolations` |
| SC42 | Global precision: violations across multiple lists | All violations aggregated |
| SC43 | Unmatched report: AI extracted term not in any target and not in mustNotContain | Listed in `unmatchedReport.extractedButNotInTargets` with term, level, and source list |
| SC44 | Unmatched report: AI extracted term that IS in mustNotContain | NOT in unmatched report (it's in `mustNotContainViolations` instead) |
| SC45 | Unmatched report: all extracted terms match targets | `extractedButNotInTargets` is empty |
| SC46 | Phrase target matched in phrases list | counted in phrases recall, not vocab/polysemous |
| SC47 | Polysemous target found in vocabulary list (wrong placement) | counted as missed in polysemous recall; appears in vocab's unmatched report |
| SC48 | Empty extraction (all 3 lists empty) for non-English fixture | All recall: 100% if all targets are empty too |
| SC49 | Empty extraction for normal fixture (with targets) | All recall: 0% |
| SC50 | Per-list scores are NOT averaged | No `overallRecall` or `overallLevelAccuracy` fields in result |

---

### Test Cases — Evaluator removed

We removed the AI cross-run evaluator. No tests for it. The user evaluates manually via the HTML report's interactive feedback UI.

---

### Test Cases — `reporter.ts`

#### `estimateCost(inputTokens, outputTokens)` — Helper

| # | Test | Expected |
|---|------|----------|
| RP1 | 1M input + 1M output tokens | Returns Haiku 4.5 pricing total |
| RP2 | Zero tokens | Returns 0 |
| RP3 | Asymmetric input/output | Calculates each independently |

#### `generateReportId()` — Timestamped report IDs

| # | Test | Expected |
|---|------|----------|
| RP3a | Returns a string starting with "report-" | Format check |
| RP3b | Format is `report-YYYYMMDD-HHMMSS` | Regex match |
| RP3c | Two consecutive calls return different IDs | At least 1 second apart |

#### `generateReport(data, reportsDir)` — HTML generation

| # | Test | Expected |
|---|------|----------|
| RP4 | Valid ReportData generates an HTML file in reportsDir | File exists at returned path |
| RP4a | Returns `{ reportId, reportPath }` | Both fields populated |
| RP4b | Filename follows `report-{timestamp}.html` pattern | Regex match |
| RP4c | Generating two reports doesn't overwrite | Two distinct files exist after two calls |
| RP5 | Generated HTML is valid HTML5 | Contains `<!DOCTYPE html>`, balanced tags |
| RP6 | HTML contains summary table for all results | Each fixture × prompt combo has a row with per-list R/P columns |
| RP6a | Summary table shows textFit Fit column (✓/✗) per row | Match indicator present |
| RP6b | HTML displays filters that were applied | Shows FIXTURE/GROUP/PROMPT values used for the run |
| RP7 | HTML does NOT contain an AI evaluation section | Evaluator removed from this sprint |
| RP8 | HTML contains per-result detail panels with three-column layout | Three columns: phrases, polysemous, vocabulary |
| RP8a | Each detail panel shows the textFit badge (extracted vs expected) | Two badges visible per result |
| RP8b | textFit badge color codes correctly | Green appropriate, yellow easy/stretch, red too_easy/too_hard, gray not_applicable |
| RP9 | HTML inlines CSS (no external stylesheets) | `<style>` tag present |
| RP10 | HTML inlines JS (no external scripts) | `<script>` tag present |
| RP11 | Inline JS contains feedback export logic | Function for downloading feedback as JSON |
| RP12 | Failed structural checks shown in red | Visual indication for failed checks |
| RP13 | Target terms found in correct list highlighted green | CSS class applied per list |
| RP13a | Target terms missed (in target but not extracted) highlighted red | Per list |
| RP13b | Extracted terms in wrong list flagged | Visual warning |
| RP14 | Must-not-contain violations highlighted across all 3 lists | CSS class applied |
| RP15 | Token usage and cost displayed per result | Numbers present in HTML |
| RP16 | Empty results array | Generates report with "no results" message, doesn't crash |

#### Manual Feedback UI (in-browser interaction)

These tests verify the inline JavaScript that powers the manual feedback UI. They run in a JSDOM-like environment by parsing the generated HTML and exercising the JS.

| # | Test | Expected |
|---|------|----------|
| RP16a | Each per-result panel has a rating slider/input (1-10) | DOM element exists per result |
| RP16b | Each per-result panel has a comments textarea | DOM element exists per result |
| RP16c | Each extracted term across all 3 lists has good/bad/surprising verdict buttons | DOM elements exist per term |
| RP16d | Each per-result panel has 3 separate "Add missing term" inputs (one per list) | DOM elements exist for missingPhrases, missingPolysemous, missingVocabulary |
| RP16e | Each per-result panel has a textFit feedback checkbox | DOM element to mark textFit correct/incorrect |
| RP16f | "Export Feedback" button exists at the top of the report | Button element present |
| RP16g | Setting a rating updates internal state | Click rating, verify in-memory state |
| RP16h | Adding a term verdict tracks the source list | Verdict object includes `list: 'phrases' | 'polysemous' | 'vocabulary'` |
| RP16i | Clicking Export triggers a download with correct JSON shape | Download triggered, JSON matches `ManualFeedback` schema with per-list missing term arrays |
| RP16j | Export filename follows `feedback-{reportId}.json` pattern | Filename match |
| RP16k | Rating values outside 1-10 are clamped or rejected | UI prevents invalid values |

#### Aggregate Analytics

| # | Test | Expected |
|---|------|----------|
| RP17 | Aggregate totals computed across all results | `aggregates.totalInputTokens`, `totalOutputTokens`, `totalCost` correct |
| RP18 | Per-group averages computed correctly | `aggregates.perGroup` has entry per unique group with correct averages |
| RP19 | Fixture in multiple groups counted in each | A fixture tagged `normal` and `long-text` contributes to both group averages |
| RP20 | Per-prompt-version totals computed correctly | `aggregates.perPrompt` has entry per prompt with correct sums and averages |
| RP21 | Cost delta calculated against cheapest prompt | Cheapest prompt has delta 0, others positive |
| RP22 | Cost delta percent calculated correctly | `(cost - cheapestCost) / cheapestCost * 100` |
| RP23 | Single prompt version run | `costDelta` array has 1 entry with delta 0 |
| RP24 | HTML renders Per-Group Token Averages table | Table present with correct rows |
| RP25 | HTML renders Per-Prompt-Version Totals table | Table present with correct rows |
| RP26 | HTML renders Cost Delta Comparison table | Table present with correct rows |
| RP27 | Failed runs (no parsedOutput) excluded from token averages | Only successful runs counted toward averages |
| RP28 | Failed runs still counted in totalInputTokens (input was sent) | Input tokens consumed even if output was garbage |

---

### Mocking Strategy

#### Anthropic Client Mock

A reusable mock at `experiments/extraction/__tests__/helpers/mock-anthropic.ts`:

```typescript
interface MockAnthropic {
  messages: {
    create: (params: unknown) => Promise<{
      content: Array<{ type: 'text'; text: string }>;
      usage: { input_tokens: number; output_tokens: number };
    }>;
  };
}

// Creates a mock client that returns a predetermined response.
function createMockAnthropic(response: string, options?: {
  inputTokens?: number;
  outputTokens?: number;
  delayMs?: number;
  shouldThrow?: Error;
}): MockAnthropic;
```

This mock matches the Anthropic SDK shape closely enough that runner code uses it transparently. Tests inject the mock instead of a real client.

#### Filesystem Mocks

For tests that read prompt/fixture files, we use real files in `experiments/extraction/__tests__/fixtures/`. This is more realistic than mocking `fs` and catches issues like newline handling, BOM characters, and encoding.

For tests that write output files (results, reports), we write to a temporary directory created per test (using `os.tmpdir()`) and clean up after.

---

## Part B: Prompt Test Fixtures

This section drives the creation of all 36 fixtures defined in Phase 1. Fixtures are created collaboratively with the user — base passages drafted, target terms split into the three lists, `mustNotContain` curated, `expectedTextFit` set per student lens.

**Status:** In progress — drafting base passages and target terms one at a time.

Each fixture produces a JSON file at `experiments/extraction/fixtures/test-NN-{slug}.json` matching the schema defined in Phase 1.

### Base Passage Approach (Normal Fixtures 1-9)

Normal fixtures use the **3-passage, multi-student** pattern described in Phase 1. There are 3 base passages, each viewed by 3 different student levels = 9 fixtures.

| Base passage | Content levels | Text type | Student lenses |
|--------------|---------------|-----------|---------------|
| **P1** | A1+A2 | Elementary dialogue / story | A1, A2, B1 |
| **P2** | B1+B2 | Middle school textbook | A2, B1, B2 |
| **P3** | C1+C2 | High school 모의고사 academic | B1, B2, C1 |

**Workflow per base passage:**

1. **Draft the passage** with intentional level mixing (e.g., P2 has B1 AND B2 vocabulary, polysemy, and phrases throughout). Show user, get approval.
2. **For each student lens** of that passage:
   - Determine `expectedTextFit` based on the passage's characteristic level (90th percentile) vs the student's level (see Phase 1 textFit section)
   - Build `targetPhrases`, `targetPolysemous`, `targetVocabulary` using the unified level range (student level to +2 — see Phase 1 Per-List Level Ranges)
   - Apply the Phrase Level Rule to phrases (literal = no bump, non-literal = +1)
   - Apply the Polysemy Multi-Sense Rule when a polysemous word has multiple in-range senses
   - Apply the Cross-List Priority Rule when a term could fit multiple lists (polysemy > phrases > vocabulary)
   - Build `mustNotContain` — function words, basic vocabulary the student knows, proper nouns, dropped non-pain-point phrases, etc.
3. **Write the fixture file** for each student lens.

For per-list rules and ranges, see Phase 1 sections **"Per-List Level Ranges"**, **"Phrase Level Rule"**, **"Polysemy Multi-Sense Rule"**, and **"Cross-List Priority Rule"**. This phase doc references those rules; it doesn't redefine them.

### Same Passage, Different Student Lenses

For the same passage, different student lenses produce different extractions because each student's level shifts the inclusion windows. Example for base passage P2 (B1+B2 middle school passage, characteristic level B2):

| Student | Range (all 3 lists) | `expectedTextFit` |
|---------|---------------------|-------------------|
| A2 | A2, B1, B2 | `too_hard` (B2 is 2 above A2) |
| B1 | B1, B2, C1 | `stretch` (B2 is 1 above B1) |
| B2 | B2, C1, C2 | `appropriate` (B2 matches) |

The same passage produces different lists because each student's level shifts the inclusion window.

---

### Security Considerations

| Concern | How We Address |
|---------|----------------|
| API key in test code | Tests use a mock client. Real API key only used by `npm run test:prompts`, read from `.env` |
| Cost runaway during framework tests | Framework tests never call real API. Verified by mocking. |
| Prompt injection in test fixtures | Phase B fixtures explicitly include injection test cases. Production code (future sprint) will need additional defense — this sprint validates that the prompt itself is robust. |
| Sensitive data in run logs | Token counts and latency only. No request bodies or response details logged outside results directory. |
| Results directory in version control | `.gitignore` excludes `experiments/extraction/results/` and `reports/` |

### Performance Considerations

| Concern | Approach |
|---------|----------|
| Framework tests slow due to file I/O | Tests use small fixture files; total framework test time should stay under 5 seconds |
| Prompt experiments take many minutes | Sequential execution, but each call should complete in <5s per the hard constraint. 36 fixtures × N prompts = a few minutes per full run. Use env-var filters (FIXTURE, GROUP) for fast iteration. |
| Memory usage from large HTML reports | Reports for 36 fixtures × ~3 prompt versions × ~2KB per result (three lists) = ~220KB HTML. Trivial. |
| Disk usage for raw results | Each result file ~5KB. 36 × 3 = ~540KB per run. Negligible. |
| Base passage duplication | Each base passage is stored 3 times (once per student lens fixture). For P3 (~2500 chars), that's ~7.5KB across the 3 lenses. Acceptable trade-off for fixture self-containment. |
