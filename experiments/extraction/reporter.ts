import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import type { RunResult, RunFilters, CefrLevel, Fixture } from './runner.js';
import type { CheckResult, ExtractionOutput } from './checker.js';
import type { ScoreResult } from './scorer.js';

// ---- Types ----

export interface ResultEntry {
  fixtureId: string;
  fixtureDescription: string;
  fixtureGroups: string[];
  studentLevel: CefrLevel;
  promptVersion: string;
  temperature: number;
  checks: CheckResult[];
  allChecksPassed: boolean;
  scores: ScoreResult | null;
  extractedOutput: ExtractionOutput | null;
  expectedTextFit: string;
  tokenUsage: { inputTokens: number; outputTokens: number };
  latencyMs: number;
}

export interface ReportData {
  reportId: string;
  timestamp: string;
  model: string;
  filtersApplied: RunFilters;
  results: ResultEntry[];
  aggregates: {
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCost: number;
    perPrompt: Record<string, {
      totalInputTokens: number;
      totalOutputTokens: number;
      totalCost: number;
      callCount: number;
    }>;
  };
}

// ---- Cost Estimation ----

// Haiku 4.5 pricing (as of 2025)
const INPUT_COST_PER_M = 0.80;  // $/M input tokens
const OUTPUT_COST_PER_M = 4.00; // $/M output tokens

export function estimateCost(inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1_000_000) * INPUT_COST_PER_M
    + (outputTokens / 1_000_000) * OUTPUT_COST_PER_M;
}

// ---- Report ID ----

