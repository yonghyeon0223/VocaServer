# Sprint 04 — Word Introduction Prompt Experimentation

## Phase 2: Testing

### Overview

This sprint tests **prompt quality**, not code correctness. The "tests" are evaluation criteria applied to AI-generated word introduction outputs across 47 diverse terms. Evaluation combines automated structural checks (pass/fail) with manual review in an interactive HTML report.

Testing happens in iterative cycles: run 5 terms → review in report → write feedback → refine prompt → repeat. A full 47-term run happens after the prompt stabilizes.

### Test Fixtures: 47 Terms

Selected from Sprint 03's v14 extraction results across 14 source passages. Sorted by CEFR level.

#### A1 (9 terms)

| Term | Definition | Imp | Type | Source | Test interest |
|------|-----------|-----|------|--------|---------------|
| wakes up | stops sleeping; gets out of bed | 4 | phrase | test-01 | Simple phrasal verb — WD Type A: does "up" add meaning? |
| puts on | places clothing onto one's body | 4 | phrase | test-01 | Another "verb + particle" — can it differentiate from `wakes up`? |
| playground | outdoor area at school where children play | 3 | vocab | test-01 | Concrete noun — can it find meaningful explore turns? |
| cat | a small furry animal often kept as a pet | 3 | vocab | test-14 | Trivially simple — stress test for minimum viable intro |
| happy | feeling pleasure or contentment | 0 | vocab | test-10 | Importance 0 — must produce 1 explore turn max |
| visited | went to see a place as a tourist or guest | 3 | vocab | test-13 | Past tense form — does MF turn add value? |
| delicious | having a very pleasant taste | 4 | vocab | test-24 | Strong Korean cognate (맛있는) — can scene avoid redundancy? |
| go back | to return to a place | 3 | phrase | test-27 | Overlaps with `bounced back` — independent scene needed |
| forgot | failed to remember something | 3 | vocab | test-31 | Simple but irregular form — minimal explore expected |

#### A2 (9 terms)

| Term | Definition | Imp | Type | Source | Test interest |
|------|-----------|-----|------|--------|---------------|
| doesn't feel well | is not in good health; feels sick | 4 | phrase | test-01 | Negative construction — how does the scene integrate it? |
| instead of | in place of something else; as a substitute | 3 | phrase | test-04 | Discourse connector — does AR type fit? |
| turtle | a reptile with a hard shell that lives in the sea | 2 | vocab | test-04 | Concrete noun, low importance — light exploration |
| give up | to stop doing something or to surrender | 4 | phrase | test-11 | WD weak case — "give" + "up" ≠ surrender. Does AI avoid WD? |
| freedom | the state of being able to choose without restriction | 3 | vocab | test-07 | Abstract at A2 — can scene stay concrete? |
| learning to code | the process of studying how to write computer programs | 4 | phrase | test-25 | Very literal compound — can it find depth? |
| data | facts and information, especially when stored digitally | 4 | vocab | test-26 | Korean cognate (데이터) — what explore angles exist? |
| pronunciation | the way sounds are made when speaking a word | 4 | vocab | test-28 | Meta-linguistic term — scene design challenge |
| castle | a large old stone building built to defend against attack | 2 | vocab | test-13 | Concrete, low importance — should be brief |

#### B1 (9 terms)

