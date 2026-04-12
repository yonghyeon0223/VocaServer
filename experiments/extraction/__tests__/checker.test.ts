import { describe, it, expect } from 'vitest';
import {
  checkValidJson,
  checkTopLevelSchema,
  checkTextFitValid,
  checkTermObjectsValid,
  checkNoDuplicateTerms,
  checkValidLevels,
  checkNoCrossListDuplicates,
  runChecks,
} from '../checker.js';

// ---- checkValidJson ----

describe('checkValidJson', () => {
  it('passes for valid JSON object', () => {
    expect(checkValidJson('{"textFit":"appropriate","phrases":[],"polysemous":[],"vocabulary":[]}')).toMatchObject({ passed: true });
  });

  it('passes for empty object', () => {
    expect(checkValidJson('{}')).toMatchObject({ passed: true });
  });

  it('fails for invalid JSON', () => {
    expect(checkValidJson('{invalid}')).toMatchObject({ passed: false });
  });

  it('fails for markdown fenced JSON', () => {
    expect(checkValidJson('```json\n{}\n```')).toMatchObject({ passed: false });
  });

  it('fails for trailing comma', () => {
    expect(checkValidJson('{"a": 1,}')).toMatchObject({ passed: false });
  });

  it('fails for empty string', () => {
    expect(checkValidJson('')).toMatchObject({ passed: false });
  });

  it('fails for prose', () => {
    expect(checkValidJson('Here are the results...')).toMatchObject({ passed: false });
  });

  it('fails for JSON wrapped in text', () => {
    expect(checkValidJson('The output is: {"a":1}')).toMatchObject({ passed: false });
  });
});

// ---- checkTopLevelSchema ----

describe('checkTopLevelSchema', () => {
  it('passes for complete schema', () => {
    const parsed = { textFit: 'appropriate', phrases: [], polysemous: [], vocabulary: [] };
    expect(checkTopLevelSchema(parsed)).toMatchObject({ passed: true });
  });

  it('fails for missing textFit', () => {
    const parsed = { phrases: [], polysemous: [], vocabulary: [] };
    expect(checkTopLevelSchema(parsed)).toMatchObject({ passed: false, message: expect.stringContaining('textFit') });
  });

  it('fails for missing phrases', () => {
    const parsed = { textFit: 'appropriate', polysemous: [], vocabulary: [] };
    expect(checkTopLevelSchema(parsed)).toMatchObject({ passed: false, message: expect.stringContaining('phrases') });
  });

  it('fails for non-array phrases', () => {
    const parsed = { textFit: 'appropriate', phrases: 'not array', polysemous: [], vocabulary: [] };
    expect(checkTopLevelSchema(parsed)).toMatchObject({ passed: false });
  });

  it('fails for array instead of object', () => {
    expect(checkTopLevelSchema([])).toMatchObject({ passed: false });
  });

  it('fails for extra top-level fields', () => {
    const parsed = { textFit: 'appropriate', phrases: [], polysemous: [], vocabulary: [], extra: true };
    expect(checkTopLevelSchema(parsed)).toMatchObject({ passed: false, message: expect.stringContaining('extra') });
  });

  it('passes with all empty lists', () => {
    const parsed = { textFit: 'not_applicable', phrases: [], polysemous: [], vocabulary: [] };
    expect(checkTopLevelSchema(parsed)).toMatchObject({ passed: true });
  });
});

// ---- checkTextFitValid ----

describe('checkTextFitValid', () => {
  for (const value of ['too_easy', 'easy', 'appropriate', 'stretch', 'too_hard', 'not_applicable']) {
    it(`passes for "${value}"`, () => {
      expect(checkTextFitValid({ textFit: value })).toMatchObject({ passed: true });
    });
  }

  it('fails for invalid value', () => {
    expect(checkTextFitValid({ textFit: 'challenging' })).toMatchObject({ passed: false });
  });

  it('fails for empty string', () => {
    expect(checkTextFitValid({ textFit: '' })).toMatchObject({ passed: false });
  });

  it('fails for wrong case', () => {
    expect(checkTextFitValid({ textFit: 'Appropriate' })).toMatchObject({ passed: false });
  });
});

