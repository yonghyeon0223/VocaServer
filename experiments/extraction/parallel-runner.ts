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

function applyLiteralFloor(level: CefrLevel): CefrLevel {
  const idx = cefrIndex(level);
  return idx < 1 ? 'A2' : level;
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
  description: 'Extract multi-word patterns from the text in two separate lists',
  input_schema: {
    type: 'object' as const,
    properties: {
      literal: {
        type: 'array',
        description: 'Phrases with transparent meaning from components',
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
      non_literal: {
        type: 'array',
        description: 'Phrases with non-transparent meaning (collocations, phrasal verbs, idioms, fixed expressions, grammar patterns)',
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
    required: ['literal', 'non_literal'],
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
  // Compute level ranges server-side
  const studentIdx = cefrIndex(studentLevel);
  const literalLow = CEFR_ORDER[Math.max(studentIdx, 1)]!;  // floor A2 (index 1)
  const literalHigh = CEFR_ORDER[Math.min(studentIdx + 2, 5)]!;  // max C2
  const nonLiteralLow = CEFR_ORDER[Math.max(studentIdx - 1, 1)]!;  // one below, floor A2
  const nonLiteralHigh = CEFR_ORDER[Math.min(studentIdx + 1, 5)]!;  // one above (server bumps +1 → becomes +2)

  // Polysemous and vocabulary range: student level to +2
  const polyVocabLow = CEFR_ORDER[studentIdx]!;
  const polyVocabHigh = CEFR_ORDER[Math.min(studentIdx + 2, 5)]!;

  const variables: Record<string, string> = {
    LEVEL: studentLevel,
    TEXT: passage,
    LITERAL_LOW: literalLow,
    LITERAL_HIGH: literalHigh,
    NONLITERAL_LOW: nonLiteralLow,
    NONLITERAL_HIGH: nonLiteralHigh,
    POLY_LOW: polyVocabLow,
    POLY_HIGH: polyVocabHigh,
    VOCAB_LOW: polyVocabLow,
    VOCAB_HIGH: polyVocabHigh,
  };

  // Load and prepare prompts from files
  const phrasesPrompt = loadPrompt(PHRASES_PROMPT_PATH);
  const polysemousPrompt = loadPrompt(POLYSEMOUS_PROMPT_PATH);
  const vocabularyPrompt = loadPrompt(VOCABULARY_PROMPT_PATH);

  const phrasesSystem = substituteVariables(phrasesPrompt.system, variables);
  const phrasesUser = phrasesPrompt.user ? substituteVariables(phrasesPrompt.user, variables) : passage;
  const polysemousSystem = substituteVariables(polysemousPrompt.system, variables);
  const polysemousUser = polysemousPrompt.user ? substituteVariables(polysemousPrompt.user, variables) : passage;
  const vocabularySystem = substituteVariables(vocabularyPrompt.system, variables);
  const vocabularyUser = vocabularyPrompt.user ? substituteVariables(vocabularyPrompt.user, variables) : passage;

  // Launch all three calls in parallel
  const [phrasesResult, polysemousResult, vocabResult] = await Promise.all([
    callWithTool(client, phrasesSystem, phrasesUser, PHRASES_TOOL, config),
    callWithTool(client, polysemousSystem, polysemousUser, POLYSEMOUS_TOOL, config),
    callWithTool(client, vocabularySystem, vocabularyUser, VOCABULARY_TOOL, config),
  ]);

  // Extract raw lists from each call
  const phrasesData = phrasesResult.result as Record<string, unknown>;
  const rawLiteral = (phrasesData['literal'] ?? []) as Array<{ term: string; level: string; context?: string }>;
  const rawNonLiteral = (phrasesData['non_literal'] ?? []) as Array<{ term: string; level: string; context?: string }>;
  const rawPolysemous = ((polysemousResult.result as Record<string, unknown>)['polysemous'] ?? []) as Array<{ term: string; level: string; context?: string }>;
  const rawVocab = ((vocabResult.result as Record<string, unknown>)['vocabulary'] ?? []) as Array<{ term: string; level: string; context?: string }>;

  // Helper: convert single context string to array for compatibility with ExtractionOutput
  const toContextArray = (ctx?: string): string[] | undefined =>
    ctx ? [ctx] : undefined;

  // ---- SERVER-SIDE POST-PROCESSING ----

  // 1. Process phrases: apply A2 floor to literal, +1 bump to non-literal
  const literalPhrases: ExtractedTerm[] = rawLiteral.map((p) => ({
    term: p.term,
    level: applyLiteralFloor(p.level as CefrLevel),
    ...(p.context ? { context: toContextArray(p.context) } : {}),
  }));

  const nonLiteralPhrases: ExtractedTerm[] = rawNonLiteral.map((p) => ({
    term: p.term,
    level: bumpLevel(p.level as CefrLevel),
    ...(p.context ? { context: toContextArray(p.context) } : {}),
  }));

  const phrases: ExtractedTerm[] = [...literalPhrases, ...nonLiteralPhrases];

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

  // 3. Cross-list dedup per Phase 1 Cross-List Priority Rule:
  //    - Default: polysemy > phrases > vocabulary
  //    - Exception: non-literal phrases (idioms/collocations/fixed expressions) beat polysemy
  //      because the phrase as a whole is the lesson the student needs
  //    - Polysemy always beats vocabulary (same word → polysemy wins)

  const polysemousTerms = new Set(filteredPolysemous.map((t) => t.term.trim().toLowerCase()));
  const nonLiteralTermSet = new Set(nonLiteralPhrases.map((p) => p.term.trim().toLowerCase()));

  // For non-literal phrases containing a polysemous word: keep the phrase, drop the polysemy
  // For literal phrases containing a polysemous word: drop the phrase, keep the polysemy
  const dedupedPhrases = filteredPhrases.filter((p) => {
    const phraseNorm = p.term.trim().toLowerCase();
    const words = phraseNorm.split(/\s+/);
    const containsPolysemous = words.some((w) => polysemousTerms.has(w));

    if (!containsPolysemous) return true; // No conflict, keep phrase

    // Conflict: phrase contains a polysemous word
    if (nonLiteralTermSet.has(phraseNorm)) {
      return true; // Non-literal phrase wins — it's idiomatic, the whole phrase is the lesson
    }
    return false; // Literal phrase loses to polysemy
  });

  // Remove polysemous entries that lost to non-literal phrases
  const dedupedPolysemous = filteredPolysemous.filter((p) => {
    const polyNorm = p.term.trim().toLowerCase();
    // Check if any non-literal phrase contains this polysemous word
    for (const phrase of dedupedPhrases) {
      const phraseNorm = phrase.term.trim().toLowerCase();
      if (nonLiteralTermSet.has(phraseNorm)) {
        const words = phraseNorm.split(/\s+/);
        if (words.includes(polyNorm)) {
          return false; // This polysemous word is inside a winning non-literal phrase → drop polysemy
        }
      }
    }
    return true;
  });

  // Remove vocabulary that duplicates polysemous entries
  const finalPolysemousTerms = new Set(dedupedPolysemous.map((t) => t.term.trim().toLowerCase()));
  const phraseTerms = new Set(dedupedPhrases.map((t) => t.term.trim().toLowerCase()));

  const dedupedVocab = filteredVocab.filter((v) => {
    const normalized = v.term.trim().toLowerCase();
    // Polysemy beats vocabulary — if same word in both, drop vocab
    if (finalPolysemousTerms.has(normalized)) return false;
    // Exact phrase match — drop vocab (but phrases + vocab can coexist for different lessons,
    // so only drop if the vocab term IS the phrase, not just contained in it)
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
