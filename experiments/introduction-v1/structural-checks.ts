// Structural checks for word introduction prompt output.
// Validates the compact JSON schema from generate_introduction tool_use.

export interface IntroOption {
  text: string;
  response: string;
}

export interface ExploreOption {
  text: string;
  response: string;
  correct: boolean;
}

export interface ExploreTurn {
  type: string;
  question: string;
  answerIndex: number;
  options: ExploreOption[];
}

export interface ParsedIntroduction {
  intro: {
    scene: string;
    question: string;
    options: IntroOption[];
  };
  explore: ExploreTurn[];
  objectives: string[];
  summary: string;
}

export interface StructuralCheck {
  name: string;
  passed: boolean;
  message: string;
}

const VALID_TYPES = ['AR', 'CP', 'CR', 'SC', 'OP', 'CX', 'PD', 'CL', 'IN', 'MU', 'MF', 'WD'] as const;

// ---- JSON repair utilities ----

/**
 * Attempt to repair a JSON string that has unescaped quotes.
 * Strategy: replace Korean-context double quotes with escaped versions,
 * then try progressively more aggressive repairs.
 */
function repairJsonString(broken: string): unknown | null {
  // Strategy 1: Direct parse (maybe it's fine)
  try { return JSON.parse(broken); } catch { /* continue */ }

  // Strategy 2: Replace unescaped double quotes in Korean text contexts
  // Matches " that appear between Korean chars, after spaces before Korean, etc.
  let repaired = broken
    .replace(/(?<=[가-힣a-zA-Z!?,.~])"\s*(?=[가-힣])/g, '\\"')
    .replace(/(?<=[가-힣])\s*"(?=[가-힣a-zA-Z!?,.~\s])/g, '\\"')
    .replace(/(?<=[:,\[]\s*)"(?=[가-힣])/g, '') // remove stray quotes before Korean at structural positions
    ;
  try { return JSON.parse(repaired); } catch { /* continue */ }

  // Strategy 3: Replace ALL inner double quotes with single quotes
  // Keep only structural quotes (after : , [ { and before } ] , :)
  repaired = broken.replace(/"([^"]{20,})"/g, (match, inner: string) => {
    // If inner content looks like a long Korean string with quotes, replace inner quotes
    const fixed = inner.replace(/"/g, "'");
    return `"${fixed}"`;
  });
  try { return JSON.parse(repaired); } catch { /* continue */ }

  // Strategy 4: Extract the structure manually for known shapes
  // For `i` field: look for s, q, o keys
  // For `e` field: look for array of objects with t, q, a, o keys
  // This is too fragile — give up
  return null;
}

/**
 * Coerce a field to the expected type.
 * If it's a string when we expect object/array, try parsing + repair.
 */
function coerceField(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const result = repairJsonString(value);
  return result ?? value; // return original string if all repair fails
}

// ---- Parse raw JSON into structured form ----

export function parseResponse(raw: string): {
  parsed: ParsedIntroduction | null;
  parseErrors: string[];
} {
  const parseErrors: string[] = [];

  let json: Record<string, unknown>;
  try {
    json = JSON.parse(raw);
  } catch {
    // Try repairing the entire raw response
    const repaired = repairJsonString(raw);
    if (repaired && typeof repaired === 'object') {
      json = repaired as Record<string, unknown>;
    } else {
      return { parsed: null, parseErrors: ['JSON parse failed: ' + raw.slice(0, 200)] };
    }
  }

  // Extract intro — coerce string→object if needed
  let i = coerceField(json['i']) as Record<string, unknown> | undefined;
  if (!i || typeof i !== 'object' || Array.isArray(i)) {
    parseErrors.push('Missing or invalid intro block (i)');
    return { parsed: null, parseErrors };
  }

  const scene = typeof i['s'] === 'string' ? i['s'] : '';
  const question = typeof i['q'] === 'string' ? i['q'] : '';

  // Intro options — also coerce
  let rawIntroOpts = coerceField(i['o']);
  if (!Array.isArray(rawIntroOpts)) rawIntroOpts = [];
  const introOptions: IntroOption[] = [];
  for (const opt of rawIntroOpts as unknown[]) {
    if (Array.isArray(opt) && opt.length >= 2 && typeof opt[0] === 'string' && typeof opt[1] === 'string') {
      introOptions.push({ text: opt[0], response: opt[1] });
    } else {
      parseErrors.push('Invalid intro option tuple: ' + JSON.stringify(opt).slice(0, 100));
    }
  }

  // Extract explore turns — coerce string→array if needed
  const rawE = coerceField(json['e']);
  const rawExplore = Array.isArray(rawE) ? rawE : [];
  const explore: ExploreTurn[] = [];

  for (let idx = 0; idx < rawExplore.length; idx++) {
    let turn = rawExplore[idx] as Record<string, unknown>;
    // Individual turn might also be stringified
    if (typeof turn === 'string') {
      const coerced = coerceField(turn);
      if (coerced && typeof coerced === 'object' && !Array.isArray(coerced)) {
        turn = coerced as Record<string, unknown>;
      }
    }
    if (!turn || typeof turn !== 'object') {
      parseErrors.push(`Explore turn ${idx} is not an object`);
      continue;
    }

    const type = typeof turn['t'] === 'string' ? turn['t'] : '';
    const q = typeof turn['q'] === 'string' ? turn['q'] : '';
    const a = typeof turn['a'] === 'number' ? turn['a'] : -1;

    let rawOpts = coerceField(turn['o']);
    if (!Array.isArray(rawOpts)) rawOpts = [];
    const options: ExploreOption[] = [];
    for (let oi = 0; oi < (rawOpts as unknown[]).length; oi++) {
      const opt = (rawOpts as unknown[])[oi];
      if (Array.isArray(opt) && opt.length >= 2 && typeof opt[0] === 'string' && typeof opt[1] === 'string') {
        options.push({ text: opt[0], response: opt[1], correct: oi === a });
      } else {
        parseErrors.push(`Explore turn ${idx} option ${oi} invalid: ${JSON.stringify(opt).slice(0, 100)}`);
      }
    }

    explore.push({ type, question: q, answerIndex: a, options });
  }

  if (parseErrors.length > 0 && introOptions.length === 0 && explore.length === 0) {
    return { parsed: null, parseErrors };
  }

  // Extract learning objectives — coerce string→array
  const rawL = coerceField(json['l']);
  const objectives: string[] = Array.isArray(rawL) ? rawL.filter((o): o is string => typeof o === 'string') : [];

  // Extract summary
  const summary = typeof json['s'] === 'string' ? json['s'] : '';

  return {
    parsed: {
      intro: { scene, question, options: introOptions },
      explore,
      objectives,
      summary,
    },
    parseErrors,
  };
}

// ---- Run all structural checks ----

export function runStructuralChecks(
  parsed: ParsedIntroduction | null,
  parseErrors: string[],
  targetWord: string,
): StructuralCheck[] {
  const checks: StructuralCheck[] = [];

  // 1. json_parse
  checks.push({
    name: 'json_parse',
    passed: parsed !== null && parseErrors.length === 0,
    message: parsed ? (parseErrors.length === 0 ? 'Valid JSON, schema OK' : `Parsed with ${parseErrors.length} error(s)`) : 'Failed to parse',
  });

  if (!parsed) return checks;

  // 2. intro_structure
  const introOk = parsed.intro.scene.trim().length > 0
    && parsed.intro.question.trim().length > 0
    && parsed.intro.options.length >= 2
    && parsed.intro.options.length <= 3
    && parsed.intro.options.every((o) => o.text.trim().length > 0 && o.response.trim().length > 0);
  checks.push({
    name: 'intro_structure',
    passed: introOk,
    message: introOk
      ? `Scene + question + ${parsed.intro.options.length} options OK`
      : `Scene empty: ${parsed.intro.scene.length === 0}, question empty: ${parsed.intro.question.length === 0}, options: ${parsed.intro.options.length}`,
  });

  // 5. target_balance — if target appears in options, it must be in ALL or NONE (per turn)
  const targetLower = targetWord.toLowerCase();
  const unbalancedTurns: string[] = [];

  // Check intro
  const introWithTarget = parsed.intro.options.filter((o) => o.text.toLowerCase().includes(targetLower));
  if (introWithTarget.length > 0 && introWithTarget.length < parsed.intro.options.length) {
    unbalancedTurns.push('intro');
  }

  // Check each explore turn
  for (let ti = 0; ti < parsed.explore.length; ti++) {
    const turn = parsed.explore[ti];
    const withTarget = turn.options.filter((o) => o.text.toLowerCase().includes(targetLower));
    if (withTarget.length > 0 && withTarget.length < turn.options.length) {
      unbalancedTurns.push(`explore ${ti + 1}`);
    }
  }

  checks.push({
    name: 'target_balance',
    passed: unbalancedTurns.length === 0,
    message: unbalancedTurns.length === 0
      ? 'Target term balanced across options in all turns'
      : `Unbalanced target in: ${unbalancedTurns.join(', ')} — some options have "${targetWord}", others don't`,
  });

  // 6. explore_count
  const exploreCount = parsed.explore.length;
  checks.push({
    name: 'explore_count',
    passed: exploreCount >= 1 && exploreCount <= 4,
    message: `${exploreCount} explore turn(s)`,
  });

  // 7. explore_answer_valid
  const invalidAnswers = parsed.explore.filter((e) => e.answerIndex < 0 || e.answerIndex >= e.options.length);
  checks.push({
    name: 'explore_answer_valid',
    passed: invalidAnswers.length === 0,
    message: invalidAnswers.length === 0
      ? 'All answer indices valid'
      : `${invalidAnswers.length} turn(s) with out-of-bounds answer index`,
  });

  // 8. explore_types_valid
  const invalidTypes = parsed.explore.filter((e) => !(VALID_TYPES as readonly string[]).includes(e.type));
  checks.push({
    name: 'explore_types_valid',
    passed: invalidTypes.length === 0,
    message: invalidTypes.length === 0
      ? `Types used: ${parsed.explore.map((e) => e.type).join(', ')}`
      : `Invalid type(s): ${invalidTypes.map((e) => e.type).join(', ')}`,
  });

  // 9. has_objectives
  const objCount = parsed.objectives.length;
  checks.push({
    name: 'has_objectives',
    passed: objCount >= 1 && objCount <= 5,
    message: objCount >= 1 && objCount <= 5
      ? `${objCount} learning objective(s)`
      : objCount === 0 ? 'No objectives' : `${objCount} objectives (expected 1-5)`,
  });

  // 10. has_summary
  checks.push({
    name: 'has_summary',
    passed: parsed.summary.trim().length > 0,
    message: parsed.summary.trim().length > 0
      ? `Summary: ${parsed.summary.slice(0, 50)}...`
      : 'Summary is empty',
  });

  // 10. option_count
  const allOptionCounts = [
    parsed.intro.options.length,
    ...parsed.explore.map((e) => e.options.length),
  ];
  const badOptionCounts = allOptionCounts.filter((c) => c < 2 || c > 3);
  const allTuplesValid = parsed.intro.options.every((o) => typeof o.text === 'string' && typeof o.response === 'string')
    && parsed.explore.every((e) => e.options.every((o) => typeof o.text === 'string' && typeof o.response === 'string'));
  checks.push({
    name: 'option_count',
    passed: badOptionCounts.length === 0 && allTuplesValid,
    message: badOptionCounts.length === 0 && allTuplesValid
      ? `All turns have 2-4 valid option tuples`
      : `${badOptionCounts.length} turn(s) with invalid option count`,
  });

  return checks;
}
