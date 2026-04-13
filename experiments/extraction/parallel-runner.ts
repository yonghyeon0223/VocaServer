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

// ---- textFit (server-side computation) ----

function computeTextFit(allLevels: CefrLevel[], studentLevel: CefrLevel): TextFit {
  if (allLevels.length === 0) return 'not_applicable';

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

// ---- Tool Schemas ----

const PHRASES_TOOL: Anthropic.Tool = {
  name: 'list_phrases',
  description: 'List multi-word combinations from the text',
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
            context: { type: 'string', description: 'The most relevant sentence fragment' },
            worthStudying: { type: 'boolean', description: 'Whether this phrase is a good learning target for the student' },
            rationale: { type: 'string', description: 'Why this phrase is or is not worth learning for the student' },
          },
          required: ['term', 'level', 'worthStudying', 'rationale'],
        },
      },
    },
    required: ['phrases'],
  },
};

const WORDS_TOOL: Anthropic.Tool = {
  name: 'list_words',
  description: 'List content words from the text with non-default sense detection',
  input_schema: {
    type: 'object' as const,
    properties: {
      words: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            term: { type: 'string' },
            level: { type: 'string', enum: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] },
            context: { type: 'string', description: 'The most relevant occurrence in the text' },
            nonDefaultSense: { type: 'boolean', description: 'Whether the word is used in a non-default sense' },
            worthStudying: { type: 'boolean', description: 'Whether this word is a good learning target for the student' },
            rationale: { type: 'string', description: 'Why this word is or is not worth learning for the student' },
          },
          required: ['term', 'level', 'nonDefaultSense', 'worthStudying', 'rationale'],
        },
      },
    },
    required: ['words'],
  },
};

// Legacy tool schemas for v7 and earlier
const PHRASES_PRODUCE_TOOL: Anthropic.Tool = {
  name: 'list_phrases',
  description: 'List all multi-word combinations from the text',
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
            context: { type: 'string', description: 'The most relevant sentence fragment' },
          },
          required: ['term', 'level'],
        },
      },
    },
    required: ['phrases'],
  },
};

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
            level: { type: 'string', enum: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] },
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

interface PromptPaths {
  phrases: string;
  phrasesReview: string | null;
  words: string | null;       // v9+: combined polysemous + vocabulary
  polysemous: string | null;  // v5–v8: separate polysemous
  vocabulary: string | null;  // v5–v8: separate vocabulary
}

function parseVersion(v: string): number {
  const match = v.match(/^v(\d+)$/);
  return match ? parseInt(match[1]!, 10) : 0;
}

