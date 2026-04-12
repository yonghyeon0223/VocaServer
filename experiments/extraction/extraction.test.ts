import { describe, it, expect } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import {
  parseFilters,
  loadFixtures,
  filterFixtures,
  DEFAULT_CONFIG,
  type RunResult,
} from './runner.js';
import { runParallel } from './parallel-runner.js';
import { runChecks } from './checker.js';
import { scoreResult } from './scorer.js';
import { buildReportData, generateReport, estimateCost, type ResultEntry } from './reporter.js';

const FIXTURES_DIR = 'experiments/extraction/fixtures';
const RESULTS_DIR = 'experiments/extraction/results';
const REPORTS_DIR = 'experiments/extraction/reports';

describe('extraction prompt experiments (parallel)', () => {
  it('runs filtered fixtures with parallel 3-call architecture', async () => {
    const apiKey = process.env['AI_ANTHROPIC_KEY'];
    if (!apiKey) {
      throw new Error('AI_ANTHROPIC_KEY not set. Add it to .env or experiments/.env.experiments');
    }

    const filters = parseFilters();
    const allFixtures = loadFixtures(FIXTURES_DIR);
    const fixtures = filterFixtures(allFixtures, filters);

    if (fixtures.length === 0) {
      throw new Error('No fixtures matched the filters');
    }

    console.log(`Running ${fixtures.length} fixtures with parallel 3-call architecture`);

    const client = new Anthropic({ apiKey });
    const config = DEFAULT_CONFIG;

    if (!existsSync(RESULTS_DIR)) {
      mkdirSync(RESULTS_DIR, { recursive: true });
    }

    const resultEntries: ResultEntry[] = [];

    for (const fixture of fixtures) {
      console.log(`  → ${fixture.id} (${fixture.level} student)...`);

      try {
        const parallelResult = await runParallel(
          client,
          fixture.passage,
          fixture.level,
          config,
        );

        // Save raw result
        const resultFile = join(RESULTS_DIR, `${fixture.id}_parallel_${Date.now()}.json`);
        writeFileSync(resultFile, JSON.stringify({
          fixtureId: fixture.id,
          rawResponse: parallelResult.rawResponse,
          tokenUsage: parallelResult.tokenUsage,
          latencyMs: parallelResult.latencyMs,
          perCallStats: parallelResult.perCallStats,
          timestamp: new Date().toISOString(),
        }, null, 2), 'utf-8');

        // Check + score
        const checkOutput = runChecks(parallelResult.rawResponse);
        const scores = checkOutput.allPassed && checkOutput.parsedOutput
          ? scoreResult(checkOutput.parsedOutput, fixture)
          : null;

        resultEntries.push({
          fixtureId: fixture.id,
          fixtureDescription: fixture.description,
          fixtureGroups: fixture.groups,
          studentLevel: fixture.level,
          promptVersion: 'parallel-v1',
          temperature: config.temperature,
          checks: checkOutput.checks,
          allChecksPassed: checkOutput.allPassed,
          scores,
          extractedOutput: checkOutput.parsedOutput,
          expectedTextFit: fixture.expectedTextFit,
          tokenUsage: parallelResult.tokenUsage,
          latencyMs: parallelResult.latencyMs,
          targetPhrases: fixture.targetPhrases,
          targetPolysemous: fixture.targetPolysemous,
          targetVocabulary: fixture.targetVocabulary,
          mustNotContain: fixture.mustNotContain,
        });

        const s = scores;
        const recallInfo = s
          ? `P:${s.phrases.recall.toFixed(0)}% S:${s.polysemous.recall.toFixed(0)}% V:${s.vocabulary.recall.toFixed(0)}%`
          : 'FAILED';
        console.log(`    ${checkOutput.allPassed ? '✓' : '✗'} Recall [${recallInfo}] | ${parallelResult.latencyMs}ms | $${estimateCost(parallelResult.tokenUsage.inputTokens, parallelResult.tokenUsage.outputTokens).toFixed(4)}`);

      } catch (err) {
        console.log(`    ✗ ERROR: ${err instanceof Error ? err.message : String(err)}`);

        resultEntries.push({
          fixtureId: fixture.id,
          fixtureDescription: fixture.description,
          fixtureGroups: fixture.groups,
          studentLevel: fixture.level,
          promptVersion: 'parallel-v1',
          temperature: config.temperature,
          checks: [{ name: 'api_call', passed: false, message: String(err) }],
          allChecksPassed: false,
          scores: null,
          extractedOutput: null,
          expectedTextFit: fixture.expectedTextFit,
          tokenUsage: { inputTokens: 0, outputTokens: 0 },
          latencyMs: 0,
          targetPhrases: fixture.targetPhrases,
          targetPolysemous: fixture.targetPolysemous,
          targetVocabulary: fixture.targetVocabulary,
          mustNotContain: fixture.mustNotContain,
        });

        if (filters.failFast) break;
      }
    }

    // Generate report
    const reportData = buildReportData(resultEntries, filters, `${config.model} (parallel 3-call)`);
    const { reportId, reportPath } = generateReport(reportData, REPORTS_DIR);

    console.log(`\nReport generated: ${reportPath}`);
    console.log(`Report ID: ${reportId}`);
    console.log(`Total cost: $${reportData.aggregates.totalCost.toFixed(4)}`);
    if (reportData.overallScores) {
      console.log(`Overall Recall: ${reportData.overallScores.recall.toFixed(1)}%`);
      console.log(`Overall Accuracy: ${reportData.overallScores.accuracy.toFixed(1)}%`);
      console.log(reportData.overallScores.interpretation);
    }

    expect(resultEntries.length).toBeGreaterThan(0);
  });
});