export function generateReportId(): string {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `report-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

// ---- Build Report Data ----

export function buildReportData(
  results: ResultEntry[],
  filters: RunFilters,
  model: string,
): ReportData {
  const reportId = generateReportId();
  const timestamp = new Date().toISOString();

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const perPrompt: ReportData['aggregates']['perPrompt'] = {};

  for (const r of results) {
    totalInputTokens += r.tokenUsage.inputTokens;
    totalOutputTokens += r.tokenUsage.outputTokens;

    if (!perPrompt[r.promptVersion]) {
      perPrompt[r.promptVersion] = {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCost: 0,
        callCount: 0,
      };
    }
    const p = perPrompt[r.promptVersion]!;
    p.totalInputTokens += r.tokenUsage.inputTokens;
    p.totalOutputTokens += r.tokenUsage.outputTokens;
    p.totalCost += estimateCost(r.tokenUsage.inputTokens, r.tokenUsage.outputTokens);
    p.callCount++;
  }

  return {
    reportId,
    timestamp,
    model,
    filtersApplied: filters,
    results,
    aggregates: {
      totalInputTokens,
      totalOutputTokens,
      totalCost: estimateCost(totalInputTokens, totalOutputTokens),
      perPrompt,
    },
  };
}

// ---- HTML Generation ----

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderListScore(name: string, score: { recall: number; levelAccuracy: number; details: { targetTermsFound: string[]; targetTermsMissed: string[]; levelMismatches: Array<{ term: string; expectedLevel: string; actualLevel: string }> } }): string {
  const recallColor = score.recall >= 80 ? '#2d7d2d' : score.recall >= 50 ? '#b8860b' : '#c00';
  const levelColor = score.levelAccuracy >= 80 ? '#2d7d2d' : score.levelAccuracy >= 50 ? '#b8860b' : '#c00';

  let html = `<div class="list-score">
    <h4>${escapeHtml(name)}</h4>
    <div class="metrics">
      <span style="color:${recallColor}">Recall: ${score.recall.toFixed(1)}%</span>
      <span style="color:${levelColor}">Level Acc: ${score.levelAccuracy.toFixed(1)}%</span>
    </div>`;

  if (score.details.targetTermsFound.length > 0) {
    html += `<div class="found">Found: ${score.details.targetTermsFound.map((t) => `<span class="tag found">${escapeHtml(t)}</span>`).join(' ')}</div>`;
  }
  if (score.details.targetTermsMissed.length > 0) {
    html += `<div class="missed">Missed: ${score.details.targetTermsMissed.map((t) => `<span class="tag missed">${escapeHtml(t)}</span>`).join(' ')}</div>`;
  }
  if (score.details.levelMismatches.length > 0) {
    html += `<div class="mismatches">Level mismatches: ${score.details.levelMismatches.map((m) => `<span class="tag mismatch">${escapeHtml(m.term)} (expected ${m.expectedLevel}, got ${m.actualLevel})</span>`).join(' ')}</div>`;
  }

  html += `</div>`;
  return html;
}

export function generateReport(
  data: ReportData,
  reportsDir: string,
): { reportId: string; reportPath: string } {
  if (!existsSync(reportsDir)) {
    mkdirSync(reportsDir, { recursive: true });
  }

  const reportPath = join(reportsDir, `${data.reportId}.html`);

  let resultsHtml = '';

  for (const r of data.results) {
    const fitMatch = r.scores ? (r.scores.textFitAccuracy === 100 ? '✓' : r.scores.textFitAccuracy === 50 ? '~' : '✗') : '—';
    const fitColor = fitMatch === '✓' ? '#2d7d2d' : fitMatch === '~' ? '#b8860b' : '#c00';

    resultsHtml += `<div class="result">
      <div class="result-header">
        <strong>${escapeHtml(r.fixtureId)}</strong> × <strong>${escapeHtml(r.promptVersion)}</strong>
        | Student: ${r.studentLevel}
        | <span style="color:${fitColor}">textFit: ${fitMatch}</span>
        ${r.extractedOutput ? `(AI: ${r.extractedOutput.textFit}, expected: ${r.expectedTextFit})` : ''}
        | ${r.tokenUsage.inputTokens}/${r.tokenUsage.outputTokens} tokens
        | ${r.latencyMs}ms
        | $${estimateCost(r.tokenUsage.inputTokens, r.tokenUsage.outputTokens).toFixed(4)}
      </div>`;

    if (!r.allChecksPassed) {
      const failedChecks = r.checks.filter((c) => !c.passed);
      resultsHtml += `<div class="checks-failed">
        Structural checks failed: ${failedChecks.map((c) => `<span class="tag missed">${escapeHtml(c.name)}: ${escapeHtml(c.message)}</span>`).join(' ')}
      </div>`;
    } else if (r.scores) {
      resultsHtml += `<div class="scores">
        <div class="precision">Precision: ${r.scores.precision.toFixed(1)}%${r.scores.mustNotContainViolations.length > 0 ? ` — violations: ${r.scores.mustNotContainViolations.map((v) => `<span class="tag missed">${escapeHtml(v)}</span>`).join(' ')}` : ''}</div>
        <div class="lists-grid">
          ${renderListScore('Phrases', r.scores.phrases)}
          ${renderListScore('Polysemous', r.scores.polysemous)}
          ${renderListScore('Vocabulary', r.scores.vocabulary)}
        </div>`;

      if (r.scores.unmatchedReport.extractedButNotInTargets.length > 0) {
        resultsHtml += `<div class="unmatched">
          Extracted but not in targets: ${r.scores.unmatchedReport.extractedButNotInTargets.map((t) => `<span class="tag unmatched">${escapeHtml(t.term)} (${t.level}, ${t.list})</span>`).join(' ')}
        </div>`;
      }

      resultsHtml += `</div>`;
    }

    resultsHtml += `<div class="description">${escapeHtml(r.fixtureDescription)}</div>`;
    resultsHtml += `</div>`;
  }

  // Aggregate section
  let aggregateHtml = `<div class="aggregates">
    <h3>Token Usage & Cost</h3>
    <p>Total: ${data.aggregates.totalInputTokens} input + ${data.aggregates.totalOutputTokens} output = $${data.aggregates.totalCost.toFixed(4)}</p>
    <table>
      <tr><th>Prompt</th><th>Calls</th><th>Input</th><th>Output</th><th>Cost</th></tr>`;

  for (const [version, stats] of Object.entries(data.aggregates.perPrompt)) {
    aggregateHtml += `<tr>
      <td>${escapeHtml(version)}</td>
      <td>${stats.callCount}</td>
      <td>${stats.totalInputTokens}</td>
      <td>${stats.totalOutputTokens}</td>
      <td>$${stats.totalCost.toFixed(4)}</td>
    </tr>`;
  }
  aggregateHtml += `</table></div>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Extraction Experiment Report — ${data.reportId}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; background: #f8f9fa; color: #333; }
  h1 { border-bottom: 2px solid #333; padding-bottom: 10px; }
  .meta { color: #666; margin-bottom: 20px; }
  .result { background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 16px; margin-bottom: 12px; }
  .result-header { font-size: 14px; margin-bottom: 8px; }
  .checks-failed { background: #fee; padding: 8px; border-radius: 4px; margin: 8px 0; }
  .scores { margin: 8px 0; }
  .lists-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin: 8px 0; }
  .list-score { background: #f5f5f5; padding: 10px; border-radius: 4px; }
  .list-score h4 { margin: 0 0 6px; }
  .metrics span { margin-right: 12px; font-weight: bold; }
  .tag { display: inline-block; padding: 2px 6px; border-radius: 3px; font-size: 12px; margin: 2px; }
  .tag.found { background: #d4edda; color: #155724; }
  .tag.missed { background: #f8d7da; color: #721c24; }
  .tag.mismatch { background: #fff3cd; color: #856404; }
  .tag.unmatched { background: #e2e3e5; color: #383d41; }
  .unmatched { margin-top: 8px; font-size: 13px; }
  .precision { margin-bottom: 8px; }
  .description { font-size: 12px; color: #888; margin-top: 8px; font-style: italic; }
  .aggregates { background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 16px; margin-top: 20px; }
  .aggregates table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  .aggregates th, .aggregates td { border: 1px solid #ddd; padding: 6px 10px; text-align: left; }
  .aggregates th { background: #f5f5f5; }
</style>
</head>
<body>
<h1>Extraction Experiment Report</h1>
<div class="meta">
  <p>Report: ${escapeHtml(data.reportId)} | Generated: ${escapeHtml(data.timestamp)} | Model: ${escapeHtml(data.model)}</p>
  <p>Filters: ${data.filtersApplied.fixtureIds ? `fixture=${data.filtersApplied.fixtureIds.join(',')}` : data.filtersApplied.groups ? `group=${data.filtersApplied.groups.join(',')}` : 'default'} ${data.filtersApplied.promptVersion ? `| prompt=${data.filtersApplied.promptVersion}` : '| all prompts'}</p>
  <p>Results: ${data.results.length} | Passed: ${data.results.filter((r) => r.allChecksPassed).length} | Failed: ${data.results.filter((r) => !r.allChecksPassed).length}</p>
</div>
${resultsHtml}
${aggregateHtml}
</body>
</html>`;

  writeFileSync(reportPath, html, 'utf-8');

  return { reportId: data.reportId, reportPath };
}