// ---- checkTermObjectsValid ----

describe('checkTermObjectsValid', () => {
  it('passes for valid term objects', () => {
    const parsed = {
      phrases: [{ term: 'break down', level: 'B1', context: ['it broke down'] }],
      polysemous: [{ term: 'run', level: 'B2' }],
      vocabulary: [{ term: 'sustainable', level: 'B2', context: ['sustainable energy'] }],
    };
    expect(checkTermObjectsValid(parsed)).toMatchObject({ passed: true });
  });

  it('passes for multi-word term', () => {
    const parsed = { phrases: [{ term: 'spill the beans', level: 'C2' }], polysemous: [], vocabulary: [] };
    expect(checkTermObjectsValid(parsed)).toMatchObject({ passed: true });
  });

  it('fails for missing term field', () => {
    const parsed = { phrases: [{ level: 'B1' }], polysemous: [], vocabulary: [] };
    expect(checkTermObjectsValid(parsed)).toMatchObject({ passed: false, message: expect.stringContaining('term') });
  });

  it('fails for missing level field', () => {
    const parsed = { phrases: [{ term: 'break down' }], polysemous: [], vocabulary: [] };
    expect(checkTermObjectsValid(parsed)).toMatchObject({ passed: false, message: expect.stringContaining('level') });
  });

  it('fails for non-string term', () => {
    const parsed = { phrases: [{ term: 123, level: 'B1' }], polysemous: [], vocabulary: [] };
    expect(checkTermObjectsValid(parsed)).toMatchObject({ passed: false });
  });

  it('fails for context as string instead of array', () => {
    const parsed = { phrases: [{ term: 'test', level: 'B1', context: 'not an array' }], polysemous: [], vocabulary: [] };
    expect(checkTermObjectsValid(parsed)).toMatchObject({ passed: false });
  });

  it('fails for extra field on term object', () => {
    const parsed = { phrases: [{ term: 'test', level: 'B1', definition: 'nope' }], polysemous: [], vocabulary: [] };
    expect(checkTermObjectsValid(parsed)).toMatchObject({ passed: false, message: expect.stringContaining('definition') });
  });

  it('validates across all three lists', () => {
    const parsed = {
      phrases: [{ term: 'ok', level: 'B1' }],
      polysemous: [{ term: 'run', level: 'bad_level_but_still_string' }],
      vocabulary: [],
    };
    // This should pass term validation (level is a string), but fail level validation later
    expect(checkTermObjectsValid(parsed)).toMatchObject({ passed: true });
  });
});

// ---- checkNoDuplicateTerms ----

describe('checkNoDuplicateTerms', () => {
  it('passes with all unique terms', () => {
    const output = {
      textFit: 'appropriate' as const,
      phrases: [{ term: 'break down', level: 'B1' as const }],
      polysemous: [{ term: 'run', level: 'B2' as const }],
      vocabulary: [{ term: 'sustainable', level: 'B2' as const }],
    };
    expect(checkNoDuplicateTerms(output)).toMatchObject({ passed: true });
  });

  it('fails for duplicate within a list', () => {
    const output = {
      textFit: 'appropriate' as const,
      phrases: [
        { term: 'break down', level: 'B1' as const },
        { term: 'break down', level: 'B2' as const },
      ],
      polysemous: [],
      vocabulary: [],
    };
    expect(checkNoDuplicateTerms(output)).toMatchObject({ passed: false });
  });

  it('catches case-insensitive duplicates', () => {
    const output = {
      textFit: 'appropriate' as const,
      phrases: [],
      polysemous: [],
      vocabulary: [
        { term: 'Run', level: 'B1' as const },
        { term: 'run', level: 'B2' as const },
      ],
    };
    expect(checkNoDuplicateTerms(output)).toMatchObject({ passed: false });
  });

  it('passes with empty lists', () => {
    const output = { textFit: 'not_applicable' as const, phrases: [], polysemous: [], vocabulary: [] };
    expect(checkNoDuplicateTerms(output)).toMatchObject({ passed: true });
  });
});