export function getPromptPaths(version?: string): PromptPaths {
  const v = version ?? 'v10';
  const vNum = parseVersion(v);
  const hasReviewer = vNum < 8;
  const hasCombinedWords = vNum >= 9;
  const hasSimpleFilename = vNum >= 10;
  const phrasesFile = hasSimpleFilename ? `${v}-phrases.txt` : `${v}-phrases-produce.txt`;
  return {
    phrases: `${PROMPTS_DIR}/${phrasesFile}`,
    phrasesReview: hasReviewer ? `${PROMPTS_DIR}/${v}-phrases-review.txt` : null,
    words: hasCombinedWords ? `${PROMPTS_DIR}/${v}-words.txt` : null,
    polysemous: hasCombinedWords ? null : `${PROMPTS_DIR}/${v}-polysemous.txt`,
    vocabulary: hasCombinedWords ? null : `${PROMPTS_DIR}/${v}-vocabulary.txt`,
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
  rawResponse: string;
  tokenUsage: { inputTokens: number; outputTokens: number };
  latencyMs: number;
  perCallStats: {
    phrases: { inputTokens: number; outputTokens: number; latencyMs: number };
    words?: { inputTokens: number; outputTokens: number; latencyMs: number };
    polysemous?: { inputTokens: number; outputTokens: number; latencyMs: number };
    vocabulary?: { inputTokens: number; outputTokens: number; latencyMs: number };
  };
  perCallRaw: {
    phrases: unknown;
    words?: unknown;
    polysemous?: unknown;
    vocabulary?: unknown;
  };
}

export async function runParallel(
  client: Anthropic,
  passage: string,
  studentLevel: CefrLevel,
  config: RunConfig,
  promptVersion?: string,
): Promise<ParallelRunResult> {
  const studentIdx = cefrIndex(studentLevel);

  // Legacy range variables for v5–v8 prompts
  const nonLiteralLow = CEFR_ORDER[Math.max(studentIdx - 1, 1)]!;
  const nonLiteralHigh = CEFR_ORDER[Math.min(studentIdx + 1, 5)]!;
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

  const paths = getPromptPaths(promptVersion);
  const phrasesPrompt = loadPrompt(paths.phrases);
  const phrasesSystem = substituteVariables(phrasesPrompt.system, variables);
  const phrasesUser = phrasesPrompt.user ? substituteVariables(phrasesPrompt.user, variables) : passage;

  // v9+: 2 parallel calls (phrases + words)
  // v5–v8: 3 parallel calls (phrases + polysemous + vocabulary), optionally + reviewer
  if (paths.words) {
    return runV9(client, config, paths, variables, passage, studentLevel, phrasesSystem, phrasesUser);
  } else {
    return runLegacy(client, config, paths, variables, passage, studentLevel, phrasesSystem, phrasesUser);
  }
}

// ---- v9+: 2-call architecture (phrases + words) ----

async function runV9(
  client: Anthropic,
  config: RunConfig,
  paths: PromptPaths,
  variables: Record<string, string>,
  passage: string,
  studentLevel: CefrLevel,
  phrasesSystem: string,
  phrasesUser: string,
): Promise<ParallelRunResult> {
  const wordsPrompt = loadPrompt(paths.words!);
  const wordsSystem = substituteVariables(wordsPrompt.system, variables);
  const wordsUser = wordsPrompt.user ? substituteVariables(wordsPrompt.user, variables) : passage;

  const [phrasesResult, wordsResult] = await Promise.all([
    callWithTool(client, phrasesSystem, phrasesUser, PHRASES_TOOL, config),
    callWithTool(client, wordsSystem, wordsUser, WORDS_TOOL, config),
  ]);

  // Process phrases
  const allPhrases = ((phrasesResult.result as Record<string, unknown>)['phrases'] ?? []) as Array<{ term: string; level: string; context?: string; worthStudying?: boolean }>;
  const rawPhrases = allPhrases.filter((p) => p.worthStudying !== false);

  // Process words — split into polysemous and vocabulary
  const allWords = ((wordsResult.result as Record<string, unknown>)['words'] ?? []) as Array<{ term: string; level: string; context?: string; nonDefaultSense?: boolean; worthStudying?: boolean }>;
  const worthWords = allWords.filter((w) => w.worthStudying !== false);
  const rawPolysemous = worthWords.filter((w) => w.nonDefaultSense === true);
  const rawVocab = worthWords.filter((w) => !w.nonDefaultSense);

  const toContextArray = (ctx?: string): string[] | undefined =>
    ctx ? [ctx] : undefined;

  const phrases: ExtractedTerm[] = rawPhrases.map((p) => ({
    term: p.term,
    level: p.level as CefrLevel,
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

  // Server-side: range filter + within-list dedup
  const filteredPhrases = dedup(phrases.filter((t) => isInRange(t.level, studentLevel)));
  const filteredPolysemous = dedup(polysemous.filter((t) => isInRange(t.level, studentLevel)));
  const filteredVocab = dedup(vocab.filter((t) => isInRange(t.level, studentLevel)));

  // textFit uses all word levels (before worthStudying filter)
  const allLevels = allWords.map((w) => w.level as CefrLevel);
  const textFit = computeTextFit(allLevels, studentLevel);

  const output: ExtractionOutput = {
    textFit,
    phrases: filteredPhrases,
    polysemous: filteredPolysemous,
    vocabulary: filteredVocab,
  };

  const totalInput = phrasesResult.inputTokens + wordsResult.inputTokens;
  const totalOutput = phrasesResult.outputTokens + wordsResult.outputTokens;
  const wallClockLatency = Math.max(phrasesResult.latencyMs, wordsResult.latencyMs);

  return {
    rawResponse: JSON.stringify(output),
    tokenUsage: { inputTokens: totalInput, outputTokens: totalOutput },
    latencyMs: wallClockLatency,
    perCallStats: {
      phrases: { inputTokens: phrasesResult.inputTokens, outputTokens: phrasesResult.outputTokens, latencyMs: phrasesResult.latencyMs },
      words: { inputTokens: wordsResult.inputTokens, outputTokens: wordsResult.outputTokens, latencyMs: wordsResult.latencyMs },
    },
    perCallRaw: {
      phrases: phrasesResult.result,
      words: wordsResult.result,
    },
  };
}

// ---- v5–v8: 3-call architecture (phrases + polysemous + vocabulary) ----

async function runLegacy(
  client: Anthropic,
  config: RunConfig,
  paths: PromptPaths,
  variables: Record<string, string>,
  passage: string,
  studentLevel: CefrLevel,
  phrasesSystem: string,
  phrasesUser: string,
): Promise<ParallelRunResult> {
  const polysemousPrompt = loadPrompt(paths.polysemous!);
  const vocabularyPrompt = loadPrompt(paths.vocabulary!);
  const polysemousSystem = substituteVariables(polysemousPrompt.system, variables);
  const polysemousUser = polysemousPrompt.user ? substituteVariables(polysemousPrompt.user, variables) : passage;
  const vocabularySystem = substituteVariables(vocabularyPrompt.system, variables);
  const vocabularyUser = vocabularyPrompt.user ? substituteVariables(vocabularyPrompt.user, variables) : passage;

  const hasReviewer = paths.phrasesReview !== null;

  const [produceResult, polysemousResult, vocabResult] = await Promise.all([
    callWithTool(client, phrasesSystem, phrasesUser, hasReviewer ? PHRASES_PRODUCE_TOOL : PHRASES_TOOL, config),
    callWithTool(client, polysemousSystem, polysemousUser, POLYSEMOUS_TOOL, config),
    callWithTool(client, vocabularySystem, vocabularyUser, VOCABULARY_TOOL, config),
  ]);

  let rawPhrases: Array<{ term: string; level: string; context?: string }>;
  let reviewResult: { inputTokens: number; outputTokens: number; latencyMs: number } | null = null;

  if (hasReviewer) {
    const reviewPrompt = loadPrompt(paths.phrasesReview!);
    const producedPhrases = ((produceResult.result as Record<string, unknown>)['phrases'] ?? []) as Array<{ term: string; level: string; context?: string }>;
    const candidatesText = producedPhrases.map((p) => `- ${p.term} (${p.level}) — ${p.context ?? ''}`).join('\n');
    const reviewVars = { ...variables, CANDIDATES: candidatesText };
    const reviewSystem = substituteVariables(reviewPrompt.system, reviewVars);
    const reviewUser = reviewPrompt.user ? substituteVariables(reviewPrompt.user, reviewVars) : candidatesText;

    const reviewResponse = await callWithTool(client, reviewSystem, reviewUser, PHRASES_REVIEW_TOOL, config);
    reviewResult = { inputTokens: reviewResponse.inputTokens, outputTokens: reviewResponse.outputTokens, latencyMs: reviewResponse.latencyMs };
    rawPhrases = ((reviewResponse.result as Record<string, unknown>)['phrases'] ?? []) as Array<{ term: string; level: string; context?: string }>;
  } else {
    const allPhrases = ((produceResult.result as Record<string, unknown>)['phrases'] ?? []) as Array<{ term: string; level: string; context?: string; worthStudying?: boolean }>;
    rawPhrases = allPhrases.filter((p) => p.worthStudying !== false);
  }

  const allPolysemous = ((polysemousResult.result as Record<string, unknown>)['polysemous'] ?? []) as Array<{ term: string; level: string; context?: string; worthStudying?: boolean }>;
  const rawPolysemous = hasReviewer ? allPolysemous : allPolysemous.filter((p) => p.worthStudying !== false);
  const allVocab = ((vocabResult.result as Record<string, unknown>)['vocabulary'] ?? []) as Array<{ term: string; level: string; context?: string; worthStudying?: boolean }>;
  const rawVocab = hasReviewer ? allVocab : allVocab.filter((v) => v.worthStudying !== false);

  const toContextArray = (ctx?: string): string[] | undefined =>
    ctx ? [ctx] : undefined;

  const phrases: ExtractedTerm[] = rawPhrases.map((p) => ({
    term: p.term,
    level: p.level as CefrLevel,
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

  const filteredPhrases = dedup(phrases.filter((t) => isInRange(t.level, studentLevel)));
  const filteredPolysemous = dedup(polysemous.filter((t) => isInRange(t.level, studentLevel)));
  const filteredVocab = dedup(vocab.filter((t) => isInRange(t.level, studentLevel)));

  const allLevels = allVocab.map((v) => v.level as CefrLevel);
  const textFit = computeTextFit(allLevels, studentLevel);

  const output: ExtractionOutput = {
    textFit,
    phrases: filteredPhrases,
    polysemous: filteredPolysemous,
    vocabulary: filteredVocab,
  };

  const reviewInput = reviewResult?.inputTokens ?? 0;
  const reviewOutput = reviewResult?.outputTokens ?? 0;
  const reviewLatency = reviewResult?.latencyMs ?? 0;

  const totalInput = produceResult.inputTokens + reviewInput + polysemousResult.inputTokens + vocabResult.inputTokens;
  const totalOutput = produceResult.outputTokens + reviewOutput + polysemousResult.outputTokens + vocabResult.outputTokens;
  const parallelLatency = Math.max(produceResult.latencyMs, polysemousResult.latencyMs, vocabResult.latencyMs);
  const wallClockLatency = parallelLatency + reviewLatency;

  return {
    rawResponse: JSON.stringify(output),
    tokenUsage: { inputTokens: totalInput, outputTokens: totalOutput },
    latencyMs: wallClockLatency,
    perCallStats: {
      phrases: {
        inputTokens: produceResult.inputTokens + reviewInput,
        outputTokens: produceResult.outputTokens + reviewOutput,
        latencyMs: produceResult.latencyMs + reviewLatency,
      },
      polysemous: { inputTokens: polysemousResult.inputTokens, outputTokens: polysemousResult.outputTokens, latencyMs: polysemousResult.latencyMs },
      vocabulary: { inputTokens: vocabResult.inputTokens, outputTokens: vocabResult.outputTokens, latencyMs: vocabResult.latencyMs },
    },
    perCallRaw: {
      phrases: produceResult.result,
      polysemous: polysemousResult.result,
      vocabulary: vocabResult.result,
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
