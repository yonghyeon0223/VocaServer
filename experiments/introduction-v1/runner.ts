import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { parseResponse, runStructuralChecks } from './structural-checks.js';
import type { ParsedIntroduction, StructuralCheck } from './structural-checks.js';

// ---- Types ----

export interface TermFixture {
  id: string;
  word: string;
  definition: string;
  level: string;
  importance: number;
  type: 'phrase' | 'vocabulary';
  source: string;
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

export interface TermResult {
  termId: string;
  word: string;
  definition: string;
  level: string;
  importance: number;
  termType: 'phrase' | 'vocabulary';
  source: string;
  parsed: ParsedIntroduction | null;
  parseErrors: string[];
  structuralChecks: StructuralCheck[];
  rawResponse: string;

  tokenUsage: { inputTokens: number; outputTokens: number; cacheRead: number; cacheCreation: number };
  latencyMs: number;
  model: string;
  promptVersion: string;
  timestamp: string;
  feedback: string;
}

// ---- Default Config ----

export const DEFAULT_CONFIG: RunConfig = {
  model: 'claude-sonnet-4-6',
  temperature: 0.3,
  maxTokens: 4096,
  timeoutMs: 90000,
};

// ---- Paths ----

const BASE_DIR = 'experiments/introduction-v1';
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

export function loadFixtures(): TermFixture[] {
  const filePath = join(FIXTURES_DIR, 'terms.json');
  if (!existsSync(filePath)) {
    throw new Error(`Fixtures file does not exist: ${filePath}`);
  }

  const content = readFileSync(filePath, 'utf-8');
  const fixtures = JSON.parse(content) as TermFixture[];

  for (const f of fixtures) {
    if (!f.id || !f.word || !f.definition || !f.level) {
      throw new Error(`Invalid fixture: ${JSON.stringify(f).slice(0, 100)}`);
    }
  }

  return fixtures;
}

export interface RunFilters {
  termIds?: string[];
  level?: string;
  importance?: number;
  words?: string[];
  promptVersion: string;
}

export function filterFixtures(fixtures: TermFixture[], filters: RunFilters): TermFixture[] {
  let filtered = fixtures;

  if (filters.termIds && filters.termIds.length > 0) {
    filtered = filtered.filter((f) => filters.termIds!.includes(f.id));
  }

  if (filters.level) {
    filtered = filtered.filter((f) => f.level === filters.level);
  }

  if (filters.importance !== undefined) {
    filtered = filtered.filter((f) => f.importance === filters.importance);
  }

  if (filters.words && filters.words.length > 0) {
    const wordsLower = filters.words.map((w) => w.toLowerCase());
    filtered = filtered.filter((f) => wordsLower.includes(f.word.toLowerCase()));
  }

  return filtered;
}

// ---- Filter Parsing ----

export function parseFilters(): RunFilters {
  const filters: RunFilters = {
    promptVersion: process.env['PROMPT_VERSION'] ?? 'v1',
  };

  const terms = process.env['TERMS'];
  if (terms && terms.trim().length > 0) {
    filters.termIds = terms.split(',').map((t) => t.trim()).filter((t) => t.length > 0);
  }

  const words = process.env['WORDS'];
  if (words && words.trim().length > 0) {
    filters.words = words.split(',').map((w) => w.trim()).filter((w) => w.length > 0);
  }

  const level = process.env['LEVEL'];
  if (level && level.trim().length > 0) {
    filters.level = level.trim();
  }

  const importance = process.env['IMPORTANCE'];
  if (importance !== undefined && importance.trim().length > 0) {
    const val = Number(importance);
    if (Number.isFinite(val)) filters.importance = val;
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

const INTRODUCTION_TOOL: Anthropic.Tool = {
  name: 'generate_introduction',
  description: 'Generate an interactive word introduction lesson for a Korean English learner.',
  input_schema: {
    type: 'object' as const,
    properties: {
      i: {
        type: 'object',
        description: 'Intro turn',
        properties: {
          s: { type: 'string', description: 'Scene text' },
          q: { type: 'string', description: 'Single question' },
          o: {
            type: 'array',
            description: 'Options as [text, response] tuples',
            items: {
              type: 'array',
              prefixItems: [
                { type: 'string', description: 'Choice text' },
                { type: 'string', description: 'Convergence response' },
              ],
              minItems: 2,
              maxItems: 2,
            },
            minItems: 2,
            maxItems: 3,
          },
        },
        required: ['s', 'q', 'o'],
      },
      e: {
        type: 'array',
        description: 'Explore turns',
        items: {
          type: 'object',
          properties: {
            t: { type: 'string', description: '2-letter type symbol (AR,CP,CR,SC,OP,CX,PD,CL,IN,MU,MF,WD)' },
            q: { type: 'string', description: 'Question text' },
            a: { type: 'integer', description: '0-based index of correct option' },
            o: {
              type: 'array',
              description: 'Options as [text, response] tuples',
              items: {
                type: 'array',
                prefixItems: [
                  { type: 'string', description: 'Choice text' },
                  { type: 'string', description: 'Feedback response' },
                ],
                minItems: 2,
                maxItems: 2,
              },
              minItems: 2,
              maxItems: 3,
            },
          },
          required: ['t', 'q', 'a', 'o'],
        },
        minItems: 1,
        maxItems: 4,
      },
      l: {
        type: 'array',
        description: 'Learning objectives — 1-5 formal objectives for future quizzes/exercises',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 5,
      },
      s: {
        type: 'string',
        description: 'Summary — 1-3 sentence wrap-up of the key sense learned',
      },
    },
    required: ['i', 'e', 'l', 's'],
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
        ...INTRODUCTION_TOOL,
        cache_control: { type: 'ephemeral' as const, ttl: '1h' } as Record<string, unknown>,
      } as Anthropic.Tool,
    ],
    tool_choice: { type: 'tool' as const, name: 'generate_introduction' },
  });