// ---- checkValidLevels ----

describe('checkValidLevels', () => {
  it('passes for all valid CEFR levels', () => {
    const output = {
      textFit: 'appropriate' as const,
      phrases: [{ term: 'test', level: 'A1' as const }],
      polysemous: [{ term: 'run', level: 'C2' as const }],
      vocabulary: [{ term: 'word', level: 'B1' as const }],
    };
    expect(checkValidLevels(output)).toMatchObject({ passed: true });
  });

  it('fails for invalid level', () => {
    const output = {
      textFit: 'appropriate' as const,
      phrases: [{ term: 'test', level: 'D1' as const }],
      polysemous: [],
      vocabulary: [],
    };
    expect(checkValidLevels(output)).toMatchObject({ passed: false, message: expect.stringContaining('D1') });
  });

  it('fails for lowercase level', () => {
    const output = {
      textFit: 'appropriate' as const,
      phrases: [],
      polysemous: [{ term: 'run', level: 'b1' as const }],
      vocabulary: [],
    };
    expect(checkValidLevels(output)).toMatchObject({ passed: false });
  });
});

// ---- checkNoCrossListDuplicates ----

describe('checkNoCrossListDuplicates', () => {
  it('passes when each term in one list only', () => {
    const output = {
      textFit: 'appropriate' as const,
      phrases: [{ term: 'break down', level: 'B1' as const }],
      polysemous: [{ term: 'run', level: 'B2' as const }],
      vocabulary: [{ term: 'sustainable', level: 'B2' as const }],
    };
    expect(checkNoCrossListDuplicates(output)).toMatchObject({ passed: true });
  });

  it('fails when same term in phrases and vocabulary', () => {
    const output = {
      textFit: 'appropriate' as const,
      phrases: [{ term: 'test', level: 'B1' as const }],
      polysemous: [],
      vocabulary: [{ term: 'test', level: 'B2' as const }],
    };
    expect(checkNoCrossListDuplicates(output)).toMatchObject({ passed: false });
  });

  it('passes with empty lists', () => {
    const output = { textFit: 'not_applicable' as const, phrases: [], polysemous: [], vocabulary: [] };
    expect(checkNoCrossListDuplicates(output)).toMatchObject({ passed: true });
  });
});

// ---- runChecks orchestration ----

describe('runChecks', () => {
  it('passes for valid complete output', () => {
    const raw = JSON.stringify({
      textFit: 'appropriate',
      phrases: [{ term: 'break down', level: 'B1', context: ['it broke down'] }],
      polysemous: [{ term: 'run', level: 'B2', context: ['she runs a company'] }],
      vocabulary: [{ term: 'sustainable', level: 'B2', context: ['sustainable energy'] }],
    });
    const result = runChecks(raw);
    expect(result.allPassed).toBe(true);
    expect(result.parsedOutput).not.toBeNull();
    expect(result.parsedOutput!.phrases).toHaveLength(1);
  });

  it('fails fast on invalid JSON', () => {
    const result = runChecks('{invalid}');
    expect(result.allPassed).toBe(false);
    expect(result.parsedOutput).toBeNull();
    expect(result.checks).toHaveLength(1); // Only JSON check ran
  });

  it('handles all-empty lists (valid for non-English input)', () => {
    const raw = JSON.stringify({
      textFit: 'not_applicable',
      phrases: [],
      polysemous: [],
      vocabulary: [],
    });
    const result = runChecks(raw);
    expect(result.allPassed).toBe(true);
    expect(result.parsedOutput!.phrases).toHaveLength(0);
  });

  it('returns parsedOutput even if later checks fail', () => {
    const raw = JSON.stringify({
      textFit: 'appropriate',
      phrases: [{ term: 'test', level: 'INVALID' }],
      polysemous: [],
      vocabulary: [],
    });
    const result = runChecks(raw);
    expect(result.allPassed).toBe(false);
    expect(result.parsedOutput).not.toBeNull(); // Parsed but has invalid level
  });
});
