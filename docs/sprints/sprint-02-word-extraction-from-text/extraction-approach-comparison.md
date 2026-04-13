# Extraction Approach Comparison: v5–v7 vs v10

This document compares the old extraction design (v5–v7, documented in phase-1-planning.md) with the new design (v10, the current approach). The shift is from **server-enforced arithmetic rules** to **AI-driven pedagogical judgment**, with the server handling only deterministic operations.

---

## Architecture

### Old (v5–v7): 3–4 API calls, complex server post-processing

```
[phrases-produce] ──┐
[phrases-review]  ──┤  (v7 only, sequential after produce)
[polysemous]      ──┼── Promise.all (3 parallel) ──► server post-processing
[vocabulary]      ──┘
```

Server post-processing pipeline:
1. +1 level bump for non-literal phrases (arithmetic)
2. A2 floor enforcement for all phrases
3. Literal vs non-literal classification (relied on AI or heuristic)
4. Range filtering per list (hard window: student level to +2)
5. Cross-list dedup with strict priority (polysemy > phrases > vocabulary)
6. Within-list dedup
7. textFit computation

### New (v10): 2 API calls, minimal server logic

```
[phrases] ──┐
[words]   ──┼── Promise.all (2 parallel) ──► server post-processing
            └
```

Server post-processing pipeline:
1. Filter `worthStudying === false`
2. Split words into polysemous (`nonDefaultSense: true`) and vocabulary
3. Range filtering per list (same window: student level to +2)
4. Within-list dedup
5. textFit computation

**What was removed from the server:** +1 bump, A2 floor, literal/non-literal classification, cross-list dedup, type-based filtering, form fixing.

**What moved to the AI:** level adjustment (Korean difficulty baked into level rating), extraction filtering (worthStudying), form decisions, type filtering.

**What stayed on the server:** range filtering (deterministic arithmetic), within-list dedup (deterministic), textFit computation (90th percentile, deterministic).

---

## Level Assignment

### Old: Honest level + server arithmetic

The old system asked the AI for "honest" CEFR levels — standard levels without any learner-specific adjustment. The server then applied mechanical rules:

- **Phrases:** +1 level bump for non-literal phrases. A collocation rated A2 by the AI became B1 after the server bump. This was the "Korean-learner penalty" — an acknowledgment that Korean students find non-literal phrases harder than their raw CEFR level suggests.
- **A2 floor:** No phrase could be rated below A2, even if the AI said A1.
- **Literal phrases:** No bump. "walk to school" stayed at whatever level the AI assigned.
- **Vocabulary and polysemous:** No adjustment. AI's level used directly.

