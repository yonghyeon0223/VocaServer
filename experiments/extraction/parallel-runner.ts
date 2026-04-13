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

// ---- Phrase Normalization ----

// Preposition phrases and connectors that should stand alone (not have a verb attached).
// If the AI returns "sit next to", we strip "sit" and keep "next to".
const STANDALONE_PATTERNS = new Set([
  'next to', 'instead of', 'because of', 'in front of', 'on top of',
  'in spite of', 'apart from', 'according to', 'due to', 'prior to',
  'as well as', 'in addition to', 'in order to', 'in terms of',
  'on behalf of', 'by means of', 'in case of', 'regardless of',
  'as opposed to', 'with regard to', 'in contrast to',
]);

// Phrasal verbs whose trailing preposition is NOT part of the core pattern.
// "end up in" → "end up" (the "in" is context-specific, not part of the phrasal verb).
const PHRASAL_VERB_CORES = new Set([
  'end up', 'give up', 'make up', 'take up', 'come up', 'show up',
  'set up', 'pick up', 'put up', 'bring up', 'grow up', 'turn up',
  'look up', 'keep up', 'catch up', 'break down', 'turn down',
  'cut down', 'break up', 'blow up', 'clean up', 'fix up',
  'carry on', 'go on', 'hold on', 'move on', 'pass on',
  'figure out', 'find out', 'point out', 'turn out', 'work out',
  'carry out', 'check out', 'run out', 'stand out', 'sort out',
]);

function normalizePhrase(term: string): string {
  const words = term.trim().toLowerCase().split(/\s+/);

  // Check if removing the first word yields a standalone pattern
  if (words.length >= 3) {
    const withoutFirstWord = words.slice(1).join(' ');
    if (STANDALONE_PATTERNS.has(withoutFirstWord)) {
      return withoutFirstWord;
    }
  }

  // Check if the phrase is a phrasal verb core + trailing preposition
  if (words.length >= 3) {
    const firstTwo = words.slice(0, 2).join(' ');
    if (PHRASAL_VERB_CORES.has(firstTwo)) {
      return firstTwo;
    }
  }

  return term.trim();
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
        description: 'Multi-word patterns where knowing individual words is not enough',
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

export function getPromptPaths(version?: string): { phrases: string; polysemous: string; vocabulary: string } {
  const v = version ?? 'v5';
  return {
    phrases: `${PROMPTS_DIR}/${v}-phrases.txt`,
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
  const phrasesPrompt = loadPrompt(paths.phrases);
  const polysemousPrompt = loadPrompt(paths.polysemous);
  const vocabularyPrompt = loadPrompt(paths.vocabulary);

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
  const rawPhrases = ((phrasesResult.result as Record<string, unknown>)['phrases'] ?? []) as Array<{ term: string; level: string; context?: string }>;
  const rawPolysemous = ((polysemousResult.result as Record<string, unknown>)['polysemous'] ?? []) as Array<{ term: string; level: string; context?: string }>;
  const rawVocab = ((vocabResult.result as Record<string, unknown>)['vocabulary'] ?? []) as Array<{ term: string; level: string; context?: string }>;

  // Helper: convert single context string to array for compatibility with ExtractionOutput
  const toContextArray = (ctx?: string): string[] | undefined =>
    ctx ? [ctx] : undefined;

  // ---- SERVER-SIDE POST-PROCESSING ----

  // 0. Normalize phrase forms: strip leading verbs from preposition/connector phrases.
  //    The AI often returns "sit next to" instead of "next to", or "end up in" instead of "end up".
  //    This step extracts the core pattern when the AI over-attaches.
  const normalizedPhrases = rawPhrases.map((p) => ({
    ...p,
    term: normalizePhrase(p.term),
  }));

  // 1. Process phrases: all phrases get +1 bump
  const phrases: ExtractedTerm[] = normalizedPhrases.map((p) => ({
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
