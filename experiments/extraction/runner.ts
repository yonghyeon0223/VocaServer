import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'fs';
import { join, basename } from 'path';

// ---- Types ----

export type CefrLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';
export type TextFit = 'too_easy' | 'easy' | 'appropriate' | 'stretch' | 'too_hard' | 'not_applicable';

export interface TargetTerm {
  term: string;
  expectedLevel: CefrLevel;
}

export interface Fixture {
  id: string;
  groups: string[];
  description: string;
  level: CefrLevel;
  passage: string;
  expectedTextFit: TextFit;
  targetPhrases: TargetTerm[];
  targetPolysemous: TargetTerm[];
  targetVocabulary: TargetTerm[];
  mustNotContain: string[];
}

export interface RunConfig {
  model: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
}

export interface RunResult {
  fixtureId: string;
  promptVersion: string;
  rawResponse: string;
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
  };
  latencyMs: number;
  temperature: number;
  model: string;
  timestamp: string;
}

export interface RunFilters {
  fixtureId?: string;
  groups?: string[];
  promptVersion?: string;
  dryRun?: boolean;
  failFast?: boolean;
}

export interface ParsedPrompt {
  system: string;
  user: string;
  meta: Record<string, string>;
}

// ---- Default Config ----

export const DEFAULT_CONFIG: RunConfig = {
  model: 'claude-haiku-4-5-20251001',
  temperature: 0.0,
  maxTokens: 4096,
  timeoutMs: 30000,
};

// ---- Env Filter Parsing ----

export function parseFilters(): RunFilters {
  const filters: RunFilters = {};

  const fixture = process.env['FIXTURE'];
  if (fixture && fixture.trim().length > 0) {
    filters.fixtureId = fixture.trim();
  }

  const group = process.env['GROUP'];
  if (group && group.trim().length > 0) {
    filters.groups = group.split(',').map((g) => g.trim()).filter((g) => g.length > 0);
  }

  const prompt = process.env['PROMPT'];
  if (prompt && prompt.trim().length > 0) {
    filters.promptVersion = prompt.trim();
  }

  const dryRun = process.env['DRY_RUN'];
  if (dryRun === 'true') {
    filters.dryRun = true;
  }

  const failFast = process.env['FAIL_FAST'];
  if (failFast === 'true') {
    filters.failFast = true;
  }

  return filters;
}

// ---- Fixture Loading ----

export function loadFixtures(fixturesDir: string): Fixture[] {
  if (!existsSync(fixturesDir)) {
    throw new Error(`Fixtures directory does not exist: ${fixturesDir}`);
  }

  const files = readdirSync(fixturesDir).filter((f) => f.endsWith('.json'));
  const fixtures: Fixture[] = [];

  for (const file of files) {
    const filePath = join(fixturesDir, file);
    let content: string;
    try {
      content = readFileSync(filePath, 'utf-8');
    } catch (err) {
      throw new Error(`Failed to read fixture file ${filePath}: ${err}`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      throw new Error(`Malformed JSON in fixture file ${filePath}: ${err}`);
    }

    const fixture = parsed as Fixture;

    // Basic validation
    if (!fixture.id || typeof fixture.id !== 'string') {
      throw new Error(`Fixture in ${filePath} missing required field: id`);
    }
    if (!fixture.level || typeof fixture.level !== 'string') {
      throw new Error(`Fixture ${fixture.id} missing required field: level`);
    }
    if (!Array.isArray(fixture.groups)) {
      throw new Error(`Fixture ${fixture.id} missing required field: groups (must be array)`);
    }
    if (typeof fixture.passage !== 'string') {
      throw new Error(`Fixture ${fixture.id} missing required field: passage`);
    }

    fixtures.push(fixture);
  }

  return fixtures;
}

// ---- Fixture Filtering ----

export function filterFixtures(fixtures: Fixture[], filters: RunFilters): Fixture[] {
  if (filters.fixtureId) {
    return fixtures.filter((f) => f.id === filters.fixtureId);
  }

  if (filters.groups && filters.groups.length > 0) {
    return fixtures.filter((f) =>
      filters.groups!.some((g) => f.groups.includes(g))
    );
  }

  // Default: return fixtures tagged "default"
  return fixtures.filter((f) => f.groups.includes('default'));
}

// ---- Prompt Loading ----

export function loadPrompt(promptPath: string): ParsedPrompt {
  if (!existsSync(promptPath)) {
    throw new Error(`Prompt file does not exist: ${promptPath}`);
  }

  const content = readFileSync(promptPath, 'utf-8');
  const result: ParsedPrompt = { system: '', user: '', meta: {} };

  // Parse sections by delimiter
  const sections = content.split(/^(===(?:SYSTEM|USER|META)===)\s*$/m);

  let currentSection: 'system' | 'user' | 'meta' | null = null;

  for (const section of sections) {
    const trimmed = section.trim();
    if (trimmed === '===SYSTEM===') {
      currentSection = 'system';
    } else if (trimmed === '===USER===') {
      currentSection = 'user';
    } else if (trimmed === '===META===') {
      currentSection = 'meta';
    } else if (currentSection === 'system') {
      result.system = trimmed;
    } else if (currentSection === 'user') {
      result.user = trimmed;
    } else if (currentSection === 'meta') {
      // Parse key=value pairs
      for (const line of trimmed.split('\n')) {
        const lineContent = line.trim();
        if (!lineContent || lineContent.startsWith('#')) continue;
        const eqIndex = lineContent.indexOf('=');
        if (eqIndex === -1) continue;
        const key = lineContent.slice(0, eqIndex).trim();
        const value = lineContent.slice(eqIndex + 1).trim();
        result.meta[key] = value;
      }
    }
  }

  if (!result.system && !result.user) {
    throw new Error(`Prompt file ${promptPath} must have at least ===SYSTEM=== or ===USER=== section`);
  }

  return result;
}

export function loadPrompts(promptsDir: string): string[] {
  if (!existsSync(promptsDir)) {
    throw new Error(`Prompts directory does not exist: ${promptsDir}`);
  }

  return readdirSync(promptsDir)
    .filter((f) => f.endsWith('.txt'))
    .map((f) => join(promptsDir, f))
    .sort();
}

export function filterPrompts(promptPaths: string[], filters: RunFilters): string[] {
  if (!filters.promptVersion) {
    return promptPaths;
  }

  const target = `${filters.promptVersion}.txt`;
  return promptPaths.filter((p) => basename(p) === target);
}

// ---- Variable Substitution ----

export function substituteVariables(
  template: string,
  variables: Record<string, string>,
): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    // Replace all occurrences of {{KEY}} with value
    const placeholder = `{{${key}}}`;
    while (result.includes(placeholder)) {
      result = result.replace(placeholder, value);
    }
  }
  return result;
}