| Term | Definition | Imp | Type | Source | Test interest |
|------|-----------|-----|------|--------|---------------|
| runs like the wind | runs extremely fast — idiomatic comparison | 3 | phrase | test-01 | Simile/idiom — WD Type A on the metaphor structure |
| end up in | to finally arrive at a place or situation, often unintentionally | 4 | phrase | test-04 | Three-word phrasal verb — unintentionality is the key nuance |
| pollution | harmful substances that damage the natural environment | 4 | vocab | test-04 | Abstract but familiar — Korean cognate (오염) |
| anxiety | a feeling of worry and nervousness about the future | 4 | vocab | test-07 | Emotional abstract — can scene evoke without explaining? |
| pointed out | drew attention to a fact or problem | 3 | phrase | test-12 | Discourse function — is AR or CX more fitting? |
| feedback | comments or advice about how well someone has done | 4 | vocab | test-23 | Konglish (피드백) — does the intro add value beyond what learner already knows? |
| consequence | a result or effect of an action or situation | 0 | vocab | test-10 | Importance 0 — absolute minimum exploration |
| climate change | long-term shifts in global temperatures and weather patterns | 4 | phrase | test-35 | Technical compound — WD Type A applies well |
| gradually | slowly and steadily over time | 3 | vocab | test-25 | Adverb — scene must show the "over time" quality |

#### B2 (9 terms)

| Term | Definition | Imp | Type | Source | Test interest |
|------|-----------|-----|------|--------|---------------|
| opportunity cost | the value of the best alternative you give up when making a choice | 4 | phrase | test-07 | WD Type A strong case — "왜 이 조각들을 합쳤을까?" |
| paralyze | to make someone unable to act or decide | 4 | vocab | test-07 | Metaphorical use (not physical) — does scene capture decision paralysis? |
| fatigue | extreme tiredness, especially from mental or physical effort | 4 | vocab | test-07 | CP candidate: fatigue vs tiredness vs exhaustion |
| bounced back | recovered quickly after a difficulty or failure | 4 | phrase | test-11 | WD Type A validated in planning — reference case |
| merger | the combining of two companies into one | 4 | vocab | test-11 | Business domain — can scene stay relatable to non-business learners? |
| cutting corners | doing something in a quick, careless way to save time or money | 4 | phrase | test-12 | Idiom — WD Type A on the metaphor origin |
| go back to square one | return to the very beginning because a plan has failed | 4 | phrase | test-12 | Long idiom — scene integration for 5-word expression |
| strike a balance | to find an acceptable middle point between two opposing things | 4 | phrase | test-26 | Collocation-heavy — CL type should be strong |
| renewable energy sources | energy from natural sources that are constantly replenished | 4 | phrase | test-35 | Longest expression (3 words) — WD Type A on compound structure |

#### C1 (8 terms)

| Term | Definition | Imp | Type | Source | Test interest |
|------|-----------|-----|------|--------|---------------|
| paradox of choice | the idea that too many options leads to less happiness | 4 | phrase | test-07 | High-concept — needs all explore turns to unpack layers |
| decision fatigue | mental exhaustion caused by making too many decisions | 4 | phrase | test-07 | WD Type A + overlaps with `fatigue` — independent scene needed |
| counterintuitive | opposite to what you would naturally expect or believe | 4 | vocab | test-07 | WD Type B validated in planning — reference case |
| cognitive | relating to mental processes of thinking and understanding | 4 | vocab | test-07 | Academic register — can scene be grounded in daily life? |
| mitigate | to make something less severe, harmful, or serious | 3 | vocab | test-07 | Formal register — CP with "reduce", "lessen"? |
| runs a tight ship | manages an organization in a strict and efficient way | 4 | phrase | test-11 | Idiom with nautical origin — WD Type A on metaphor |
| far-reaching | having a wide range of influence or effects on many things | 3 | vocab | test-29 | WD Type A: far + reaching — straightforward decomposition |
| abundance | a very large quantity of something; more than enough | 3 | vocab | test-07 | IN type candidate — abundance vs plenty vs surplus |

#### C2 (3 terms)

| Term | Definition | Imp | Type | Source | Test interest |
|------|-----------|-----|------|--------|---------------|
| seminal | strongly influencing later developments; highly original | 2 | vocab | test-07 | Rare word, low importance — can it create a meaningful but brief intro? |
| relinquished | given up or let go of something | 3 | vocab | test-07 | WD Type B: re- + linquish (Latin linquere = to leave) |
| polysemous | having multiple distinct meanings | 1 | vocab | test-36 | Meta-linguistic, importance 1 — minimal exploration |

