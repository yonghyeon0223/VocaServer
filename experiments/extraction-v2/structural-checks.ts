// ---- Types ----

export interface StructuralCheck {
  name: string;
  passed: boolean;
  message: string;
}

export interface ExtractedItem {
  type: 'phrase' | 'vocabulary';
  term: string;
  definition: string;
  level: string;
  importance: number;
}

// ---- Constants ----

const VALID_CEFR_LEVELS = new Set(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);
const VALID_IMPORTANCE = new Set([0, 1, 2, 3, 4]);

// ---- Parsing ----

function parseTuple(arr: unknown, type: 'phrase' | 'vocabulary'): ExtractedItem | null {
  if (!Array.isArray(arr) || arr.length !== 4) return null;

  const term = typeof arr[0] === 'string' ? arr[0].trim() : '';
  const definition = typeof arr[1] === 'string' ? arr[1].trim() : '';
  const level = typeof arr[2] === 'string' ? arr[2].trim() : '';
  const importance = typeof arr[3] === 'number' ? arr[3] : NaN;

  if (!term || !Number.isFinite(importance)) return null;

  return { type, term, definition, level, importance };
}

export function parseResponse(rawResponse: string): {
  items: ExtractedItem[];
  phraseCount: number;
  vocabCount: number;
  parseErrors: string[];
} {
  const trimmed = rawResponse.trim();
  if (!trimmed) return { items: [], phraseCount: 0, vocabCount: 0, parseErrors: [] };

  const items: ExtractedItem[] = [];
  const parseErrors: string[] = [];
  let phraseCount = 0;
  let vocabCount = 0;

  try {
    const parsed = JSON.parse(trimmed) as { p?: unknown[]; v?: unknown[] };

    const rawPhrases = Array.isArray(parsed.p) ? parsed.p : [];
    const rawVocab = Array.isArray(parsed.v) ? parsed.v : [];

    const seen = new Set<string>();

    for (const raw of rawPhrases) {
      const item = parseTuple(raw, 'phrase');
      if (item) {
        const key = `${item.term.toLowerCase()}|||${item.definition.toLowerCase()}`;
        if (!seen.has(key)) {
          seen.add(key);
          items.push(item);
          phraseCount++;
        }
      } else {
        parseErrors.push(`phrase: ${JSON.stringify(raw).slice(0, 100)}`);
      }
    }

    for (const raw of rawVocab) {
      const item = parseTuple(raw, 'vocabulary');
      if (item) {
        const key = `${item.term.toLowerCase()}|||${item.definition.toLowerCase()}`;
        if (!seen.has(key)) {
          seen.add(key);
          items.push(item);
          vocabCount++;
        }
      } else {
        parseErrors.push(`vocab: ${JSON.stringify(raw).slice(0, 100)}`);
      }
    }
  } catch {
    parseErrors.push(`Failed to parse JSON: ${trimmed.slice(0, 100)}...`);
  }

  return { items, phraseCount, vocabCount, parseErrors };
}

// ---- Structural Checks ----

export function runStructuralChecks(
  items: ExtractedItem[],
  parseErrors: string[],
  category: string,
): StructuralCheck[] {
  const checks: StructuralCheck[] = [];

  // 1. JSON parse — all entries parsed successfully
  checks.push({
    name: 'json_parse',
    passed: parseErrors.length === 0,
    message: parseErrors.length === 0
      ? `All entries parsed (${items.length} items)`
      : `${parseErrors.length} entry(s) failed to parse: ${parseErrors.slice(0, 3).map((e) => `"${e.slice(0, 60)}"`).join(', ')}${parseErrors.length > 3 ? ` and ${parseErrors.length - 3} more` : ''}`,
  });

  // 2. Valid CEFR levels
  const invalidLevels = items.filter((i) => !VALID_CEFR_LEVELS.has(i.level));
  checks.push({
    name: 'valid_cefr',
    passed: invalidLevels.length === 0,
    message: invalidLevels.length === 0
      ? 'All CEFR levels valid'
      : `${invalidLevels.length} item(s) with invalid CEFR level: ${invalidLevels.slice(0, 3).map((i) => `"${i.term}" = "${i.level}"`).join(', ')}`,
  });

  // 3. Valid importance (1-4)
  const invalidImportance = items.filter((i) => !VALID_IMPORTANCE.has(i.importance));
  checks.push({
    name: 'valid_importance',
    passed: invalidImportance.length === 0,
    message: invalidImportance.length === 0
      ? 'All importance values valid (1-4)'
      : `${invalidImportance.length} item(s) with invalid importance: ${invalidImportance.slice(0, 3).map((i) => `"${i.term}" = ${i.importance}`).join(', ')}`,
  });

  // 4. Non-empty term
  const emptyTerms = items.filter((i) => i.term.length === 0);
  checks.push({
    name: 'non_empty_term',
    passed: emptyTerms.length === 0,
    message: emptyTerms.length === 0
      ? 'All terms non-empty'
      : `${emptyTerms.length} item(s) with empty term`,
  });

  // 5. Non-empty definitions
  const emptyDefs = items.filter((i) => i.definition.length === 0);
  checks.push({
    name: 'non_empty_definition',
    passed: emptyDefs.length === 0,
    message: emptyDefs.length === 0
      ? 'All definitions non-empty'
      : `${emptyDefs.length} item(s) with empty definition: ${emptyDefs.slice(0, 3).map((i) => `"${i.term}"`).join(', ')}`,
  });

  // 6. No duplicate (term, definition) pairs
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const item of items) {
    const key = `${item.term.toLowerCase()}|||${item.definition.toLowerCase()}`;
    if (seen.has(key)) {
      duplicates.push(item.term);
    }
    seen.add(key);
  }
  checks.push({
    name: 'no_duplicate_entries',
    passed: duplicates.length === 0,
    message: duplicates.length === 0
      ? 'No duplicate (term, definition) pairs'
      : `${duplicates.length} duplicate(s): ${duplicates.slice(0, 5).map((d) => `"${d}"`).join(', ')}`,
  });

  // 7. Empty for invalid input
  if (category === 'invalid') {
    checks.push({
      name: 'empty_for_invalid',
      passed: items.length <= 2,
      message: items.length <= 2
        ? `Appropriate: ${items.length} item(s) for invalid input`
        : `Unexpected: ${items.length} items extracted from invalid input`,
    });
  }

  // 8. Has output for content categories
  if (['normal', 'edge', 'tricky'].includes(category)) {
    checks.push({
      name: 'has_output',
      passed: items.length >= 1,
      message: items.length >= 1
        ? `${items.length} item(s) extracted`
        : 'No items extracted from non-empty input',
    });
  }

  return checks;
}
