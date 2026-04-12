import Anthropic from '@anthropic-ai/sdk';
import type { CefrLevel, TextFit, Fixture, RunConfig } from './runner.js';
import { loadPrompt, substituteVariables } from './runner.js';
import type { ExtractionOutput, ExtractedTerm } from './checker.js';

// ---- CEFR Utilities ----

const CEFR_ORDER: CefrLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

function cefrIndex(level: CefrLevel): number {
  const idx = CEFR_ORDER.indexOf(level);
  if (idx === -1) throw new Error(`Invalid CEFR level: ${level}`);
  return idx;
}

function isInRange(termLevel: CefrLevel, studentLevel: CefrLevel): boolean {
  const termIdx = cefrIndex(termLevel);
  const studentIdx = cefrIndex(studentLevel);
  return termIdx >= studentIdx && termIdx <= studentIdx + 2;
}

// ---- Phrase Level Bump (server-side) ----

function bumpPhraseLevel(baseLevel: CefrLevel, isLiteral: boolean): CefrLevel {
  if (isLiteral) {
    // Literal: use base level, minimum A2
    const idx = cefrIndex(baseLevel);
    return idx < 1 ? 'A2' : baseLevel;
  }
  // Non-literal: +1, max C2
  const idx = cefrIndex(baseLevel);
  if (idx >= 5) return 'C2'; // Already C2
  return CEFR_ORDER[Math.min(idx + 1, 5)]!;
}

// ---- textFit (server-side computation) ----

function computeTextFit(allLevels: CefrLevel[], studentLevel: CefrLevel): TextFit {
  if (allLevels.length === 0) return 'not_applicable';

  // Sort levels and find 90th percentile
  const sorted = [...allLevels].sort((a, b) => cefrIndex(a) - cefrIndex(b));
  const p90Index = Math.min(Math.floor(sorted.length * 0.9), sorted.length - 1);
  const p90Level = sorted[p90Index]!;

  const diff = cefrIndex(p90Level) - cefrIndex(studentLevel);
  if (diff <= -2) return 'too_easy';
  if (diff === -1) return 'easy';
  if (diff === 0) return 'appropriate';
  if (diff === 1) return 'stretch';
  return 'too_hard';
}

// ---- Tool Schemas (one per call, much simpler) ----

const PHRASES_TOOL: Anthropic.Tool = {
  name: 'extract_phrases',
  description: 'Extract multi-word patterns from the text',
  input_schema: {
    type: 'object' as const,
    properties: {
      phrases: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            term: { type: 'string' },
            level: { type: 'string', enum: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] },
            is_literal: { type: 'boolean', description: 'true if the phrase meaning is transparent from its components, false if idiomatic/non-obvious' },
            context: { type: 'array', items: { type: 'string' } },
          },
          required: ['term', 'level', 'is_literal'],
        },
      },
    },
    required: ['phrases'],
  },
};

const POLYSEMOUS_TOOL: Anthropic.Tool = {
  name: 'extract_polysemous',
  description: 'Find single words used in non-default senses',
  input_schema: {
    type: 'object' as const,
    properties: {
      polysemous: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            term: { type: 'string' },
            level: { type: 'string', enum: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'], description: 'Level of the SENSE being used, not the word\'s basic level' },
            context: { type: 'array', items: { type: 'string' } },
          },
          required: ['term', 'level'],
        },
      },
    },
    required: ['polysemous'],
  },
};

const VOCABULARY_TOOL: Anthropic.Tool = {
  name: 'extract_vocabulary',
  description: 'List single content words from the text',
  input_schema: {
    type: 'object' as const,
    properties: {
      vocabulary: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            term: { type: 'string' },
            level: { type: 'string', enum: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] },
            context: { type: 'array', items: { type: 'string' } },
          },
          required: ['term', 'level'],
        },
      },
    },
    required: ['vocabulary'],
  },
};

// ---- Prompt File Paths ----

