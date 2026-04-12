import type { CefrLevel, TextFit, Fixture, TargetTerm } from './runner.js';
import type { ExtractedTerm, ExtractionOutput } from './checker.js';

// ---- Types ----

export interface ListScore {
  recall: number;
  levelAccuracy: number;
  details: {
    targetTermsFound: string[];
    targetTermsMissed: string[];
    levelMismatches: Array<{
      term: string;
      expectedLevel: CefrLevel;
      actualLevel: CefrLevel;
    }>;
  };
}

export interface ScoreResult {
  phrases: ListScore;
  polysemous: ListScore;
  vocabulary: ListScore;

  textFitAccuracy: number;
  precision: number;
  mustNotContainViolations: string[];

  unmatchedReport: {
    extractedButNotInTargets: Array<{
      term: string;
      level: CefrLevel;
      list: 'phrases' | 'polysemous' | 'vocabulary';
    }>;
  };

  // Global scores per fixture
  fixtureRecall: number;    // (phrases_recall + polysemous_recall + vocabulary_recall) / 3
  fixtureAccuracy: number;  // 0.50 × avg_level_accuracy + 0.30 × precision + 0.20 × textFitAccuracy
}

// ---- CEFR Helpers ----

const CEFR_ORDER: CefrLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

export function cefrDistance(level1: CefrLevel, level2: CefrLevel): number {
  const idx1 = CEFR_ORDER.indexOf(level1);
  const idx2 = CEFR_ORDER.indexOf(level2);
  if (idx1 === -1) throw new Error(`Invalid CEFR level: ${level1}`);
  if (idx2 === -1) throw new Error(`Invalid CEFR level: ${level2}`);
  return idx1 - idx2;
}

// ---- TextFit Scoring ----

const TEXT_FIT_ORDER: TextFit[] = ['too_easy', 'easy', 'appropriate', 'stretch', 'too_hard'];

export function textFitScore(actual: TextFit, expected: TextFit): number {
  // not_applicable only matches not_applicable
  if (actual === 'not_applicable' || expected === 'not_applicable') {
    return actual === expected ? 100 : 0;
  }

  const actualIdx = TEXT_FIT_ORDER.indexOf(actual);
  const expectedIdx = TEXT_FIT_ORDER.indexOf(expected);

  if (actualIdx === -1 || expectedIdx === -1) return 0;

  const distance = Math.abs(actualIdx - expectedIdx);
  if (distance === 0) return 100;
  if (distance === 1) return 50;
  return 0;
}

// ---- Term Matching ----

export function normalizeTerm(term: string): string {
  return term.trim().toLowerCase();
}

export function termsMatch(extracted: string, target: string): boolean {
  return normalizeTerm(extracted) === normalizeTerm(target);
}

// ---- Per-List Scoring ----

export function scoreList(
  extracted: ExtractedTerm[],
  target: TargetTerm[],
): ListScore {
  // Recall: how many target terms were found?
  const found: string[] = [];
  const missed: string[] = [];

  for (const t of target) {
    const match = extracted.find((e) => termsMatch(e.term, t.term));
    if (match) {
      found.push(t.term);
    } else {
      missed.push(t.term);
    }
  }

  const recall = target.length === 0 ? 100 : (found.length / target.length) * 100;

  // Level accuracy: for matched terms, how many have exact level match?
  const levelMismatches: ListScore['details']['levelMismatches'] = [];
  let exactLevelMatches = 0;

  for (const t of target) {
    const match = extracted.find((e) => termsMatch(e.term, t.term));
    if (match) {
      if (match.level === t.expectedLevel) {
        exactLevelMatches++;
      } else {
        levelMismatches.push({
          term: t.term,
          expectedLevel: t.expectedLevel,
          actualLevel: match.level as CefrLevel,
        });
      }
    }
  }

  const matchedCount = found.length;
  const levelAccuracy = matchedCount === 0 ? 100 : (exactLevelMatches / matchedCount) * 100;

  return {
    recall,
    levelAccuracy,
    details: {
      targetTermsFound: found,
      targetTermsMissed: missed,
      levelMismatches,
    },
  };
}

// ---- Main Scoring Function ----

export function scoreResult(
  output: ExtractionOutput,
  fixture: Fixture,
): ScoreResult {
  // Score each list independently
  const phrases = scoreList(output.phrases, fixture.targetPhrases);
  const polysemous = scoreList(output.polysemous, fixture.targetPolysemous);
  const vocabulary = scoreList(output.vocabulary, fixture.targetVocabulary);

  // textFit accuracy
  const textFitAccuracy = textFitScore(output.textFit, fixture.expectedTextFit);

  // Global precision: check mustNotContain across all lists
  const allExtracted = [
    ...output.phrases.map((t) => ({ ...t, list: 'phrases' as const })),
    ...output.polysemous.map((t) => ({ ...t, list: 'polysemous' as const })),
    ...output.vocabulary.map((t) => ({ ...t, list: 'vocabulary' as const })),
  ];

  const mustNotContainNormalized = new Set(
    fixture.mustNotContain.map((t) => normalizeTerm(t))
  );

  const violations: string[] = [];
  for (const item of allExtracted) {
    if (mustNotContainNormalized.has(normalizeTerm(item.term))) {
      violations.push(item.term);
    }
  }

  const totalExtracted = allExtracted.length;
  const precision = totalExtracted === 0
    ? 100
    : ((totalExtracted - violations.length) / totalExtracted) * 100;

  // Unmatched report: extracted terms not in any target list and not in mustNotContain
  const allTargetNormalized = new Set([
    ...fixture.targetPhrases.map((t) => normalizeTerm(t.term)),
    ...fixture.targetPolysemous.map((t) => normalizeTerm(t.term)),
    ...fixture.targetVocabulary.map((t) => normalizeTerm(t.term)),
  ]);

  const extractedButNotInTargets = allExtracted
    .filter((item) => {
      const n = normalizeTerm(item.term);
      return !allTargetNormalized.has(n) && !mustNotContainNormalized.has(n);
    })
    .map((item) => ({
      term: item.term,
      level: item.level,
      list: item.list,
    }));

  // Global fixture scores
  const fixtureRecall = (phrases.recall + polysemous.recall + vocabulary.recall) / 3;
  const avgLevelAccuracy = (phrases.levelAccuracy + polysemous.levelAccuracy + vocabulary.levelAccuracy) / 3;
  const fixtureAccuracy = 0.50 * avgLevelAccuracy + 0.30 * precision + 0.20 * textFitAccuracy;

  return {
    phrases,
    polysemous,
    vocabulary,
    textFitAccuracy,
    precision,
    mustNotContainViolations: violations,
    unmatchedReport: {
      extractedButNotInTargets,
    },
    fixtureRecall,
    fixtureAccuracy,
  };
}
