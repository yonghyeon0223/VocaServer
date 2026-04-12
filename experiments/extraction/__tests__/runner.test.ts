import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'fs';
import {
  parseFilters,
  loadPrompt,
  substituteVariables,
  loadFixtures,
  filterFixtures,
  filterPrompts,
  mergeConfig,
  getPromptVersion,
  DEFAULT_CONFIG,
} from '../runner.js';

const TEST_FIXTURES_DIR = 'experiments/extraction/__tests__/fixtures';

// ---- parseFilters ----

describe('parseFilters', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns empty object when no env vars set', () => {
    delete process.env['FIXTURE'];
    delete process.env['GROUP'];
    delete process.env['PROMPT'];
    delete process.env['DRY_RUN'];
    delete process.env['FAIL_FAST'];
    const filters = parseFilters();
    expect(filters.fixtureId).toBeUndefined();
    expect(filters.groups).toBeUndefined();
  });

  it('parses FIXTURE env var', () => {
    process.env['FIXTURE'] = 'test-05';
    expect(parseFilters().fixtureId).toBe('test-05');
  });

  it('parses GROUP env var', () => {
    process.env['GROUP'] = 'normal';
    expect(parseFilters().groups).toEqual(['normal']);
  });

  it('parses comma-separated GROUP', () => {
    process.env['GROUP'] = 'normal,edge,injection';
    expect(parseFilters().groups).toEqual(['normal', 'edge', 'injection']);
  });

  it('trims whitespace in GROUP', () => {
    process.env['GROUP'] = ' normal , edge ';
    expect(parseFilters().groups).toEqual(['normal', 'edge']);
  });

  it('parses PROMPT env var', () => {
    process.env['PROMPT'] = 'v2';
    expect(parseFilters().promptVersion).toBe('v2');
  });

  it('parses DRY_RUN=true', () => {
    process.env['DRY_RUN'] = 'true';
    expect(parseFilters().dryRun).toBe(true);
  });

  it('DRY_RUN=false does not set flag', () => {
    process.env['DRY_RUN'] = 'false';
    expect(parseFilters().dryRun).toBeUndefined();
  });

  it('FAIL_FAST=true', () => {
    process.env['FAIL_FAST'] = 'true';
    expect(parseFilters().failFast).toBe(true);
  });
});

// ---- loadPrompt ----

describe('loadPrompt', () => {
  const tmpDir = join(TEST_FIXTURES_DIR, 'tmp-prompts');

  beforeAll(() => {
    if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
  });

  afterAll(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  });

  it('parses SYSTEM and USER sections', () => {
    const path = join(tmpDir, 'basic.txt');
    writeFileSync(path, '===SYSTEM===\nYou are a helper.\n===USER===\nHello {{LEVEL}}', 'utf-8');
    const prompt = loadPrompt(path);
    expect(prompt.system).toBe('You are a helper.');
    expect(prompt.user).toBe('Hello {{LEVEL}}');
    expect(prompt.meta).toEqual({});
  });

  it('parses META section', () => {
    const path = join(tmpDir, 'with-meta.txt');
    writeFileSync(path, '===SYSTEM===\nSystem\n===USER===\nUser\n===META===\ntemperature=0.3\nmaxTokens=2000', 'utf-8');
    const prompt = loadPrompt(path);
    expect(prompt.meta['temperature']).toBe('0.3');
    expect(prompt.meta['maxTokens']).toBe('2000');
  });

  it('handles sections in any order', () => {
    const path = join(tmpDir, 'reversed.txt');
    writeFileSync(path, '===USER===\nUser first\n===SYSTEM===\nSystem second', 'utf-8');
    const prompt = loadPrompt(path);
    expect(prompt.user).toBe('User first');
    expect(prompt.system).toBe('System second');
  });

  it('preserves multi-line content', () => {
    const path = join(tmpDir, 'multiline.txt');
    writeFileSync(path, '===SYSTEM===\nLine 1\nLine 2\nLine 3\n===USER===\nUser', 'utf-8');
    const prompt = loadPrompt(path);
    expect(prompt.system).toContain('Line 1');
    expect(prompt.system).toContain('Line 3');
  });

  it('throws for missing file', () => {
    expect(() => loadPrompt('/nonexistent/path.txt')).toThrow();
  });

  it('handles meta value with = sign', () => {
    const path = join(tmpDir, 'eq-meta.txt');
    writeFileSync(path, '===SYSTEM===\nSys\n===USER===\nUsr\n===META===\nkey=val=ue', 'utf-8');
    const prompt = loadPrompt(path);
    expect(prompt.meta['key']).toBe('val=ue');
  });
});

// ---- substituteVariables ----