### Structural Checks (Automated)

These are pass/fail checks run on every AI output. Any failure indicates a broken output that cannot be rendered in the report.

| # | Check | What it validates | Failure means |
|---|-------|-------------------|---------------|
| 1 | `json_parse` | Output is valid JSON matching compact schema | AI produced malformed output — likely schema confusion |
| 2 | `has_reasoning` | All 4 fields in `r` (`ta`, `tr`, `st`, `tj`) are non-empty strings | AI skipped the reasoning step |
| 3 | `type_ratings_format` | `r.tr` contains all 12 symbols (AR,CP,CR,SC,OP,CX,PD,CL,IN,MU,MF,WD) each with 상/중/하 | AI missed types or used wrong format |
| 4 | `intro_structure` | `i.s` and `i.q` are non-empty strings; `i.o` has 2-4 tuples; each tuple is `[string, string]` | Intro scene/question missing or options malformed |
| 5 | `intro_no_target` | Target expression (case-insensitive) does not appear in any `i.o[][0]` (choice text) | Violates Philosophy 2 — target in intro choices gives away answer |
| 6 | `explore_count` | `e` array has 1-5 elements | Too few or too many explore turns |
| 7 | `explore_answer_valid` | Each `e[].a` is an integer and a valid 0-based index into its `e[].o` array | Correct answer index out of bounds |
| 8 | `explore_types_valid` | Each `e[].t` is one of: AR, CP, CR, SC, OP, CX, PD, CL, IN, MU, MF, WD | Unknown type symbol used |
| 9 | `option_count` | Every `i.o` and `e[].o` has 2-4 tuples; each tuple has exactly 2 strings | Option structure broken |

### Manual Review Criteria

These are qualitative criteria evaluated per-term in the HTML report. Not scored numerically — captured as free-text feedback per term.

#### A. Scene Quality (Intro Turn)

| Criterion | What to look for | Red flags |
|-----------|-----------------|-----------|
| **Naturalness** | Does the scene read like a friend telling a story, not a textbook? | Stiff/formal Korean, 수업 진행 멘트, philosophical abstractions |
| **Korean grounding** | Korean names, Korean settings, universal daily life? | Foreign names, generation-specific trends, niche subcultures |
| **Neutrality** | Scene shows a situation without interpreting it? | Scene text contains the expression's meaning or hints at the "correct" interpretation |
| **Single focus** | Exactly one question, clear what the learner is being asked? | Multiple questions, ambiguous what to respond to |
| **Age neutrality** | Would a 15-year-old and a 50-year-old both relate? | Youth slang, platform-specific references, generational humor |

#### B. Intro Options Quality

| Criterion | What to look for | Red flags |
|-----------|-----------------|-----------|
| **No target expression** | Target word/phrase absent from all choice texts | Target appears in any choice — absolute failure |
| **Balance** | All choices similar length, density, plausibility | One choice noticeably longer, has a dash explanation, or "sounds right" |
| **Genuine diversity** | Each choice represents a different interpretation/attitude | Choices are paraphrases of each other |
| **Honest confusion option** | "I don't know" choice expresses specific confusion, not evasion | "사람마다 다르지" or generic dodges |
| **Convergence quality** | Each response naturally resolves the story and introduces the expression | Expression feels forced in, or response dumps definition + nuance + examples |

#### C. Explore Turns Quality

