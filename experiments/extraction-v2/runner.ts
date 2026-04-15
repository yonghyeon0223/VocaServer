import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'fs';
import { join, basename } from 'path';
import { parseResponse, runStructuralChecks } from './structural-checks.js';
import type { ExtractedItem, StructuralCheck } from './structural-checks.js';

// ---- Types ----

export interface Fixture {
  id: string;
  description: string;
  category: string;
  passage: string;
}

export interface RunConfig {
  model: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
}

export interface ParsedPrompt {
  system: string;
  user: string;
  meta: Record<string, string>;
}

export interface FixtureResult {
  fixtureId: string;
  fixtureDescription: string;
  category: string;
  passage: string;
  items: ExtractedItem[];
  phraseCount: number;
  vocabCount: number;
  parseErrors: string[];
  structuralChecks: StructuralCheck[];
  rawResponse: string;
  tokenUsage: { inputTokens: number; outputTokens: number; cacheRead: number; cacheCreation: number };
  latencyMs: number;
  model: string;
  promptVersion: string;
  timestamp: string;
}

// ---- Default Config ----

export const DEFAULT_CONFIG: RunConfig = {
  model: 'claude-haiku-4-5-20251001',
  temperature: 0.0,
  maxTokens: 4096,
  timeoutMs: 60000,
};

// ---- Paths ----

const BASE_DIR = 'experiments/extraction-v2';
const FIXTURES_DIR = join(BASE_DIR, 'fixtures');
const PROMPTS_DIR = join(BASE_DIR, 'prompts');
const RESULTS_DIR = join(BASE_DIR, 'results');

// ---- Prompt Loading ----

export function loadPrompt(promptPath: string): ParsedPrompt {
  if (!existsSync(promptPath)) {
    throw new Error(`Prompt file does not exist: ${promptPath}`);
  }

  const content = readFileSync(promptPath, 'utf-8');
  const result: ParsedPrompt = { system: '', user: '', meta: {} };

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

// ---- Config Merging ----

export function mergeConfig(defaults: RunConfig, meta: Record<string, string>): RunConfig {
  const merged = { ...defaults };

  if (meta['temperature'] !== undefined) {
    const val = Number(meta['temperature']);
    if (Number.isFinite(val)) merged.temperature = val;
  }
  if (meta['maxTokens'] !== undefined) {
    const val = Number(meta['maxTokens']);
    if (Number.isFinite(val) && val > 0) merged.maxTokens = Math.floor(val);
  }
  if (meta['timeoutMs'] !== undefined) {
    const val = Number(meta['timeoutMs']);
    if (Number.isFinite(val) && val > 0) merged.timeoutMs = Math.floor(val);
  }
  if (meta['model'] !== undefined) {
    merged.model = meta['model'];
  }

  return merged;
}

// ---- Fixture Loading ----

export function loadFixtures(): Fixture[] {
  if (!existsSync(FIXTURES_DIR)) {
    throw new Error(`Fixtures directory does not exist: ${FIXTURES_DIR}`);
  }

  const files = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.json')).sort();
  const fixtures: Fixture[] = [];

  for (const file of files) {
    const filePath = join(FIXTURES_DIR, file);
    const content = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(content) as Fixture;

    if (!parsed.id || !parsed.category || typeof parsed.passage !== 'string') {
      throw new Error(`Invalid fixture format in ${file}: requires id, category, passage`);
    }

    fixtures.push(parsed);
  }

  return fixtures;
}

export function filterFixtures(fixtures: Fixture[], filters: RunFilters): Fixture[] {
  let filtered = fixtures;

  if (filters.fixtureIds && filters.fixtureIds.length > 0) {
    filtered = filtered.filter((f) => filters.fixtureIds!.includes(f.id));
  }

  if (filters.category) {
    filtered = filtered.filter((f) => f.category === filters.category);
  }

  return filtered;
}

// ---- Filter Parsing ----

export interface RunFilters {
  fixtureIds?: string[];
  category?: string;
  promptVersion: string;
}

export function parseFilters(): RunFilters {
  const filters: RunFilters = {
    promptVersion: process.env['PROMPT_VERSION'] ?? 'v13',
  };

  const fixture = process.env['FIXTURE'];
  if (fixture && fixture.trim().length > 0) {
    filters.fixtureIds = fixture.split(',').map((f) => f.trim()).filter((f) => f.length > 0);
  }

  const category = process.env['CATEGORY'];
  if (category && category.trim().length > 0) {
    filters.category = category.trim();
  }

  return filters;
}

// ---- Variable Substitution ----

function substituteVariables(template: string, variables: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    const placeholder = `{{${key}}}`;
    while (result.includes(placeholder)) {
      result = result.replace(placeholder, value);
    }
  }
  return result;
}