describe('substituteVariables', () => {
  it('substitutes single variable', () => {
    expect(substituteVariables('Level: {{LEVEL}}', { LEVEL: 'B1' })).toBe('Level: B1');
  });

  it('substitutes multiple variables', () => {
    const result = substituteVariables('{{LEVEL}} reads {{TEXT}}', { LEVEL: 'B1', TEXT: 'hello' });
    expect(result).toBe('B1 reads hello');
  });

  it('replaces all occurrences of same variable', () => {
    expect(substituteVariables('{{X}} and {{X}}', { X: 'yes' })).toBe('yes and yes');
  });

  it('leaves unmatched placeholders as-is', () => {
    expect(substituteVariables('{{LEVEL}} {{MISSING}}', { LEVEL: 'B1' })).toBe('B1 {{MISSING}}');
  });

  it('returns template unchanged with no variables', () => {
    expect(substituteVariables('no vars here', {})).toBe('no vars here');
  });

  it('handles variable value containing {{', () => {
    expect(substituteVariables('{{X}}', { X: '{{Y}}' })).toBe('{{Y}}');
  });

  it('handles empty string value', () => {
    expect(substituteVariables('a{{X}}b', { X: '' })).toBe('ab');
  });
});

// ---- filterFixtures ----

describe('filterFixtures', () => {
  const fixtures = [
    { id: 'test-01', groups: ['normal', 'default'], level: 'A1', passage: '', description: '', expectedTextFit: 'appropriate', targetPhrases: [], targetPolysemous: [], targetVocabulary: [], mustNotContain: [] },
    { id: 'test-02', groups: ['normal', 'default'], level: 'A2', passage: '', description: '', expectedTextFit: 'appropriate', targetPhrases: [], targetPolysemous: [], targetVocabulary: [], mustNotContain: [] },
    { id: 'test-10', groups: ['edge'], level: 'A2', passage: '', description: '', expectedTextFit: 'appropriate', targetPhrases: [], targetPolysemous: [], targetVocabulary: [], mustNotContain: [] },
    { id: 'test-32', groups: ['injection', 'security'], level: 'B1', passage: '', description: '', expectedTextFit: 'not_applicable', targetPhrases: [], targetPolysemous: [], targetVocabulary: [], mustNotContain: [] },
  ] as any[];

  it('returns default-tagged fixtures when no filter set', () => {
    const result = filterFixtures(fixtures, {});
    expect(result).toHaveLength(2);
    expect(result.map((f: any) => f.id)).toEqual(['test-01', 'test-02']);
  });

  it('filters by fixtureId', () => {
    const result = filterFixtures(fixtures, { fixtureId: 'test-10' });
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('test-10');
  });

  it('returns empty for non-matching fixtureId', () => {
    expect(filterFixtures(fixtures, { fixtureId: 'test-99' })).toHaveLength(0);
  });

  it('filters by group', () => {
    const result = filterFixtures(fixtures, { groups: ['edge'] });
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('test-10');
  });

  it('filters by multiple groups (union)', () => {
    const result = filterFixtures(fixtures, { groups: ['edge', 'injection'] });
    expect(result).toHaveLength(2);
  });

  it('fixtureId takes precedence over groups', () => {
    const result = filterFixtures(fixtures, { fixtureId: 'test-01', groups: ['edge'] });
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('test-01');
  });
});

// ---- filterPrompts ----

describe('filterPrompts', () => {
  const paths = ['/prompts/v1.txt', '/prompts/v2.txt', '/prompts/v10.txt'];

  it('returns all when no filter', () => {
    expect(filterPrompts(paths, {})).toEqual(paths);
  });

  it('filters by exact version', () => {
    expect(filterPrompts(paths, { promptVersion: 'v2' })).toEqual(['/prompts/v2.txt']);
  });

  it('no v1 vs v10 confusion', () => {
    expect(filterPrompts(paths, { promptVersion: 'v1' })).toEqual(['/prompts/v1.txt']);
  });

  it('returns empty for non-matching version', () => {
    expect(filterPrompts(paths, { promptVersion: 'v3' })).toEqual([]);
  });
});

// ---- mergeConfig ----

describe('mergeConfig', () => {
  it('returns defaults when no META', () => {
    const result = mergeConfig(DEFAULT_CONFIG, {});
    expect(result).toEqual(DEFAULT_CONFIG);
  });

  it('overrides temperature from META', () => {
    const result = mergeConfig(DEFAULT_CONFIG, { temperature: '0.3' });
    expect(result.temperature).toBe(0.3);
  });

  it('coerces numeric strings', () => {
    const result = mergeConfig(DEFAULT_CONFIG, { maxTokens: '2000' });
    expect(result.maxTokens).toBe(2000);
  });

  it('ignores unknown META keys', () => {
    const result = mergeConfig(DEFAULT_CONFIG, { unknownKey: 'value' });
    expect(result).toEqual(DEFAULT_CONFIG);
  });
});

// ---- getPromptVersion ----

describe('getPromptVersion', () => {
  it('extracts version from path', () => {
    expect(getPromptVersion('/some/path/v1.txt')).toBe('v1');
  });

  it('handles nested paths', () => {
    expect(getPromptVersion('experiments/extraction/prompts/v2.txt')).toBe('v2');
  });
});
