import { describe, it, expect } from 'vitest';
import { normalizePassage } from '../../../src/shared/passage-utils.js';

// ============================================================
// normalizePassage
// ============================================================

describe('normalizePassage', () => {
  // ---- Rejection cases ----

  describe('rejects prompt injection delimiters', () => {
    it('rejects ===SYSTEM===', () => {
      expect(() => normalizePassage('Hello ===SYSTEM=== world')).toThrow();
    });

    it('rejects ===USER===', () => {
      expect(() => normalizePassage('Some text ===USER=== more text')).toThrow();
    });

    it('rejects ===META===', () => {
      expect(() => normalizePassage('===META=== temperature=0')).toThrow();
    });

    it('rejects case-insensitive delimiters', () => {
      expect(() => normalizePassage('===system===')).toThrow();
      expect(() => normalizePassage('===System===')).toThrow();
    });

    it('rejects partial delimiters (prefix)', () => {
      expect(() => normalizePassage('===SYSTEM')).toThrow();
      expect(() => normalizePassage('===USER')).toThrow();
      expect(() => normalizePassage('===META')).toThrow();
    });
  });

  describe('rejects empty and oversized input', () => {
    it('rejects empty string', () => {
      expect(() => normalizePassage('')).toThrow();
    });

    it('rejects whitespace-only string', () => {
      expect(() => normalizePassage('   \n\t  ')).toThrow();
    });

    it('rejects input exceeding max length', () => {
      const longText = 'a'.repeat(50001);
      expect(() => normalizePassage(longText)).toThrow();
    });
  });

  // ---- Normalization cases ----

  describe('normalizes whitespace', () => {
    it('collapses multiple spaces', () => {
      expect(normalizePassage('The  cat   sat')).toBe('The cat sat');
    });

    it('converts tabs to spaces', () => {
      expect(normalizePassage('The\tcat\tsat')).toBe('The cat sat');
    });

    it('trims leading and trailing whitespace', () => {
      expect(normalizePassage('  Hello world  ')).toBe('Hello world');
    });

    it('collapses multiple newlines', () => {
      expect(normalizePassage('Paragraph one.\n\n\nParagraph two.')).toBe('Paragraph one.\nParagraph two.');
    });

    it('converts CRLF to LF', () => {
      expect(normalizePassage('Line one.\r\nLine two.')).toBe('Line one.\nLine two.');
    });
  });

  describe('normalizes special characters', () => {
    it('converts smart quotes to straight quotes', () => {
      expect(normalizePassage('\u201CHello\u201D')).toBe('"Hello"');
      expect(normalizePassage('\u2018world\u2019')).toBe("'world'");
    });

    it('strips BOM marker', () => {
      expect(normalizePassage('\uFEFFHello')).toBe('Hello');
    });

    it('strips zero-width characters', () => {
      expect(normalizePassage('Hel\u200Blo')).toBe('Hello');
    });

    it('converts non-breaking spaces', () => {
      expect(normalizePassage('word\u00A0word')).toBe('word word');
    });
  });

  describe('passes through normal input', () => {
    it('returns normal passage unchanged', () => {
      expect(normalizePassage('The cat sat on the mat.')).toBe('The cat sat on the mat.');
    });
  });
});
