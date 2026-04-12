import { describe, it, expect } from 'vitest';
import {
  cefrDistance,
  textFitScore,
  normalizeTerm,
  termsMatch,
  scoreList,
  scoreResult,
} from '../scorer.js';
import type { ExtractionOutput } from '../checker.js';
import type { Fixture, CefrLevel } from '../runner.js';

// ---- cefrDistance ----

describe('cefrDistance', () => {
  it('returns 0 for same level', () => {
    expect(cefrDistance('B1', 'B1')).toBe(0);
  });

  it('returns positive for higher first', () => {
    expect(cefrDistance('B2', 'B1')).toBe(1);
  });

  it('returns negative for lower first', () => {
    expect(cefrDistance('B1', 'B2')).toBe(-1);
  });

  it('returns 2 for two levels apart', () => {
    expect(cefrDistance('B2', 'A2')).toBe(2);
  });

  it('returns 5 for maximum distance', () => {
    expect(cefrDistance('C2', 'A1')).toBe(5);
  });

  it('throws for invalid level', () => {
    expect(() => cefrDistance('D1' as CefrLevel, 'A1')).toThrow();
  });
});

// ---- textFitScore ----

describe('textFitScore', () => {
  it('returns 100 for exact match', () => {
    expect(textFitScore('appropriate', 'appropriate')).toBe(100);
  });

  it('returns 50 for off by 1 step (stretch vs appropriate)', () => {
    expect(textFitScore('stretch', 'appropriate')).toBe(50);
  });

  it('returns 50 for off by 1 step (easy vs appropriate)', () => {
    expect(textFitScore('easy', 'appropriate')).toBe(50);
  });

  it('returns 0 for off by 2 steps', () => {
    expect(textFitScore('too_hard', 'appropriate')).toBe(0);
  });

  it('returns 0 for off by 3 steps', () => {
    expect(textFitScore('too_hard', 'easy')).toBe(0);
  });

  it('returns 100 for not_applicable matching', () => {
    expect(textFitScore('not_applicable', 'not_applicable')).toBe(100);
  });

  it('returns 0 for not_applicable vs any other', () => {
    expect(textFitScore('not_applicable', 'appropriate')).toBe(0);
  });

  it('returns 0 for any value vs not_applicable', () => {
    expect(textFitScore('appropriate', 'not_applicable')).toBe(0);
  });
});

// ---- normalizeTerm / termsMatch ----

describe('normalizeTerm', () => {
  it('lowercases', () => {
    expect(normalizeTerm('Sustainable')).toBe('sustainable');
  });

  it('trims whitespace', () => {
    expect(normalizeTerm('  break down  ')).toBe('break down');
  });

  it('lowercases and trims', () => {
    expect(normalizeTerm('BREAK DOWN')).toBe('break down');
  });
});

describe('termsMatch', () => {
  it('matches case-insensitively', () => {
    expect(termsMatch('Sustainable', 'sustainable')).toBe(true);
  });

  it('matches with whitespace differences', () => {
    expect(termsMatch(' Run ', 'run')).toBe(true);
  });

  it('does not lemmatize', () => {
    expect(termsMatch('running', 'run')).toBe(false);
  });

  it('matches phrases case-insensitively', () => {
    expect(termsMatch('break down', 'Break Down')).toBe(true);
  });

  it('respects whitespace in phrases', () => {
    expect(termsMatch('breakdown', 'break down')).toBe(false);
  });
});

// ---- scoreList ----

describe('scoreList', () => {
  it('returns 100% recall when all targets found', () => {
    const extracted = [
      { term: 'sustainable', level: 'B2' as CefrLevel },
      { term: 'pollution', level: 'B2' as CefrLevel },
    ];
    const target = [
      { term: 'sustainable', expectedLevel: 'B2' as CefrLevel },
      { term: 'pollution', expectedLevel: 'B2' as CefrLevel },
    ];
    const result = scoreList(extracted, target);
    expect(result.recall).toBe(100);
  });

  it('returns 50% recall when half found', () => {
    const extracted = [{ term: 'sustainable', level: 'B2' as CefrLevel }];
    const target = [
      { term: 'sustainable', expectedLevel: 'B2' as CefrLevel },
      { term: 'pollution', expectedLevel: 'B2' as CefrLevel },
    ];
    const result = scoreList(extracted, target);
    expect(result.recall).toBe(50);
  });

  it('returns 0% recall when none found', () => {
    const extracted = [{ term: 'other', level: 'B1' as CefrLevel }];
    const target = [{ term: 'sustainable', expectedLevel: 'B2' as CefrLevel }];
    const result = scoreList(extracted, target);
    expect(result.recall).toBe(0);
  });

  it('returns 100% recall for empty target (vacuously)', () => {
    const result = scoreList([{ term: 'anything', level: 'B1' as CefrLevel }], []);
    expect(result.recall).toBe(100);
  });

  it('returns 100% recall for both empty', () => {
    const result = scoreList([], []);
    expect(result.recall).toBe(100);
  });

  it('returns 0% recall for empty extracted, non-empty target', () => {
    const result = scoreList([], [{ term: 'test', expectedLevel: 'B1' as CefrLevel }]);
    expect(result.recall).toBe(0);
  });

  it('returns 100% level accuracy for exact level matches', () => {
    const extracted = [{ term: 'sustainable', level: 'B2' as CefrLevel }];
    const target = [{ term: 'sustainable', expectedLevel: 'B2' as CefrLevel }];
    const result = scoreList(extracted, target);
    expect(result.levelAccuracy).toBe(100);
  });

  it('returns <100% level accuracy for off-by-1 (strict)', () => {
    const extracted = [{ term: 'sustainable', level: 'B1' as CefrLevel }];
    const target = [{ term: 'sustainable', expectedLevel: 'B2' as CefrLevel }];
    const result = scoreList(extracted, target);
    expect(result.levelAccuracy).toBe(0); // Strict — no tolerance
  });

  it('lists missed terms in details', () => {
    const result = scoreList([], [
      { term: 'a', expectedLevel: 'B1' as CefrLevel },
      { term: 'b', expectedLevel: 'B2' as CefrLevel },
    ]);
    expect(result.details.targetTermsMissed).toEqual(['a', 'b']);
  });

  it('lists level mismatches in details', () => {
    const extracted = [{ term: 'test', level: 'C1' as CefrLevel }];
    const target = [{ term: 'test', expectedLevel: 'B2' as CefrLevel }];
    const result = scoreList(extracted, target);
    expect(result.details.levelMismatches).toHaveLength(1);
    expect(result.details.levelMismatches[0]).toMatchObject({
      term: 'test',
      expectedLevel: 'B2',
      actualLevel: 'C1',
    });
  });
});

