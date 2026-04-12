import type { CefrLevel, TextFit } from './runner.js';

// ---- Types ----

export interface CheckResult {
  name: string;
  passed: boolean;
  message: string;
}

export interface ExtractedTerm {
  term: string;
  level: CefrLevel;
  context?: string[];
}

export interface ExtractionOutput {
  textFit: TextFit;
  phrases: ExtractedTerm[];
  polysemous: ExtractedTerm[];
  vocabulary: ExtractedTerm[];
}

// ---- Valid CEFR Levels ----

const VALID_CEFR_LEVELS: Set<string> = new Set(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);

// ---- Valid TextFit Values ----

const VALID_TEXT_FIT: Set<string> = new Set([
  'too_easy', 'easy', 'appropriate', 'stretch', 'too_hard', 'not_applicable',
]);

// ---- Individual Check Functions ----

export function checkValidJson(raw: string): CheckResult {
  try {
    JSON.parse(raw);
    return { name: 'valid_json', passed: true, message: 'Valid JSON' };
  } catch (err) {
    return {
      name: 'valid_json',
      passed: false,
      message: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export function checkTopLevelSchema(parsed: unknown): CheckResult {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { name: 'top_level_schema', passed: false, message: 'Expected a JSON object, got array or non-object' };
  }

  const obj = parsed as Record<string, unknown>;
  const requiredKeys = ['textFit', 'phrases', 'polysemous', 'vocabulary'];

  for (const key of requiredKeys) {
    if (!(key in obj)) {
      return { name: 'top_level_schema', passed: false, message: `Missing required field: ${key}` };
    }
  }

  if (typeof obj['textFit'] !== 'string') {
    return { name: 'top_level_schema', passed: false, message: '`textFit` must be a string' };
  }

  for (const listKey of ['phrases', 'polysemous', 'vocabulary']) {
    if (!Array.isArray(obj[listKey])) {
      return { name: 'top_level_schema', passed: false, message: `\`${listKey}\` must be an array` };
    }
  }

  // Check for extra top-level fields
  const allowedKeys = new Set(requiredKeys);
  for (const key of Object.keys(obj)) {
    if (!allowedKeys.has(key)) {
      return { name: 'top_level_schema', passed: false, message: `Unexpected top-level field: ${key}` };
    }
  }

  return { name: 'top_level_schema', passed: true, message: 'Top-level schema valid' };
}

export function checkTextFitValid(parsed: unknown): CheckResult {
  const obj = parsed as Record<string, unknown>;
  const value = obj['textFit'];

  if (typeof value !== 'string' || !VALID_TEXT_FIT.has(value)) {
    return {
      name: 'text_fit_valid',
      passed: false,
      message: `Invalid textFit value: "${value}". Must be one of: ${[...VALID_TEXT_FIT].join(', ')}`,
    };
  }

  return { name: 'text_fit_valid', passed: true, message: `textFit: ${value}` };
}

export function checkTermObjectsValid(parsed: unknown): CheckResult {
  const obj = parsed as Record<string, unknown>;
  const lists = ['phrases', 'polysemous', 'vocabulary'] as const;
  const allowedFields = new Set(['term', 'level', 'context']);

  for (const listName of lists) {
    const list = obj[listName] as unknown[];
    for (let i = 0; i < list.length; i++) {
      const item = list[i];

      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        return {
          name: 'term_objects_valid',
          passed: false,
          message: `${listName}[${i}] is not an object`,
        };
      }

      const termObj = item as Record<string, unknown>;

      if (typeof termObj['term'] !== 'string' || termObj['term'].length === 0) {
        return {
          name: 'term_objects_valid',
          passed: false,
          message: `${listName}[${i}] missing or invalid 'term' field`,
        };
      }

      if (typeof termObj['level'] !== 'string') {
        return {
          name: 'term_objects_valid',
          passed: false,
          message: `${listName}[${i}] missing or invalid 'level' field`,
        };
      }

      if ('context' in termObj) {
        if (!Array.isArray(termObj['context'])) {
          return {
            name: 'term_objects_valid',
            passed: false,
            message: `${listName}[${i}] 'context' must be an array`,
          };
        }
        for (const ctx of termObj['context'] as unknown[]) {
          if (typeof ctx !== 'string') {
            return {
              name: 'term_objects_valid',
              passed: false,
              message: `${listName}[${i}] 'context' array contains non-string`,
            };
          }
        }
      }

      // Check for hallucinated fields
      for (const key of Object.keys(termObj)) {
        if (!allowedFields.has(key)) {
          return {
            name: 'term_objects_valid',
            passed: false,
            message: `${listName}[${i}] has unexpected field: ${key}`,
          };
        }
      }
    }
  }

  return { name: 'term_objects_valid', passed: true, message: 'All term objects valid' };
}

export function checkNoDuplicateTerms(output: ExtractionOutput): CheckResult {
  const lists = [
    { name: 'phrases', items: output.phrases },
    { name: 'polysemous', items: output.polysemous },
    { name: 'vocabulary', items: output.vocabulary },
  ];

  for (const { name, items } of lists) {
    const seen = new Set<string>();
    for (const item of items) {
      const normalized = item.term.trim().toLowerCase();
      if (seen.has(normalized)) {
        return {
          name: 'no_duplicate_terms',
          passed: false,
          message: `Duplicate term in ${name}: "${item.term}"`,
        };
      }
      seen.add(normalized);
    }
  }

  return { name: 'no_duplicate_terms', passed: true, message: 'No duplicates within lists' };
}

export function checkValidLevels(output: ExtractionOutput): CheckResult {
  const allTerms = [...output.phrases, ...output.polysemous, ...output.vocabulary];

  for (const item of allTerms) {
    if (!VALID_CEFR_LEVELS.has(item.level)) {
      return {
        name: 'valid_levels',
        passed: false,
        message: `Invalid CEFR level "${item.level}" for term "${item.term}"`,
      };
    }
  }

  return { name: 'valid_levels', passed: true, message: 'All levels valid' };
}

export function checkNoCrossListDuplicates(output: ExtractionOutput): CheckResult {
  const termToList = new Map<string, string>();

  const lists = [
    { name: 'phrases', items: output.phrases },
    { name: 'polysemous', items: output.polysemous },
    { name: 'vocabulary', items: output.vocabulary },
  ];

  for (const { name, items } of lists) {
    for (const item of items) {
      const normalized = item.term.trim().toLowerCase();
      const existing = termToList.get(normalized);
      if (existing) {
        return {
          name: 'no_cross_list_duplicates',
          passed: false,
          message: `Term "${item.term}" appears in both ${existing} and ${name}`,
        };
      }
      termToList.set(normalized, name);
    }
  }

  return { name: 'no_cross_list_duplicates', passed: true, message: 'No cross-list duplicates' };
}

// ---- Orchestration ----

export function runChecks(rawResponse: string): {
  checks: CheckResult[];
  allPassed: boolean;
  parsedOutput: ExtractionOutput | null;
} {
  const checks: CheckResult[] = [];

  // Step 1: Valid JSON
  const jsonCheck = checkValidJson(rawResponse);
  checks.push(jsonCheck);
  if (!jsonCheck.passed) {
    return { checks, allPassed: false, parsedOutput: null };
  }

  const parsed = JSON.parse(rawResponse) as unknown;

  // Step 2: Top-level schema
  const schemaCheck = checkTopLevelSchema(parsed);
  checks.push(schemaCheck);
  if (!schemaCheck.passed) {
    return { checks, allPassed: false, parsedOutput: null };
  }

  // Step 3: textFit valid
  const textFitCheck = checkTextFitValid(parsed);
  checks.push(textFitCheck);

  // Step 4: Term objects valid
  const termCheck = checkTermObjectsValid(parsed);
  checks.push(termCheck);
  if (!termCheck.passed) {
    return { checks, allPassed: false, parsedOutput: null };
  }

  // Parse into typed output
  const obj = parsed as Record<string, unknown>;
  const output: ExtractionOutput = {
    textFit: obj['textFit'] as TextFit,
    phrases: obj['phrases'] as ExtractedTerm[],
    polysemous: obj['polysemous'] as ExtractedTerm[],
    vocabulary: obj['vocabulary'] as ExtractedTerm[],
  };

  // Step 5: No duplicate terms within lists
  const dupCheck = checkNoDuplicateTerms(output);
  checks.push(dupCheck);

  // Step 6: Valid CEFR levels
  const levelCheck = checkValidLevels(output);
  checks.push(levelCheck);

  // Step 7: No cross-list duplicates
  const crossCheck = checkNoCrossListDuplicates(output);
  checks.push(crossCheck);

  const allPassed = checks.every((c) => c.passed);

  return { checks, allPassed, parsedOutput: output };
}