  const latencyMs = Date.now() - start;

  const toolBlock = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
  );

  const rawResponse = toolBlock
    ? JSON.stringify(toolBlock.input)
    : '{}';

  const usage = response.usage as Record<string, number>;
  const cacheRead = usage['cache_read_input_tokens'] ?? 0;
  const cacheCreation = usage['cache_creation_input_tokens'] ?? 0;
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

const INPUT_COST_PER_M = 3.00;
const OUTPUT_COST_PER_M = 15.00;
const CACHE_READ_COST_PER_M = 0.30;
const CACHE_WRITE_COST_PER_M = 6.00;

export function estimateCost(
  inputTokens: number,
  outputTokens: number,
  cacheRead = 0,
  cacheCreation = 0,
): number {
  return (inputTokens / 1_000_000) * INPUT_COST_PER_M
    + (cacheRead / 1_000_000) * CACHE_READ_COST_PER_M
    + (cacheCreation / 1_000_000) * CACHE_WRITE_COST_PER_M
    + (outputTokens / 1_000_000) * OUTPUT_COST_PER_M;
}

// ---- Run All ----

export async function runAll(
  client: Anthropic,
  fixtures: TermFixture[],
  filters: RunFilters,
): Promise<TermResult[]> {
  const promptPath = join(PROMPTS_DIR, `${filters.promptVersion}.txt`);
  const prompt = loadPrompt(promptPath);
  const config = mergeConfig(DEFAULT_CONFIG, prompt.meta);

  if (!existsSync(RESULTS_DIR)) {
    mkdirSync(RESULTS_DIR, { recursive: true });
  }

  const results: TermResult[] = [];

  for (const fixture of fixtures) {
    // Pick a name deterministically from word hash to avoid repetition across sessions
    const NAMES = [
      '태윤', '소이', '건호', '예나', '승민', '하율', '도현', '채린',
      '지환', '유나', '시온', '다윤', '준혁', '서아', '은호', '나연',
      '정우', '보라', '한결', '수아', '윤서', '시현', '재민', '하영',
      '동혁', '소연', '민혁', '유리', '성진', '은지', '현서', '가은',
      '우진', '지민', '상훈', '미소', '영준', '세은', '태호', '주하',
    ];
    let hash = 0;
    for (let ci = 0; ci < fixture.word.length; ci++) {
      hash = ((hash << 5) - hash + fixture.word.charCodeAt(ci)) | 0;
    }
    const suggestedName = NAMES[Math.abs(hash) % NAMES.length];

    const variables: Record<string, string> = {
      WORD: fixture.word,
      DEFINITION: fixture.definition,
      LEVEL: fixture.level,
      NAME: suggestedName,
    };
    const systemPrompt = substituteVariables(prompt.system, variables);
    const userMessage = substituteVariables(prompt.user, variables);

    const timestamp = new Date().toISOString();

    console.log(`  → ${fixture.id}: "${fixture.word}" (${fixture.level}, imp ${fixture.importance})...`);

    try {
      let response = await callApi(client, systemPrompt, userMessage, config);
      let { parsed, parseErrors } = parseResponse(response.rawResponse);

      // Retry up to 2 times if parse failed (Sonnet occasionally stringifies fields)
      for (let retry = 0; retry < 2 && !parsed && parseErrors.length > 0; retry++) {
        console.log(`    ⟳ Parse failed, retry ${retry + 1}/2...`);
        response = await callApi(client, systemPrompt, userMessage, config);
        ({ parsed, parseErrors } = parseResponse(response.rawResponse));
      }

      const structuralChecks = runStructuralChecks(parsed, parseErrors, fixture.word);

      const result: TermResult = {
        termId: fixture.id,
        word: fixture.word,
        definition: fixture.definition,
        level: fixture.level,
        importance: fixture.importance,
        termType: fixture.type,
        source: fixture.source,
        parsed,
        parseErrors,
        structuralChecks,
        rawResponse: response.rawResponse,
        tokenUsage: response.tokenUsage,
        latencyMs: response.latencyMs,
        model: config.model,
        promptVersion: filters.promptVersion,
        timestamp,
        feedback: '',
      };

      results.push(result);

      // Save individual result
      const safeWord = fixture.word.replace(/[^a-zA-Z0-9-]/g, '_').slice(0, 30);
      const resultFile = join(RESULTS_DIR, `${fixture.id}_${safeWord}_${filters.promptVersion}_${Date.now()}.json`);
      writeFileSync(resultFile, JSON.stringify(result, null, 2), 'utf-8');

      const passedChecks = structuralChecks.filter((c) => c.passed).length;
      const totalChecks = structuralChecks.length;
      const exploreTurns = parsed ? parsed.explore.length : 0;
      const cost = estimateCost(response.tokenUsage.inputTokens, response.tokenUsage.outputTokens, response.tokenUsage.cacheRead, response.tokenUsage.cacheCreation);
      const cacheInfo = response.tokenUsage.cacheRead > 0 ? ` | cache:${response.tokenUsage.cacheRead}` : response.tokenUsage.cacheCreation > 0 ? ' | cache:created' : '';
      console.log(`    ✓ ${exploreTurns} explore | ${response.tokenUsage.outputTokens} out | ${passedChecks}/${totalChecks} checks | ${response.latencyMs}ms | $${cost.toFixed(4)}${cacheInfo}`);

    } catch (err) {
      console.log(`    ✗ ERROR: ${err instanceof Error ? err.message : String(err)}`);

      results.push({
        termId: fixture.id,
        word: fixture.word,
        definition: fixture.definition,
        level: fixture.level,
        importance: fixture.importance,
        termType: fixture.type,
        source: fixture.source,
        parsed: null,
        parseErrors: [],
        structuralChecks: [{ name: 'api_call', passed: false, message: String(err) }],
        rawResponse: `ERROR: ${err instanceof Error ? err.message : String(err)}`,
        tokenUsage: { inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheCreation: 0 },
        latencyMs: 0,
        model: config.model,
        promptVersion: filters.promptVersion,
        timestamp,
        feedback: '',
      });
    }
  }

  return results;
}