const PROMPTS_DIR = 'experiments/extraction/prompts';
const PHRASES_PROMPT_PATH = `${PROMPTS_DIR}/v5-phrases.txt`;
const POLYSEMOUS_PROMPT_PATH = `${PROMPTS_DIR}/v5-polysemous.txt`;
const VOCABULARY_PROMPT_PATH = `${PROMPTS_DIR}/v5-vocabulary.txt`;

// ---- Single Focused Call ----

async function callWithTool(
  client: Anthropic,
  systemPrompt: string,
  userMessage: string,
  tool: Anthropic.Tool,
  config: RunConfig,
): Promise<{ result: unknown; inputTokens: number; outputTokens: number; latencyMs: number }> {
  const start = Date.now();

  const response = await client.messages.create({
    model: config.model,
    max_tokens: config.maxTokens,
    temperature: config.temperature,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
    tools: [tool],
    tool_choice: { type: 'tool' as const, name: tool.name },
  });

  const latencyMs = Date.now() - start;

  const toolBlock = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
  );

  return {
    result: toolBlock?.input ?? {},
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    latencyMs,
  };
}

// ---- Parallel Extraction ----

export interface ParallelRunResult {
  rawResponse: string;  // The merged JSON as string (for compatibility with checker)
  tokenUsage: { inputTokens: number; outputTokens: number };
  latencyMs: number;    // Wall-clock time (parallel, so max of the three)
  perCallStats: {
    phrases: { inputTokens: number; outputTokens: number; latencyMs: number };
    polysemous: { inputTokens: number; outputTokens: number; latencyMs: number };
    vocabulary: { inputTokens: number; outputTokens: number; latencyMs: number };
  };
}