// ---- Tool Schema ----

// Compact schema: p = phrases, v = vocabulary
// Each entry is [term, definition, level, importance]
const EXTRACTION_TOOL: Anthropic.Tool = {
  name: 'extract_terms',
  description: 'Extract phrases and vocabulary from the input. Each entry is [term, definition, level, importance].',
  input_schema: {
    type: 'object' as const,
    properties: {
      p: {
        type: 'array',
        description: 'Phrases — multi-word combinations worth learning as units. Each entry: [term, definition, level, importance]',
        items: {
          type: 'array',
          prefixItems: [
            { type: 'string' },
            { type: 'string' },
            { type: 'string', enum: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] },
            { type: 'integer', enum: [0, 1, 2, 3, 4] },
          ],
          minItems: 4,
          maxItems: 4,
        },
      },
      v: {
        type: 'array',
        description: 'Vocabulary — single content words. Each entry: [term, definition, level, importance]',
        items: {
          type: 'array',
          prefixItems: [
            { type: 'string' },
            { type: 'string' },
            { type: 'string', enum: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] },
            { type: 'integer', enum: [0, 1, 2, 3, 4] },
          ],
          minItems: 4,
          maxItems: 4,
        },
      },
    },
    required: ['p', 'v'],
  },
};

// ---- Single API Call ----

async function callApi(
  client: Anthropic,
  systemPrompt: string,
  userMessage: string,
  config: RunConfig,
): Promise<{
  rawResponse: string;
  tokenUsage: { inputTokens: number; outputTokens: number; cacheRead: number; cacheCreation: number };
  latencyMs: number;
}> {
  const start = Date.now();

  // Cache the system prompt + tool schema across calls.
  // After the first call, these are served from cache at 90% discount.
  const response = await (client as Anthropic).beta.messages.create({
    model: config.model,
    max_tokens: config.maxTokens,
    temperature: config.temperature,
    betas: ['extended-cache-ttl-2025-04-11'],
    system: [
      {
        type: 'text' as const,
        text: systemPrompt,
        cache_control: { type: 'ephemeral' as const, ttl: '1h' } as Record<string, unknown>,
      },
    ],
    messages: [{ role: 'user', content: userMessage }],
    tools: [
      {
        ...EXTRACTION_TOOL,
        cache_control: { type: 'ephemeral' as const, ttl: '1h' } as Record<string, unknown>,
      } as Anthropic.Tool,
    ],
    tool_choice: { type: 'tool' as const, name: 'extract_terms' },
  });

  const latencyMs = Date.now() - start;

  const toolBlock = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
  );

  const rawResponse = toolBlock
    ? JSON.stringify(toolBlock.input)
    : '{"p":[],"v":[]}';

  const cacheRead = (response.usage as Record<string, number>)['cache_read_input_tokens'] ?? 0;
  const cacheCreation = (response.usage as Record<string, number>)['cache_creation_input_tokens'] ?? 0;

  return {
    rawResponse,
    tokenUsage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheRead,
      cacheCreation,
    },
    latencyMs,
  };
}

// ---- Cost Estimation ----

// Sonnet 4.6 pricing (1-hour cache tier)
const INPUT_COST_PER_M = 3.00;
const OUTPUT_COST_PER_M = 15.00;
const CACHE_READ_COST_PER_M = 0.30;
const CACHE_WRITE_COST_PER_M = 6.00;  // 1-hour cache write