**Why this broke:** The +1 bump was a blunt instrument. Some phrases deserved +2 (an idiom that's completely opaque to Korean students), others deserved +0 (a collocation that happens to have a direct Korean equivalent). The literal vs non-literal boundary was subjective — the AI classified inconsistently, and hardcoded heuristics couldn't cover edge cases. The A2 floor was arbitrary.

### New: Korean-adjusted level from the AI

The AI assigns levels directly through the lens of Korean school stages:

- A1–A2 = Korean elementary school student (zero intuition for phrasal verbs, prepositions as fixed patterns, discourse markers)
- B1–B2 = Korean middle school student (knows grammar rules, produces English by translating from Korean, knows words but not how words combine)
- C1–C2 = Korean high school student (handles academic English, struggles with idiomatic combinations and non-literal phrases)

The AI considers non-literal meaning, Korean grammar gaps, and structural absence when rating. A "simple" phrasal verb like "get on" might be rated B1 instead of A2 because the entire concept of verb + particle is foreign to Korean.

**No server adjustment.** The AI's level is the final level. No bump, no floor, no ceiling enforcement.

**Why this is more stable:** The adjustment is semantic, not arithmetic. The AI understands *why* a phrase is harder for a Korean student and can apply proportional adjustment — a +0.5 bump for a semi-transparent collocation, a +2 bump for a completely opaque idiom. A fixed +1 rule can't distinguish between these.

---

## Extraction Filtering

### Old: Prompt instructions + server rules

The old prompts tried to tell the AI what to extract and what to skip. Over iterations (v5 → v6 → v7), the prompts grew increasingly detailed:

- v5: "Extract phrases that a Korean student would need to learn as fixed units"
- v6: Long list of Korean pain points, explicit DO/DON'T rules, examples
- v7: Producer prompt extracts aggressively, separate reviewer prompt filters with KEEP/FIX/REMOVE decisions

The server then applied additional filtering: range window, cross-list dedup, type-based filtering (v8 briefly).

**Why this broke:** The "Korean pain point" test was too subjective for Haiku. The same prompt would include "sit next to" in one run and exclude it in another. The v7 reviewer made things worse — two subjective calls stacked on top of each other amplified inconsistency rather than reducing it. Adding more rules to the prompt made it longer and harder for Haiku to follow consistently.

### New: AI classifies, AI judges, server filters mechanically

The v10 prompt tells the AI to:
1. Find all multi-word combinations that fit known types (phrasal verb, collocation, idiom, etc.)
2. Skip compound nouns and transparent combinations
3. For each one, decide `worthStudying: true/false` with a `rationale`

The server then:
1. Drops `worthStudying: false` entries
2. Applies the deterministic range filter

**Why this is better:** The worthStudying boolean captures nuance that fixed rules can't. "This is A2 but it's on the upper boundary — worth studying for an A2 student" vs "This is A1 and the student is A2 — not worth it." The rationale forces the AI to articulate its reasoning, which tends to produce more consistent judgments than a vague "would a Korean student struggle with this?" test.

---

## Phrase Form

### Old: Atomic form enforcement

The old prompts demanded the "shortest reusable unit" — extract "next to" not "sit next to", extract "put on" not "put on a uniform." This was enforced through:

- Prompt instructions ("extract the smallest transferable unit")
- Specific examples ("in terms of", not "think in terms of")
- v7 reviewer with FIX action for trimming
- v8 server-side form fixing (type-based: strip leading verbs from preposition phrases, trim phrasal verbs to 2 words)

**Why this broke:** Haiku consistently attached verbs to preposition phrases and added trailing context to phrasal verbs. Every attempt to fix this — prompt instructions, examples, reviewer, server heuristics — either failed or created new problems. The server-side form fixing required a hardcoded verb list and couldn't handle edge cases.

### New: No form enforcement

The AI returns phrases however it naturally finds them. "sit next to" and "next to" are both acceptable. The old fixtures' expected forms have been updated to match what the AI actually returns consistently.

**Trade-off accepted:** Some phrases may include an extra word that isn't strictly part of the reusable pattern. This is a minor loss in precision that buys major gains in recall and consistency. The student sees "sit next to" instead of "next to" — they still learn the preposition phrase.

---

## Cross-List Overlap

### Old: Strict priority, no overlaps

```
Priority: polysemy > phrases > vocabulary
```

- If a polysemous word appeared inside a phrase, the polysemous entry won and the phrase was dropped
- If a word appeared in both polysemous and vocabulary, polysemous won
- Phrases and vocabulary could coexist only if they taught different lessons

This was enforced server-side with set-based dedup across lists.

**Why this broke:** The priority rules were too rigid. "get the right answer" (phrase) and "right" (polysemous, meaning "correct") teach completely different things. Dropping one loses a valid learning target. The rules also created scoring artifacts — a phrase that happened to contain a polysemous word would be dropped, hurting phrase recall even when the phrase was correctly extracted.

### New: No cross-list dedup

Each list is independent. A word can appear in phrases (as part of a combination) and in polysemous (for its non-default sense) simultaneously. Only within-list dedup remains.

**Why this is fine:** The three lists serve different learning purposes. Overlap between them means the student gets multiple angles on the same word — pattern-based learning (phrase), sense disambiguation (polysemous), and raw vocabulary. These reinforce rather than duplicate.

---

## Polysemous + Vocabulary Merge

### Old: Separate prompts, separate API calls

Polysemous and vocabulary were separate prompts with separate API calls. This meant:
- 3 parallel calls (phrases + polysemous + vocabulary)
- Two separate prompts that both needed to understand word levels but from different angles
- Cross-list dedup needed to prevent the same word appearing in both

### New: Single "words" call with `nonDefaultSense` flag

One prompt lists all content words. Each word gets a `nonDefaultSense: boolean` flag. The server splits the output:
- `nonDefaultSense: true` → polysemous list
- `nonDefaultSense: false` → vocabulary list

**Benefits:**
- 2 API calls instead of 3 (lower cost, lower latency)
- No overlap question between polysemous and vocabulary — it's one list with a flag
- The AI already analyzes each word's meaning to rate its level — adding the boolean is nearly free
- More consistent sense detection (the AI considers all words together rather than having two separate prompts with different framing)

---

## worthStudying Philosophy

This is the biggest conceptual addition in v10. Every extracted item (phrases and words) now carries:
- `worthStudying: boolean` — should the student learn this?
- `rationale: string` — one sentence explaining why

The philosophy encoded in the prompt:
- **Stretch upward:** Items above the student's level are good targets as long as they're not absurdly difficult
- **Skip below:** Items below or at the student's level are not worth studying unless they sit on the upper boundary
- **When in doubt, include:** Err toward `true`

This replaces the old system's approach of extracting everything and relying on range filtering to determine relevance. Now the AI makes an active pedagogical judgment per item, and the server's range filter acts as a safety net rather than the primary filter.

---

## Scoring Implications

The fixture updates reflect the new approach:

| Change | Old | New |
|--------|-----|-----|
| Phrase expected levels | B1 (from A2 + server bump) | A2 (AI's Korean-adjusted level, no bump) |
| Phrase targets | Conservative (6 per P1 fixture) | Expanded (8 per P1 fixture — wake up, run like the wind, get the right answer added) |
| mustNotContain | Aggressive (many transparent phrases blocked) | Relaxed (only truly irrelevant items blocked) |
| Cross-list scoring | Terms penalized for appearing in "wrong" list | Each list scored independently |
| Level accuracy | Strict exact match | Still strict, but against Korean-adjusted levels |

The scoring system (recall, level accuracy, precision, textFit) is unchanged in structure. What changed is the expected values in fixtures, which now align with the AI's Korean-adjusted judgment rather than arithmetic rules.

---

## Summary

| Aspect | Old (v5–v7) | New (v10) |
|--------|-------------|-----------|
| API calls | 3–4 (phrases produce + review + polysemous + vocabulary) | 2 (phrases + words) |
| Level adjustment | Server +1 bump for non-literal phrases | AI adjusts levels using Korean school stage lens |
| Extraction filtering | Complex prompt rules + server dedup | AI `worthStudying` boolean + server range filter |
| Form enforcement | Atomic form demanded in prompt, fixed server-side | None — AI returns natural forms |
| Cross-list overlap | Strict priority, no overlap allowed | Independent lists, overlap allowed |
| Polysemous/vocabulary split | Separate prompts and API calls | Single call, split by `nonDefaultSense` flag |
| Server complexity | High (bump, floor, classification, cross-list dedup, form fixing) | Low (worthStudying filter, range filter, within-list dedup, textFit) |
| Failure mode | Rules break on edge cases, inconsistent AI compliance | AI judgment may vary, but failures are soft (rationale visible) |
| Debuggability | Hard — which rule caused a bad result? | Easy — read the rationale field |

The core shift: **from trying to make the AI follow complex rules it can't consistently apply, to giving the AI a clear pedagogical philosophy and letting it make judgment calls with visible reasoning.**
