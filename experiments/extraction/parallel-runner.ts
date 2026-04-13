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

// ---- Phrase Level Bump (server-side, +1 for non-literal) ----

function bumpLevel(level: CefrLevel): CefrLevel {
  const idx = cefrIndex(level);
  if (idx >= 5) return 'C2';
  return CEFR_ORDER[idx + 1]!;
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

// Producer: just finds candidates, no level assignment needed
const PHRASES_PRODUCE_TOOL: Anthropic.Tool = {
  name: 'list_phrases',
  description: 'List all multi-word pattern candidates from the text',
  input_schema: {
    type: 'object' as const,
    properties: {
      phrases: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of phrase candidates in base/dictionary form',
      },
    },
    required: ['phrases'],
  },
};

// Reviewer: filters and rates the candidates
const PHRASES_REVIEW_TOOL: Anthropic.Tool = {
  name: 'review_phrases',
  description: 'Review phrase candidates and return only the ones worth keeping with levels',
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
            context: { type: 'string', description: 'The most relevant occurrence in the text' },
          },
          required: ['term', 'level'],
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
            context: { type: 'string', description: 'The most relevant occurrence in the text' },
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
            context: { type: 'string', description: 'The most relevant occurrence in the text' },
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

export function getPromptPaths(version?: string): {
  phrasesProduce: string;
  phrasesReview: string;
  polysemous: string;
  vocabulary: string;
} {
  const v = version ?? 'v7';
  return {
    phrasesProduce: `${PROMPTS_DIR}/${v}-phrases-produce.txt`,
    phrasesReview: `${PROMPTS_DIR}/${v}-phrases-review.txt`,
    polysemous: `${PROMPTS_DIR}/${v}-polysemous.txt`,
    vocabulary: `${PROMPTS_DIR}/${v}-vocabulary.txt`,
  };
}

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
  promptVersion?: string,
): Promise<ParallelRunResult> {
  // Compute level ranges server-side
  const studentIdx = cefrIndex(studentLevel);
  const nonLiteralLow = CEFR_ORDER[Math.max(studentIdx - 1, 1)]!;  // one below, floor A2
  const nonLiteralHigh = CEFR_ORDER[Math.min(studentIdx + 1, 5)]!;  // one above (server bumps +1 → becomes +2)

  // Polysemous and vocabulary range: student level to +2
  const polyVocabLow = CEFR_ORDER[studentIdx]!;
  const polyVocabHigh = CEFR_ORDER[Math.min(studentIdx + 2, 5)]!;

  const variables: Record<string, string> = {
    LEVEL: studentLevel,
    TEXT: passage,
    NONLITERAL_LOW: nonLiteralLow,
    NONLITERAL_HIGH: nonLiteralHigh,
    POLY_LOW: polyVocabLow,
    POLY_HIGH: polyVocabHigh,
    VOCAB_LOW: polyVocabLow,
    VOCAB_HIGH: polyVocabHigh,
  };

  // Load and prepare prompts from files
  const paths = getPromptPaths(promptVersion);
  const producePrompt = loadPrompt(paths.phrasesProduce);
  const reviewPrompt = loadPrompt(paths.phrasesReview);
  const polysemousPrompt = loadPrompt(paths.polysemous);
  const vocabularyPrompt = loadPrompt(paths.vocabulary);

  const produceSystem = substituteVariables(producePrompt.system, variables);
  const produceUser = producePrompt.user ? substituteVariables(producePrompt.user, variables) : passage;
  const polysemousSystem = substituteVariables(polysemousPrompt.system, variables);
  const polysemousUser = polysemousPrompt.user ? substituteVariables(polysemousPrompt.user, variables) : passage;
  const vocabularySystem = substituteVariables(vocabularyPrompt.system, variables);
  const vocabularyUser = vocabularyPrompt.user ? substituteVariables(vocabularyPrompt.user, variables) : passage;

  // Step 1: Launch producer + polysemous + vocabulary in parallel
  const [produceResult, polysemousResult, vocabResult] = await Promise.all([
    callWithTool(client, produceSystem, produceUser, PHRASES_PRODUCE_TOOL, config),
    callWithTool(client, polysemousSystem, polysemousUser, POLYSEMOUS_TOOL, config),
    callWithTool(client, vocabularySystem, vocabularyUser, VOCABULARY_TOOL, config),
  ]);

  // Step 2: Get candidates from producer, send to reviewer
  const candidates = ((produceResult.result as Record<string, unknown>)['phrases'] ?? []) as string[];
  const candidatesList = candidates.join('\n');

  const reviewVariables = { ...variables, CANDIDATES: candidatesList };
  const reviewSystem = substituteVariables(reviewPrompt.system, reviewVariables);
  const reviewUser = reviewPrompt.user ? substituteVariables(reviewPrompt.user, reviewVariables) : candidatesList;

  const reviewResult = await callWithTool(client, reviewSystem, reviewUser, PHRASES_REVIEW_TOOL, config);

  // Extract raw lists
  const rawPhrases = ((reviewResult.result as Record<string, unknown>)['phrases'] ?? []) as Array<{ term: string; level: string; context?: string }>;
  const rawPolysemous = ((polysemousResult.result as Record<string, unknown>)['polysemous'] ?? []) as Array<{ term: string; level: string; context?: string }>;
  const rawVocab = ((vocabResult.result as Record<string, unknown>)['vocabulary'] ?? []) as Array<{ term: string; level: string; context?: string }>;

  // Helper: convert single context string to array for compatibility with ExtractionOutput
  const toContextArray = (ctx?: string): string[] | undefined =>
    ctx ? [ctx] : undefined;

  // ---- SERVER-SIDE POST-PROCESSING ----

  // 1. Process phrases: all phrases get +1 bump
  const phrases: ExtractedTerm[] = rawPhrases.map((p) => ({
    term: p.term,
    level: bumpLevel(p.level as CefrLevel),
    ...(p.context ? { context: toContextArray(p.context) } : {}),
  }));

  const polysemous: ExtractedTerm[] = rawPolysemous.map((p) => ({
    term: p.term,
    level: p.level as CefrLevel,
    ...(p.context ? { context: toContextArray(p.context) } : {}),
  }));

  const vocab: ExtractedTerm[] = rawVocab.map((v) => ({
    term: v.term,
    level: v.level as CefrLevel,
    ...(v.context ? { context: toContextArray(v.context) } : {}),
  }));

  // 1. Range filter (deterministic)
  const filteredPhrases = phrases.filter((t) => isInRange(t.level, studentLevel));
  const filteredPolysemous = polysemous.filter((t) => isInRange(t.level, studentLevel));
  const filteredVocab = vocab.filter((t) => isInRange(t.level, studentLevel));

  // 3. Cross-list dedup:
  //    - All phrases are non-literal → phrases beat polysemy when a polysemous word
  //      appears inside a phrase (the phrase as a whole is the lesson)
  //    - Polysemy beats vocabulary (same word → polysemy wins)
  //    - Phrases + vocabulary can coexist if they teach different lessons

  const polysemousTerms = new Set(filteredPolysemous.map((t) => t.term.trim().toLowerCase()));

  // All phrases stay — they are the lesson
  const dedupedPhrases = filteredPhrases;

  // Remove polysemous entries whose word appears inside a phrase
  const dedupedPolysemous = filteredPolysemous.filter((p) => {
    const polyNorm = p.term.trim().toLowerCase();
    for (const phrase of dedupedPhrases) {
      const words = phrase.term.trim().toLowerCase().split(/\s+/);
      if (words.includes(polyNorm)) {
        return false; // This polysemous word is inside a phrase → drop polysemy
      }
    }
    return true;
  });

  // Remove vocabulary that duplicates polysemous entries or exactly matches a phrase
  const finalPolysemousTerms = new Set(dedupedPolysemous.map((t) => t.term.trim().toLowerCase()));
  const phraseTerms = new Set(dedupedPhrases.map((t) => t.term.trim().toLowerCase()));

  const dedupedVocab = filteredVocab.filter((v) => {
    const normalized = v.term.trim().toLowerCase();
    if (finalPolysemousTerms.has(normalized)) return false;
    if (phraseTerms.has(normalized)) return false;
    return true;
  });

  // 4. Deduplicate within each list
  const uniquePhrases = dedup(dedupedPhrases);
  const uniquePolysemous = dedup(dedupedPolysemous);
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

  // Token/latency aggregation (4 calls: produce + review + polysemous + vocabulary)
  const totalInput = produceResult.inputTokens + reviewResult.inputTokens + polysemousResult.inputTokens + vocabResult.inputTokens;
  const totalOutput = produceResult.outputTokens + reviewResult.outputTokens + polysemousResult.outputTokens + vocabResult.outputTokens;
  // Parallel phase: max of produce/polysemous/vocabulary. Then sequential: + review latency.
  const parallelLatency = Math.max(produceResult.latencyMs, polysemousResult.latencyMs, vocabResult.latencyMs);
  const wallClockLatency = parallelLatency + reviewResult.latencyMs;

  return {
    rawResponse,
    tokenUsage: { inputTokens: totalInput, outputTokens: totalOutput },
    latencyMs: wallClockLatency,
    perCallStats: {
      phrases: {
        inputTokens: produceResult.inputTokens + reviewResult.inputTokens,
        outputTokens: produceResult.outputTokens + reviewResult.outputTokens,
        latencyMs: produceResult.latencyMs + reviewResult.latencyMs,
      },
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