export function estimateCost(
  inputTokens: number,
  outputTokens: number,
  cacheRead = 0,
  cacheCreation = 0,
): number {
  // Anthropic reports inputTokens as non-cached tokens only.
  // cacheRead and cacheCreation are reported separately.
  return (inputTokens / 1_000_000) * INPUT_COST_PER_M
    + (cacheRead / 1_000_000) * CACHE_READ_COST_PER_M
    + (cacheCreation / 1_000_000) * CACHE_WRITE_COST_PER_M
    + (outputTokens / 1_000_000) * OUTPUT_COST_PER_M;
}

// ---- Run All ----

export async function runAll(
  client: Anthropic,
  fixtures: Fixture[],
  filters: RunFilters,
): Promise<FixtureResult[]> {
  const promptPath = join(PROMPTS_DIR, `${filters.promptVersion}.txt`);
  const prompt = loadPrompt(promptPath);
  const config = mergeConfig(DEFAULT_CONFIG, prompt.meta);

  if (!existsSync(RESULTS_DIR)) {
    mkdirSync(RESULTS_DIR, { recursive: true });
  }

  const results: FixtureResult[] = [];

  for (const fixture of fixtures) {
    const variables: Record<string, string> = { TEXT: fixture.passage };
    const systemPrompt = substituteVariables(prompt.system, variables);
    const userMessage = prompt.user
      ? substituteVariables(prompt.user, variables)
      : fixture.passage;

    const timestamp = new Date().toISOString();

    console.log(`  → ${fixture.id} (${fixture.category})...`);

    try {
      const response = await callApi(client, systemPrompt, userMessage, config);
      const { items, phraseCount, vocabCount, parseErrors } = parseResponse(response.rawResponse);
      const structuralChecks = runStructuralChecks(items, parseErrors, fixture.category);

      const result: FixtureResult = {
        fixtureId: fixture.id,
        fixtureDescription: fixture.description,
        category: fixture.category,
        passage: fixture.passage,
        items,
        phraseCount,
        vocabCount,
        parseErrors,
        structuralChecks,
        rawResponse: response.rawResponse,
        tokenUsage: response.tokenUsage,
        latencyMs: response.latencyMs,
        model: config.model,
        promptVersion: filters.promptVersion,
        timestamp,
      };

      results.push(result);

      // Save raw result
      const resultFile = join(RESULTS_DIR, `${fixture.id}_${filters.promptVersion}_${Date.now()}.json`);
      writeFileSync(resultFile, JSON.stringify(result, null, 2), 'utf-8');

      const passedChecks = structuralChecks.filter((c) => c.passed).length;
      const totalChecks = structuralChecks.length;
      const cost = estimateCost(response.tokenUsage.inputTokens, response.tokenUsage.outputTokens, response.tokenUsage.cacheRead, response.tokenUsage.cacheCreation);
      const cacheInfo = response.tokenUsage.cacheRead > 0 ? ` | cache:${response.tokenUsage.cacheRead}` : response.tokenUsage.cacheCreation > 0 ? ' | cache:created' : '';
      console.log(`    ✓ ${phraseCount}p + ${vocabCount}v = ${items.length} items | ${passedChecks}/${totalChecks} checks | ${response.latencyMs}ms | $${cost.toFixed(4)}${cacheInfo}`);

    } catch (err) {
      console.log(`    ✗ ERROR: ${err instanceof Error ? err.message : String(err)}`);

      results.push({
        fixtureId: fixture.id,
        fixtureDescription: fixture.description,
        category: fixture.category,
        passage: fixture.passage,
        items: [],
        phraseCount: 0,
        vocabCount: 0,
        parseErrors: [],
        structuralChecks: [{ name: 'api_call', passed: false, message: String(err) }],
        rawResponse: `ERROR: ${err instanceof Error ? err.message : String(err)}`,
        tokenUsage: { inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheCreation: 0 },
        latencyMs: 0,
        model: config.model,
        promptVersion: filters.promptVersion,
        timestamp,
      });
    }
  }

  return results;
}