| Criterion | What to look for | Red flags |
|-----------|-----------------|-----------|
| **Type selection** | Chosen types match expression's actual confusion terrain? | Generic types chosen regardless of expression (e.g., CX for every term) |
| **Type ordering** | Foundational turns early, synthetic turns late, middle follows expression identity? | Fixed template ordering regardless of expression |
| **Turn count** | Matches importance × level guidelines? | Importance 0 with 3+ turns, or importance 4 with 1 turn |
| **Question fairness** | No surface clues, no leading phrasing, no "…인데" trailing hints? | Obvious correct answer from length, language mixing, or phrasing |
| **Choice language consistency** | All choices in same language per turn (except MF exception)? | Korean-English mixing within a single turn's choices |
| **Feedback scope** | Correct feedback explains within scope; incorrect feedback doesn't reveal answer? | "참고로..." tangents, new vocabulary introduced in feedback, scoring language ("정답!") |
| **WD quality (when used)** | Type A: plausible alternative interpretations of component assembly? Type B: sibling words shown, pattern discoverable? | Absurd wrong choices no one would pick, or just asking "what does prefix X mean?" |

#### D. Reasoning Quality

| Criterion | What to look for | Red flags |
|-----------|-----------------|-----------|
| **Terrain analysis depth** | Identifies specific confusion points for THIS expression? | Generic boilerplate that could apply to any word |
| **Rating honesty** | 상/중/하 ratings reflect actual candidate quality, not template? | All types rated 중, or ratings don't match what was selected |
| **Selection justification** | Dedup decisions explained, overlap identified? | Just lists selected types without explaining why others were dropped |
| **Turn count reasoning** | References importance, level, AND terrain factors? | Only references one factor, or contradicts the actual output |

#### E. Cross-Term Consistency

These are evaluated across the full 47-term run, not per-term:

| Criterion | What to look for |
|-----------|-----------------|
| **Scene diversity** | Different scenarios across terms? Not reusing the same cafe/office setup? |
| **Name diversity** | Varied Korean names? Not always 민준 and 서연? |
| **Type variety** | Across all terms, are all 12 types used? Or does the AI over-rely on CX and CL? |
| **Importance calibration** | Consistent turn counts for same importance levels? |
| **Level-appropriate English** | English in explore options doesn't exceed learner's CEFR level? |
| **Meta-language consistency** | "표현" for phrases, "단어" for single words — never mixed? |

### Edge Cases

These terms are expected to be particularly challenging for the prompt. Extra scrutiny during review.

#### Minimal terms (importance 0-1)

| Term | Level | Imp | Challenge |
|------|-------|-----|-----------|
| happy | A1 | 0 | Must produce exactly 1 explore turn. Can it find anything meaningful to ask about "happy"? |
| consequence | B1 | 0 | Same — but at B1 level, there's slightly more to work with |
| polysemous | C2 | 1 | Meta-linguistic term with importance 1. The word itself is obscure — can the scene be relatable? |

#### WD-resistant terms

| Term | Level | Challenge |
|------|-------|-----------|
| give up | A2 | Components don't explain meaning ("give" + "up" ≠ "surrender"). Must rate WD:하 |
| happy | A1 | No decomposable structure at all |
| data | A2 | No meaningful etymology for Korean learners |
| cat | A1 | Nothing to decompose |

#### Korean cognate terms

| Term | Level | Cognate | Challenge |
|------|-------|---------|-----------|
| data | A2 | 데이터 | Learner already knows the word — what value does intro add? |
| feedback | B1 | 피드백 | Same — deeply embedded Konglish |
| delicious | A1 | (none, but 맛있는 is universally known) | Not a cognate but the concept is trivially familiar |

#### Scene integration challenges

| Term | Challenge |
|------|-----------|
| renewable energy sources | 3-word technical expression — how to weave into a natural Korean daily scene? |
| go back to square one | 5-word idiom — convergence message must introduce it without sounding forced |
| doesn't feel well | Negative construction in a scene — the scene must create a context where this is natural |
| polysemous | Academic/technical — finding a relatable Korean scenario for "having multiple meanings" |

#### Overlap risk (terms from same passage)

Several terms come from test-07 (paradox of choice passage). Each must get an independent scene and explore path — no reusing the same "choice overload" context.

