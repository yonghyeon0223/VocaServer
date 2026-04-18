// Main entry point for word introduction experiments.
//
// Usage:
//   npx tsx experiments/introduction-v1/main.ts
//
// Environment variables:
//   PROMPT_VERSION  — prompt version to use (default: v1)
//   TERMS           — comma-separated term IDs (e.g., term-01,term-06)
//   WORDS           — comma-separated words (e.g., "cat,give up,counterintuitive")
//   LEVEL           — filter by CEFR level (e.g., B2)
//   IMPORTANCE      — filter by importance (e.g., 4)
//
// Examples:
//   # Run batch 1 (breadth test)
//   WORDS="cat,give up,end up in,bounced back,counterintuitive" npx tsx experiments/introduction-v1/main.ts
//
//   # Run all A1 terms
//   LEVEL=A1 npx tsx experiments/introduction-v1/main.ts
//
//   # Run all importance 0 terms
//   IMPORTANCE=0 npx tsx experiments/introduction-v1/main.ts
//
//   # Run specific terms by ID
//   TERMS=term-01,term-04,term-06 npx tsx experiments/introduction-v1/main.ts

import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';
import { loadFixtures, filterFixtures, parseFilters, runAll } from './runner.js';
import { buildReportData, generateReport } from './reporter.js';

// Load .env from experiment directory
config({ path: join(dirname(fileURLToPath(import.meta.url)), '.env') });

async function main() {
  const filters = parseFilters();
  const allFixtures = loadFixtures();
  const fixtures = filterFixtures(allFixtures, filters);

  if (fixtures.length === 0) {
    console.error('\n  No fixtures matched the filters.');
    console.error(`  Total fixtures available: ${allFixtures.length}`);
    console.error(`  Filters: ${JSON.stringify(filters, null, 2)}`);
    process.exit(1);
  }

  console.log(`\n  Word Introduction Experiment`);
  console.log(`  ─────────────────────────────`);
  console.log(`  Prompt: ${filters.promptVersion}`);
  console.log(`  Terms:  ${fixtures.length} / ${allFixtures.length}`);
  console.log(`  Words:  ${fixtures.map((f) => f.word).join(', ')}`);
  console.log();

  const client = new Anthropic();
  const results = await runAll(client, fixtures, filters);

  // Build and generate report
  const reportData = buildReportData(results);
  const { reportId, reportPath } = generateReport(reportData);

  // Summary
  const passed = results.filter((r) => r.structuralChecks.every((c) => c.passed)).length;
  const totalCost = reportData.aggregates.totalCost;

  console.log(`\n  ─────────────────────────────`);
  console.log(`  Results: ${passed}/${results.length} terms passed all checks`);
  console.log(`  Cost:    $${totalCost.toFixed(4)}`);
  console.log(`  Report:  ${reportPath}`);
  console.log(`  ID:      ${reportId}`);
  console.log();
  console.log(`  Start feedback server: npx tsx experiments/introduction-v1/feedback-server.ts`);
  console.log();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
