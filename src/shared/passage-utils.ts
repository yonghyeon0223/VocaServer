// ---- Constants ----

const MAX_PASSAGE_LENGTH = 50000;

const INJECTION_PATTERNS = [
  /===SYSTEM/i,
  /===USER/i,
  /===META/i,
];

// ---- normalizePassage ----

export function normalizePassage(input: string): string {
  // Check for prompt injection delimiters
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(input)) {
      throw new Error('Input contains forbidden delimiter pattern');
    }
  }

  // Strip BOM
  let text = input.replace(/^\uFEFF/, '');

  // Strip zero-width characters
  text = text.replace(/[\u200B\u200C\u200D\uFEFF]/g, '');

  // Convert smart quotes to straight
  text = text
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'");

  // Convert non-breaking spaces
  text = text.replace(/\u00A0/g, ' ');

  // Normalize line endings to LF
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Convert tabs to spaces
  text = text.replace(/\t/g, ' ');

  // Collapse multiple spaces (within lines)
  text = text.replace(/ {2,}/g, ' ');

  // Collapse multiple newlines (keep at most one)
  text = text.replace(/\n{2,}/g, '\n');

  // Trim
  text = text.trim();

  // Reject empty
  if (text.length === 0) {
    throw new Error('Input is empty after normalization');
  }

  // Reject oversized
  if (text.length > MAX_PASSAGE_LENGTH) {
    throw new Error(`Input exceeds maximum length of ${MAX_PASSAGE_LENGTH} characters`);
  }

  return text;
}