// ---- Config Merging ----

export function mergeConfig(
  defaults: RunConfig,
  promptMeta: Record<string, string>,
): RunConfig {
  const merged = { ...defaults };

  if (promptMeta['temperature'] !== undefined) {
    const val = Number(promptMeta['temperature']);
    if (Number.isFinite(val)) merged.temperature = val;
  }
  if (promptMeta['maxTokens'] !== undefined) {
    const val = Number(promptMeta['maxTokens']);
    if (Number.isFinite(val) && val > 0) merged.maxTokens = Math.floor(val);
  }
  if (promptMeta['timeoutMs'] !== undefined) {
    const val = Number(promptMeta['timeoutMs']);
    if (Number.isFinite(val) && val > 0) merged.timeoutMs = Math.floor(val);
  }
  if (promptMeta['model'] !== undefined) {
    merged.model = promptMeta['model'];
  }

  return merged;
}

// ---- Prompt Version Name ----

export function getPromptVersion(promptPath: string): string {
  return basename(promptPath, '.txt');
}

// ---- Single Run ----

export async function runSingle(
  client: Anthropic,
  prompt: { system: string; user: string },
  config: RunConfig,
): Promise<{ rawResponse: string; tokenUsage: { inputTokens: number; outputTokens: number }; latencyMs: number }> {
  const start = Date.now();

  const response = await client.messages.create({
    model: config.model,
    max_tokens: config.maxTokens,
    temperature: config.temperature,
    system: prompt.system,
    messages: [{ role: 'user', content: prompt.user }],
  });

  const latencyMs = Date.now() - start;

  const rawResponse = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');

  return {
    rawResponse,
    tokenUsage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
    latencyMs,
  };
}

// ---- Run All ----

export async function runAll(
  client: Anthropic,
  fixtures: Fixture[],
  promptPaths: string[],
  defaults: RunConfig,
  resultsDir: string,
  filters: RunFilters,
): Promise<RunResult[]> {
  // Ensure results directory exists
  if (!existsSync(resultsDir)) {
    mkdirSync(resultsDir, { recursive: true });
  }

  const results: RunResult[] = [];

  for (const promptPath of promptPaths) {
    const prompt = loadPrompt(promptPath);
    const config = mergeConfig(defaults, prompt.meta);
    const version = getPromptVersion(promptPath);

    for (const fixture of fixtures) {
      const variables: Record<string, string> = {
        LEVEL: fixture.level,
        TEXT: fixture.passage,
      };

      const system = substituteVariables(prompt.system, variables);
      const user = substituteVariables(prompt.user, variables);

      const timestamp = new Date().toISOString();

      if (filters.dryRun) {
        results.push({
          fixtureId: fixture.id,
          promptVersion: version,
          rawResponse: '{"textFit":"not_applicable","phrases":[],"polysemous":[],"vocabulary":[]}',
          tokenUsage: { inputTokens: 0, outputTokens: 0 },
          latencyMs: 0,
          temperature: config.temperature,
          model: config.model,
          timestamp,
        });
        continue;
      }

      try {
        const response = await runSingle(client, { system, user }, config);

        const result: RunResult = {
          fixtureId: fixture.id,
          promptVersion: version,
          rawResponse: response.rawResponse,
          tokenUsage: response.tokenUsage,
          latencyMs: response.latencyMs,
          temperature: config.temperature,
          model: config.model,
          timestamp,
        };

        results.push(result);

        // Save raw response
        const resultFile = join(resultsDir, `${fixture.id}_${version}_${Date.now()}.json`);
        writeFileSync(resultFile, JSON.stringify(result, null, 2), 'utf-8');

      } catch (err) {
        const result: RunResult = {
          fixtureId: fixture.id,
          promptVersion: version,
          rawResponse: `ERROR: ${err instanceof Error ? err.message : String(err)}`,
          tokenUsage: { inputTokens: 0, outputTokens: 0 },
          latencyMs: 0,
          temperature: config.temperature,
          model: config.model,
          timestamp,
        };

        results.push(result);

        if (filters.failFast) {
          break;
        }
      }
    }

    if (filters.failFast && results.some((r) => r.rawResponse.startsWith('ERROR:'))) {
      break;
    }
  }

  return results;
}