export async function runParallel(
  client: Anthropic,
  passage: string,
  studentLevel: CefrLevel,
  config: RunConfig,
): Promise<ParallelRunResult> {
  const variables = { LEVEL: studentLevel, TEXT: passage };

  // Load and prepare prompts from files
  const phrasesPrompt = loadPrompt(PHRASES_PROMPT_PATH);
  const polysemousPrompt = loadPrompt(POLYSEMOUS_PROMPT_PATH);
  const vocabularyPrompt = loadPrompt(VOCABULARY_PROMPT_PATH);

  const phrasesSystem = substituteVariables(phrasesPrompt.system, variables);
  const phrasesUser = substituteVariables(phrasesPrompt.user, variables);
  const polysemousSystem = substituteVariables(polysemousPrompt.system, variables);
  const polysemousUser = substituteVariables(polysemousPrompt.user, variables);
  const vocabularySystem = substituteVariables(vocabularyPrompt.system, variables);
  const vocabularyUser = substituteVariables(vocabularyPrompt.user, variables);

  // Launch all three calls in parallel
  const [phrasesResult, polysemousResult, vocabResult] = await Promise.all([
    callWithTool(client, phrasesSystem, phrasesUser, PHRASES_TOOL, config),
    callWithTool(client, polysemousSystem, polysemousUser, POLYSEMOUS_TOOL, config),
    callWithTool(client, vocabularySystem, vocabularyUser, VOCABULARY_TOOL, config),
  ]);

  // Extract raw lists from each call
  const rawPhrases = ((phrasesResult.result as Record<string, unknown>)['phrases'] ?? []) as Array<{ term: string; level: string; is_literal?: boolean; context?: string[] }>;
  const rawPolysemous = ((polysemousResult.result as Record<string, unknown>)['polysemous'] ?? []) as Array<{ term: string; level: string; context?: string[] }>;
  const rawVocab = ((vocabResult.result as Record<string, unknown>)['vocabulary'] ?? []) as Array<{ term: string; level: string; context?: string[] }>;

  // ---- SERVER-SIDE POST-PROCESSING ----

  // 1. Apply phrase level bump
  const bumpedPhrases: ExtractedTerm[] = rawPhrases.map((p) => ({
    term: p.term,
    level: bumpPhraseLevel(p.level as CefrLevel, p.is_literal ?? false),
    ...(p.context ? { context: p.context } : {}),
  }));

  const polysemous: ExtractedTerm[] = rawPolysemous.map((p) => ({
    term: p.term,
    level: p.level as CefrLevel,
    ...(p.context ? { context: p.context } : {}),
  }));

  const vocab: ExtractedTerm[] = rawVocab.map((v) => ({
    term: v.term,
    level: v.level as CefrLevel,
    ...(v.context ? { context: v.context } : {}),
  }));

  // 2. Range filter (deterministic)
  const filteredPhrases = bumpedPhrases.filter((t) => isInRange(t.level, studentLevel));
  const filteredPolysemous = polysemous.filter((t) => isInRange(t.level, studentLevel));
  const filteredVocab = vocab.filter((t) => isInRange(t.level, studentLevel));

  // 3. Cross-list dedup: polysemy > phrases > vocabulary
  const polysemousTerms = new Set(filteredPolysemous.map((t) => t.term.trim().toLowerCase()));

  // Remove phrases that contain a polysemous word (unless the phrase is a distinct idiom)
  const dedupedPhrases = filteredPhrases.filter((p) => {
    const words = p.term.trim().toLowerCase().split(/\s+/);
    // If any word in the phrase is a polysemous entry, drop the phrase
    return !words.some((w) => polysemousTerms.has(w));
  });

  // Remove vocabulary that appears in phrases or polysemous
  const phraseTerms = new Set(dedupedPhrases.map((t) => t.term.trim().toLowerCase()));
  const dedupedVocab = filteredVocab.filter((v) => {
    const normalized = v.term.trim().toLowerCase();
    // Remove if it's a polysemous term
    if (polysemousTerms.has(normalized)) return false;
    // Remove if it's captured inside a phrase (check if any phrase contains this word)
    // But allow coexistence if they teach different lessons — keep vocab that exists as a standalone word
    // For simplicity: remove only exact matches with phrase terms, not substring
    if (phraseTerms.has(normalized)) return false;
    return true;
  });

  // 4. Deduplicate within each list
  const uniquePhrases = dedup(dedupedPhrases);
  const uniquePolysemous = dedup(filteredPolysemous);
  const uniqueVocab = dedup(dedupedVocab);

  // 5. Compute textFit server-side
  const allLevels = rawVocab.map((v) => v.level as CefrLevel);
  const textFit = computeTextFit(allLevels, studentLevel);

  // Build merged output
  const output: ExtractionOutput = {
    textFit,
    phrases: uniquePhrases,
    polysemous: uniquePolysemous,
    vocabulary: uniqueVocab,
  };

  const rawResponse = JSON.stringify(output);

  // Token/latency aggregation
  const totalInput = phrasesResult.inputTokens + polysemousResult.inputTokens + vocabResult.inputTokens;
  const totalOutput = phrasesResult.outputTokens + polysemousResult.outputTokens + vocabResult.outputTokens;
  const wallClockLatency = Math.max(phrasesResult.latencyMs, polysemousResult.latencyMs, vocabResult.latencyMs);

  return {
    rawResponse,
    tokenUsage: { inputTokens: totalInput, outputTokens: totalOutput },
    latencyMs: wallClockLatency,
    perCallStats: {
      phrases: { inputTokens: phrasesResult.inputTokens, outputTokens: phrasesResult.outputTokens, latencyMs: phrasesResult.latencyMs },
      polysemous: { inputTokens: polysemousResult.inputTokens, outputTokens: polysemousResult.outputTokens, latencyMs: polysemousResult.latencyMs },
      vocabulary: { inputTokens: vocabResult.inputTokens, outputTokens: vocabResult.outputTokens, latencyMs: vocabResult.latencyMs },
    },
  };
}

// ---- Helpers ----

function dedup(terms: ExtractedTerm[]): ExtractedTerm[] {
  const seen = new Set<string>();
  return terms.filter((t) => {
    const key = t.term.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