| Term cluster | Risk |
|-------------|------|
| opportunity cost, paralyze, fatigue, paradox of choice, decision fatigue, counterintuitive, cognitive, mitigate, abundance, seminal, relinquished | 11 terms from one passage — AI might default to "choosing" scenarios for all |
| bounced back, merger, runs a tight ship, give up | 4 terms from polysemy passage — AI might default to business scenarios for all |
| cutting corners, pointed out, go back to square one | 3 terms from phrase-dense passage — varied scene contexts needed |

#### Importance-level tension

| Term | Level | Imp | Tension |
|------|-------|-----|---------|
| wakes up | A1 | 4 | High importance but trivially simple — must avoid overcomplicating with unnecessary turns |
| seminal | C2 | 2 | Low importance but very complex word — must stay brief despite depth available |
| cat | A1 | 3 | Medium importance, nothing to teach — prompt is forced to find *something* |

### Performance Considerations

| Metric | Target | Why |
|--------|--------|-----|
| Structural check pass rate | 100% | Any structural failure = broken output that can't render |
| Latency per term | < 30s | Longer means output is too verbose or model is struggling |
| Output tokens per term | 800-3000 | Below 800 = likely too shallow; above 3000 = likely over-explaining |
| Cost per 5-term run | < $0.30 | Budget for ~20 iteration cycles before full run |
| Cost per full 47-term run | < $3.00 | Budget for 3-5 full runs |

### Security Considerations

Minimal for this sprint — the prompt takes curated fixture inputs, not user input. However:

- **Prompt injection via term definition:** If a malicious definition were passed (e.g., "ignore previous instructions and..."), the tool_use schema constrains the output structure. The structural checks would catch any deviation.
- **Output containing inappropriate content:** The scene design rules (Korean daily life, age-neutral) constrain output, but manual review should flag any inappropriate scenarios.
- **No user data involved:** All fixtures are from curated extraction results, no PII.

### Testing Workflow

```
Iteration cycle (repeat until prompt stabilizes):
  1. Select 5 terms (varied levels, importance, types)
  2. Run prompt against selected terms
  3. Open HTML report
  4. Play through each term's interaction
  5. Write feedback per term
  6. Save feedback (local server persists to JSON)
  7. Analyze feedback patterns
  8. Refine prompt
  9. Re-run same 5 terms to verify improvement
  10. Move to next batch of 5

Full run (after prompt stabilizes):
  1. Run all 47 terms
  2. Review every term in report
  3. Check cross-term consistency (scene diversity, type variety, name reuse)
  4. Write final feedback
  5. Document prompt as stable or identify remaining issues
```

### Suggested Initial Batches

Batches chosen to cover maximum variety in early iterations:

**Batch 1 — Breadth test (one per level, varied importance):**
`cat` (A1, imp 3), `give up` (A2, imp 4), `end up in` (B1, imp 4), `bounced back` (B2, imp 4), `counterintuitive` (C1, imp 4)

**Batch 2 — Edge cases:**
`happy` (A1, imp 0), `polysemous` (C2, imp 1), `renewable energy sources` (B2, imp 4), `go back to square one` (B2, imp 4), `data` (A2, imp 4)

**Batch 3 — WD focus:**
`opportunity cost` (B2, imp 4), `runs a tight ship` (C1, imp 4), `cutting corners` (B2, imp 4), `far-reaching` (C1, imp 3), `runs like the wind` (B1, imp 3)

**Batch 4 — Scene diversity stress test (all from test-07):**
`paradox of choice` (C1, imp 4), `decision fatigue` (C1, imp 4), `fatigue` (B2, imp 4), `paralyze` (B2, imp 4), `mitigate` (C1, imp 3)

**Batch 5 — Simple terms (can the prompt stay interesting?):**
`playground` (A1, imp 3), `turtle` (A2, imp 2), `delicious` (A1, imp 4), `forgot` (A1, imp 3), `visited` (A1, imp 3)