// ---- scoreResult ----

describe('scoreResult', () => {
  const makeFixture = (overrides: Partial<Fixture> = {}): Fixture => ({
    id: 'test',
    groups: ['test'],
    description: 'test',
    level: 'B1',
    passage: 'test',
    expectedTextFit: 'appropriate',
    targetPhrases: [],
    targetPolysemous: [],
    targetVocabulary: [],
    mustNotContain: [],
    ...overrides,
  });

  const makeOutput = (overrides: Partial<ExtractionOutput> = {}): ExtractionOutput => ({
    textFit: 'appropriate',
    phrases: [],
    polysemous: [],
    vocabulary: [],
    ...overrides,
  });

  it('scores all three lists independently', () => {
    const fixture = makeFixture({
      targetPhrases: [{ term: 'break down', expectedLevel: 'B2' }],
      targetPolysemous: [{ term: 'run', expectedLevel: 'B1' }],
      targetVocabulary: [{ term: 'sustainable', expectedLevel: 'B2' }],
    });
    const output = makeOutput({
      phrases: [{ term: 'break down', level: 'B2' }],
      polysemous: [],
      vocabulary: [{ term: 'sustainable', level: 'B2' }],
    });
    const result = scoreResult(output, fixture);
    expect(result.phrases.recall).toBe(100);
    expect(result.polysemous.recall).toBe(0); // missed "run"
    expect(result.vocabulary.recall).toBe(100);
  });

  it('computes textFitAccuracy with partial credit', () => {
    const fixture = makeFixture({ expectedTextFit: 'appropriate' });
    const output = makeOutput({ textFit: 'stretch' });
    const result = scoreResult(output, fixture);
    expect(result.textFitAccuracy).toBe(50);
  });

  it('catches mustNotContain violations', () => {
    const fixture = makeFixture({ mustNotContain: ['bad'] });
    const output = makeOutput({
      vocabulary: [{ term: 'bad', level: 'B1' }],
    });
    const result = scoreResult(output, fixture);
    expect(result.precision).toBeLessThan(100);
    expect(result.mustNotContainViolations).toContain('bad');
  });

  it('reports extracted-but-not-in-targets', () => {
    const fixture = makeFixture({
      targetVocabulary: [{ term: 'known', expectedLevel: 'B1' }],
    });
    const output = makeOutput({
      vocabulary: [
        { term: 'known', level: 'B1' },
        { term: 'surprise', level: 'B2' },
      ],
    });
    const result = scoreResult(output, fixture);
    expect(result.unmatchedReport.extractedButNotInTargets).toHaveLength(1);
    expect(result.unmatchedReport.extractedButNotInTargets[0]).toMatchObject({
      term: 'surprise',
      list: 'vocabulary',
    });
  });

  it('empty extraction for non-English fixture', () => {
    const fixture = makeFixture({
      expectedTextFit: 'not_applicable',
      targetPhrases: [],
      targetPolysemous: [],
      targetVocabulary: [],
    });
    const output = makeOutput({ textFit: 'not_applicable' });
    const result = scoreResult(output, fixture);
    expect(result.phrases.recall).toBe(100);
    expect(result.polysemous.recall).toBe(100);
    expect(result.vocabulary.recall).toBe(100);
    expect(result.textFitAccuracy).toBe(100);
    expect(result.precision).toBe(100);
  });

  it('empty extraction for normal fixture = 0% recall', () => {
    const fixture = makeFixture({
      targetPhrases: [{ term: 'break down', expectedLevel: 'B2' }],
      targetVocabulary: [{ term: 'sustainable', expectedLevel: 'B2' }],
    });
    const output = makeOutput();
    const result = scoreResult(output, fixture);
    expect(result.phrases.recall).toBe(0);
    expect(result.vocabulary.recall).toBe(0);
  });

  it('polysemous target in vocabulary list = missed in polysemous', () => {
    const fixture = makeFixture({
      targetPolysemous: [{ term: 'run', expectedLevel: 'B1' }],
    });
    const output = makeOutput({
      vocabulary: [{ term: 'run', level: 'B1' }], // wrong list
    });
    const result = scoreResult(output, fixture);
    expect(result.polysemous.recall).toBe(0); // missed in polysemous
    // "run" is in targetPolysemous (a known target), so it does NOT appear in
    // extractedButNotInTargets — it's a known term in the wrong list, not an unknown term.
    // The user sees this via polysemous.recall being 0% and can investigate.
    expect(result.unmatchedReport.extractedButNotInTargets.some(
      (t) => t.term === 'run'
    )).toBe(false);
  });
});
