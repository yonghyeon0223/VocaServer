import { describe, it, expect } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { loadFixtures, filterFixtures, parseFilters, runAll, estimateCost } from './runner.js';
import { buildReportData, generateReport } from './reporter.js';

describe('extraction-v2 experiment', () => {
  it('runs fixtures and generates report', async () => {
    const apiKey = process.env['AI_ANTHROPIC_KEY'];
    if (!apiKey) {
      throw new Error('AI_ANTHROPIC_KEY not set. Add it to .env or set as environment variable.');
    }

    const filters = parseFilters();
    const allFixtures = loadFixtures();
    const fixtures = filterFixtures(allFixtures, filters);

    if (fixtures.length === 0) {
      throw new Error('No fixtures matched the filters');
    }

    console.log(`\nRunning ${fixtures.length} fixtures with prompt: ${filters.promptVersion}`);
    console.log(`Filters: ${filters.fixtureIds ? `fixtures=${filters.fixtureIds.join(',')}` : 'all'}${filters.category ? ` category=${filters.category}` : ''}\n`);

    const client = new Anthropic({ apiKey });
    const results = await runAll(client, fixtures, filters);

    // Build and generate report
    const reportData = buildReportData(results);
    const { reportId, reportPath } = generateReport(reportData);

    // Console summary
    const { aggregates } = reportData;
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Report: ${reportPath}`);
    console.log(`ID: ${reportId}`);
    console.log(`Fixtures: ${results.length} | Items: ${aggregates.totalItems} | Parse errors: ${aggregates.totalParseErrors}`);
    console.log(`Structural checks: ${aggregates.structuralChecksPassed}/${aggregates.structuralChecksTotal} passed`);
    console.log(`Tokens: ${aggregates.totalInputTokens} in / ${aggregates.totalOutputTokens} out`);
    console.log(`Cost: $${aggregates.totalCost.toFixed(4)}`);
    console.log(`${'='.repeat(60)}\n`);

    expect(results.length).toBeGreaterThan(0);
  }, 300000); // 5 minute timeout for full run
});
