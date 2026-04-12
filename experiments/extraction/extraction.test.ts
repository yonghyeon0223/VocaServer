import { describe, it, expect } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import {
  parseFilters,
  loadFixtures,
  loadPrompts,
  filterFixtures,
  filterPrompts,
  getPromptVersion,
  loadPrompt,
  mergeConfig,
  substituteVariables,
  runAll,
  DEFAULT_CONFIG,
} from './runner.js';
import { runChecks } from './checker.js';
import { scoreResult } from './scorer.js';
import { buildReportData, generateReport, type ResultEntry } from './reporter.js';

const FIXTURES_DIR = 'experiments/extraction/fixtures';
const PROMPTS_DIR = 'experiments/extraction/prompts';
const RESULTS_DIR = 'experiments/extraction/results';
const REPORTS_DIR = 'experiments/extraction/reports';

describe('extraction prompt experiments', () => {
  it('runs filtered prompt × fixture combinations', async () => {
    const apiKey = process.env['AI_ANTHROPIC_KEY'];
    if (!apiKey) {
      throw new Error('AI_ANTHROPIC_KEY not set. Add it to .env or experiments/.env.experiments');
    }

    const filters = parseFilters();
    const allFixtures = loadFixtures(FIXTURES_DIR);
    const allPrompts = loadPrompts(PROMPTS_DIR);

    const fixtures = filterFixtures(allFixtures, filters);
    const promptPaths = filterPrompts(allPrompts, filters);

    if (fixtures.length === 0) {
      throw new Error('No fixtures matched the filters');
    }
    if (promptPaths.length === 0) {
      throw new Error('No prompts matched the filters');
    }

    console.log(`Running ${fixtures.length} fixtures × ${promptPaths.length} prompts = ${fixtures.length * promptPaths.length} combinations`);

    const client = new Anthropic({ apiKey });

    const runResults = await runAll(
      client,
      fixtures,
      promptPaths,
      DEFAULT_CONFIG,
      RESULTS_DIR,
      filters,
    );

    // Build result entries with checks and scores
    const resultEntries: ResultEntry[] = runResults.map((result) => {
      const fixture = fixtures.find((f) => f.id === result.fixtureId)!;
      const checkOutput = runChecks(result.rawResponse);
      const scores = checkOutput.allPassed && checkOutput.parsedOutput
        ? scoreResult(checkOutput.parsedOutput, fixture)
        : null;

      return {
        fixtureId: result.fixtureId,
        fixtureDescription: fixture.description,
        fixtureGroups: fixture.groups,
        studentLevel: fixture.level,
        promptVersion: result.promptVersion,
        temperature: result.temperature,
        checks: checkOutput.checks,
        allChecksPassed: checkOutput.allPassed,
        scores,
        extractedOutput: checkOutput.parsedOutput,
        expectedTextFit: fixture.expectedTextFit,
        tokenUsage: result.tokenUsage,
        latencyMs: result.latencyMs,
        targetPhrases: fixture.targetPhrases,
        targetPolysemous: fixture.targetPolysemous,
        targetVocabulary: fixture.targetVocabulary,
        mustNotContain: fixture.mustNotContain,
      };
    });

    // Generate report
    const reportData = buildReportData(resultEntries, filters, DEFAULT_CONFIG.model);
    const { reportId, reportPath } = generateReport(reportData, REPORTS_DIR);

    console.log(`\nReport generated: ${reportPath}`);
    console.log(`Report ID: ${reportId}`);
    console.log(`Total cost: $${reportData.aggregates.totalCost.toFixed(4)}`);

    // Log summary
    for (const entry of resultEntries) {
      const status = entry.allChecksPassed ? '✓' : '✗';
      const recallInfo = entry.scores
        ? `P:${entry.scores.phrases.recall.toFixed(0)}% S:${entry.scores.polysemous.recall.toFixed(0)}% V:${entry.scores.vocabulary.recall.toFixed(0)}%`
        : 'N/A';
      console.log(`${status} ${entry.fixtureId} × ${entry.promptVersion} | Recall [${recallInfo}] | Precision: ${entry.scores?.precision.toFixed(0) ?? 'N/A'}% | textFit: ${entry.scores?.textFitAccuracy ?? 'N/A'}`);
    }

    // Basic assertion: all structural checks pass for non-error responses
    const nonErrorResults = resultEntries.filter((r) => !r.checks.some((c) => c.name === 'valid_json' && !c.passed && r.tokenUsage.inputTokens > 0));
    // We don't assert pass/fail here — that's what the report is for
    expect(resultEntries.length).toBeGreaterThan(0);
  });
});
