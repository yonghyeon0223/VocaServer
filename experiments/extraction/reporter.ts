import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import type { RunResult, RunFilters, CefrLevel, Fixture } from './runner.js';
import type { CheckResult, ExtractionOutput, ExtractedTerm } from './checker.js';
import type { ScoreResult, ListScore } from './scorer.js';

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
  // Fixture target data for detailed rendering
  targetPhrases: Array<{term: string; expectedLevel: string}>;
  targetPolysemous: Array<{term: string; expectedLevel: string}>;
  targetVocabulary: Array<{term: string; expectedLevel: string}>;
  mustNotContain: string[];
}

export interface ReportData {
  reportId: string;
  timestamp: string;
  model: string;
  filtersApplied: RunFilters;
  results: ResultEntry[];
  overallScores: {
    recall: number;        // Average of fixture recalls
    accuracy: number;      // Average of fixture accuracies
    interpretation: string;
  } | null;
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

// ---- Score Interpretation ----

function interpretScores(recall: number, accuracy: number): string {
  if (recall >= 80 && accuracy >= 80) return '🟢 Great prompt — high recall and accurate extraction';
  if (recall >= 80 && accuracy >= 50) return '🟡 Good recall but levels/precision need work';
  if (recall >= 80 && accuracy < 50) return '🟠 Finds terms but wrong levels/categories — accuracy needs major improvement';
  if (recall >= 50 && accuracy >= 80) return '🟡 Conservative — misses terms but what it finds is accurate';
  if (recall >= 50 && accuracy >= 50) return '🟠 Needs improvement on both recall and accuracy';
  if (recall >= 50 && accuracy < 50) return '🔴 Below average — moderate recall with poor accuracy';
  return '🔴 Poor recall — major prompt revision needed';
}

// ---- Cost Estimation ----

const INPUT_COST_PER_M = 0.80;
const OUTPUT_COST_PER_M = 4.00;

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
      perPrompt[r.promptVersion] = { totalInputTokens: 0, totalOutputTokens: 0, totalCost: 0, callCount: 0 };
    }
    const p = perPrompt[r.promptVersion]!;
    p.totalInputTokens += r.tokenUsage.inputTokens;
    p.totalOutputTokens += r.tokenUsage.outputTokens;
    p.totalCost += estimateCost(r.tokenUsage.inputTokens, r.tokenUsage.outputTokens);
    p.callCount++;
  }

  // Compute overall scores from fixtures that have scores
  const scoredResults = results.filter((r) => r.scores !== null);
  let overallScores: ReportData['overallScores'] = null;

  if (scoredResults.length > 0) {
    const avgRecall = scoredResults.reduce((sum, r) => sum + r.scores!.fixtureRecall, 0) / scoredResults.length;
    const avgAccuracy = scoredResults.reduce((sum, r) => sum + r.scores!.fixtureAccuracy, 0) / scoredResults.length;
    overallScores = {
      recall: avgRecall,
      accuracy: avgAccuracy,
      interpretation: interpretScores(avgRecall, avgAccuracy),
    };
  }

  return {
    reportId, timestamp, model, filtersApplied: filters, results, overallScores,
    aggregates: { totalInputTokens, totalOutputTokens, totalCost: estimateCost(totalInputTokens, totalOutputTokens), perPrompt },
  };
}

// ---- HTML Helpers ----

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function badge(label: string, color: string, bg: string): string {
  return `<span class="badge" style="color:${color};background:${bg}">${esc(label)}</span>`;
}

function metricBox(label: string, value: string, color: string): string {
  return `<div class="metric-box"><div class="metric-value" style="color:${color}">${value}</div><div class="metric-label">${label}</div></div>`;
}

function pctColor(pct: number): string {
  if (pct >= 80) return '#16a34a';
  if (pct >= 50) return '#ca8a04';
  return '#dc2626';
}

function fitColor(score: number): string {
  if (score === 100) return '#16a34a';
  if (score === 50) return '#ca8a04';
  return '#dc2626';
}

function dropdown(id: string, title: string, content: string, defaultOpen = false): string {
  return `<details class="dropdown" ${defaultOpen ? 'open' : ''}><summary>${title}</summary><div class="dropdown-content">${content}</div></details>`;
}

function termTag(term: string, level: string, cls: string): string {
  return `<span class="term-tag ${cls}"><span class="term-text">${esc(term)}</span><span class="term-level">${esc(level)}</span></span>`;
}

function renderTermList(terms: ExtractedTerm[], targetTerms: string[], mustNotContain: Set<string>): string {
  if (terms.length === 0) return '<div class="empty-list">Empty</div>';
  return terms.map((t) => {
    const normalized = t.term.trim().toLowerCase();
    const isTarget = targetTerms.some((tt) => tt.trim().toLowerCase() === normalized);
    const isViolation = mustNotContain.has(normalized);
    const cls = isViolation ? 'violation' : isTarget ? 'matched' : 'extra';
    return termTag(t.term, t.level, cls);
  }).join(' ');
}

function renderCheckRow(check: CheckResult): string {
  const icon = check.passed ? '✓' : '✗';
  const cls = check.passed ? 'check-pass' : 'check-fail';
  return `<div class="check-row ${cls}"><span class="check-icon">${icon}</span><span class="check-name">${esc(check.name)}</span>${!check.passed ? `<span class="check-msg">${esc(check.message)}</span>` : ''}</div>`;
}

function renderListScoreCard(name: string, score: ListScore, extractedTerms: ExtractedTerm[], targetTerms: Array<{term: string; expectedLevel: string}>, mustNotContain: Set<string>): string {
  const targetStrings = targetTerms.map((t) => t.term);

  const foundHtml = score.details.targetTermsFound.length > 0
    ? score.details.targetTermsFound.map((t) => {
        const target = targetTerms.find((tt) => tt.term.trim().toLowerCase() === t.trim().toLowerCase());
        return termTag(t, target?.expectedLevel ?? '?', 'matched');
      }).join(' ')
    : '<span class="muted">None</span>';

  const missedHtml = score.details.targetTermsMissed.length > 0
    ? score.details.targetTermsMissed.map((t) => {
        const target = targetTerms.find((tt) => tt.term.trim().toLowerCase() === t.trim().toLowerCase());
        return termTag(t, target?.expectedLevel ?? '?', 'missed');
      }).join(' ')
    : '<span class="muted">None</span>';

  const mismatchHtml = score.details.levelMismatches.length > 0
    ? score.details.levelMismatches.map((m) =>
        `<div class="mismatch-row">${esc(m.term)}: expected <strong>${m.expectedLevel}</strong>, got <strong>${m.actualLevel}</strong></div>`
      ).join('')
    : '';

  return `<div class="list-card">
    <div class="list-card-header">${esc(name)}</div>
    <div class="list-metrics">
      ${metricBox('Recall', score.recall.toFixed(1) + '%', pctColor(score.recall))}
      ${metricBox('Level Acc', score.levelAccuracy.toFixed(1) + '%', pctColor(score.levelAccuracy))}
      ${metricBox('Found', score.details.targetTermsFound.length + '/' + (score.details.targetTermsFound.length + score.details.targetTermsMissed.length), pctColor(score.recall))}
    </div>
    ${dropdown(`found-${name}`, `Found (${score.details.targetTermsFound.length})`, foundHtml)}
    ${score.details.targetTermsMissed.length > 0 ? dropdown(`missed-${name}`, `<span class="text-red">Missed (${score.details.targetTermsMissed.length})</span>`, missedHtml, true) : ''}
    ${mismatchHtml ? dropdown(`mismatch-${name}`, `<span class="text-yellow">Level Mismatches (${score.details.levelMismatches.length})</span>`, mismatchHtml, true) : ''}
    ${dropdown(`raw-${name}`, `AI Output (${extractedTerms.length} terms)`, renderTermList(extractedTerms, targetStrings, mustNotContain))}
  </div>`;
}

// ---- HTML Generation ----

export function generateReport(
  data: ReportData,
  reportsDir: string,
): { reportId: string; reportPath: string } {
  if (!existsSync(reportsDir)) {
    mkdirSync(reportsDir, { recursive: true });
  }

  const reportPath = join(reportsDir, `${data.reportId}.html`);

  // Overall scores hero
  let overallHtml = '';
  if (data.overallScores) {
    const os = data.overallScores;
    overallHtml = `<div class="overall-scores">
      <div class="overall-grid">
        <div class="overall-card">
          <div class="overall-value" style="color:${pctColor(os.recall)}">${os.recall.toFixed(1)}%</div>
          <div class="overall-label">Overall Recall</div>
          <div class="overall-sub">avg(phrases + polysemous + vocabulary) / 3</div>
        </div>
        <div class="overall-card">
          <div class="overall-value" style="color:${pctColor(os.accuracy)}">${os.accuracy.toFixed(1)}%</div>
          <div class="overall-label">Overall Accuracy</div>
          <div class="overall-sub">50% level acc + 30% precision + 20% textFit</div>
        </div>
      </div>
      <div class="overall-interpretation">${os.interpretation}</div>
    </div>`;
  }

  // Summary table rows
  const summaryRows = data.results.map((r) => {
    const s = r.scores;
    const fitScore = s ? s.textFitAccuracy : -1;
    const fitDisplay = fitScore === 100 ? '✓ 100' : fitScore === 50 ? '~ 50' : fitScore === 0 ? '✗ 0' : '—';
    const fitCls = fitScore === 100 ? 'text-green' : fitScore === 50 ? 'text-yellow' : 'text-red';

    return `<tr>
      <td><a href="#result-${esc(r.fixtureId)}">${esc(r.fixtureId)}</a></td>
      <td>${esc(r.promptVersion)}</td>
      <td>${esc(r.studentLevel)}</td>
      <td class="${fitCls}">${fitDisplay}</td>
      <td style="color:${s ? pctColor(s.phrases.recall) : '#999'}">${s ? s.phrases.recall.toFixed(0) + '%' : '—'}</td>
      <td style="color:${s ? pctColor(s.polysemous.recall) : '#999'}">${s ? s.polysemous.recall.toFixed(0) + '%' : '—'}</td>
      <td style="color:${s ? pctColor(s.vocabulary.recall) : '#999'}">${s ? s.vocabulary.recall.toFixed(0) + '%' : '—'}</td>
      <td style="color:${s ? pctColor(s.precision) : '#999'}">${s ? s.precision.toFixed(0) + '%' : '—'}</td>
      <td style="color:${s ? pctColor(s.fixtureRecall) : '#999'}">${s ? s.fixtureRecall.toFixed(1) + '%' : '—'}</td>
      <td style="color:${s ? pctColor(s.fixtureAccuracy) : '#999'}">${s ? s.fixtureAccuracy.toFixed(1) + '%' : '—'}</td>
      <td>${r.tokenUsage.inputTokens}/${r.tokenUsage.outputTokens}</td>
      <td>${r.latencyMs}ms</td>
      <td>$${estimateCost(r.tokenUsage.inputTokens, r.tokenUsage.outputTokens).toFixed(4)}</td>
    </tr>`;
  }).join('');

  // Result detail cards
  const resultCards = data.results.map((r) => {
    const mustNotContainSet = new Set<string>(
      r.mustNotContain.map((t) => t.trim().toLowerCase())
    );

    // Structural checks
    const checksHtml = r.checks.map(renderCheckRow).join('');

    // textFit section
    let textFitHtml = '';
    if (r.extractedOutput) {
      const fitScore = r.scores?.textFitAccuracy ?? 0;
      textFitHtml = `<div class="textfit-section">
        <div class="textfit-row">
          ${metricBox('textFit Score', fitScore.toString(), fitColor(fitScore))}
          <div class="textfit-detail">
            <div>AI assessed: ${badge(r.extractedOutput.textFit, '#fff', fitScore === 100 ? '#16a34a' : fitScore === 50 ? '#ca8a04' : '#dc2626')}</div>
            <div>Expected: ${badge(r.expectedTextFit, '#fff', '#6b7280')}</div>
          </div>
        </div>
      </div>`;
    }

    // Per-list cards
    let listsHtml = '';
    if (r.scores && r.extractedOutput) {
      listsHtml = `<div class="lists-section">
        ${renderListScoreCard('Phrases', r.scores.phrases, r.extractedOutput.phrases, r.targetPhrases, mustNotContainSet)}
        ${renderListScoreCard('Polysemous', r.scores.polysemous, r.extractedOutput.polysemous, r.targetPolysemous, mustNotContainSet)}
        ${renderListScoreCard('Vocabulary', r.scores.vocabulary, r.extractedOutput.vocabulary, r.targetVocabulary, mustNotContainSet)}
      </div>`;
    }

    // Precision + violations
    let precisionHtml = '';
    if (r.scores) {
      const violationsContent = r.scores.mustNotContainViolations.length > 0
        ? r.scores.mustNotContainViolations.map((v) => termTag(v, '', 'violation')).join(' ')
        : '<span class="muted">None</span>';

      precisionHtml = `<div class="precision-section">
        ${metricBox('Global Precision', r.scores.precision.toFixed(1) + '%', pctColor(r.scores.precision))}
        ${dropdown('violations', `mustNotContain Violations (${r.scores.mustNotContainViolations.length})`, violationsContent, r.scores.mustNotContainViolations.length > 0)}
      </div>`;
    }

    // Unmatched terms
    let unmatchedHtml = '';
    if (r.scores && r.scores.unmatchedReport.extractedButNotInTargets.length > 0) {
      const items = r.scores.unmatchedReport.extractedButNotInTargets;
      const content = items.map((t) => termTag(t.term, `${t.level} · ${t.list}`, 'extra')).join(' ');
      unmatchedHtml = dropdown('unmatched', `<span class="text-blue">Extracted but not in targets (${items.length})</span>`, content, true);
    }

    return `<div class="result-card" id="result-${esc(r.fixtureId)}">
      <div class="card-header">
        <div class="card-title">
          <span class="fixture-id">${esc(r.fixtureId)}</span>
          <span class="prompt-version">${esc(r.promptVersion)}</span>
          ${badge(r.studentLevel, '#fff', '#4f46e5')}
          ${r.allChecksPassed ? badge('PASSED', '#fff', '#16a34a') : badge('FAILED', '#fff', '#dc2626')}
        </div>
        <div class="card-meta">
          ${r.tokenUsage.inputTokens}in / ${r.tokenUsage.outputTokens}out · ${r.latencyMs}ms · $${estimateCost(r.tokenUsage.inputTokens, r.tokenUsage.outputTokens).toFixed(4)}
        </div>
      </div>
      ${r.scores ? `<div class="fixture-scores">
        ${metricBox('Fixture Recall', r.scores.fixtureRecall.toFixed(1) + '%', pctColor(r.scores.fixtureRecall))}
        ${metricBox('Fixture Accuracy', r.scores.fixtureAccuracy.toFixed(1) + '%', pctColor(r.scores.fixtureAccuracy))}
      </div>` : ''}
      <div class="card-description">${esc(r.fixtureDescription)}</div>
      ${dropdown('checks-' + r.fixtureId, `Structural Checks (${r.checks.filter((c) => c.passed).length}/${r.checks.length} passed)`, checksHtml, !r.allChecksPassed)}
      ${textFitHtml}
      ${listsHtml}
      ${precisionHtml}
      ${unmatchedHtml}
    </div>`;
  }).join('');

  // Aggregates
  let aggregateRows = '';
  for (const [version, stats] of Object.entries(data.aggregates.perPrompt)) {
    aggregateRows += `<tr><td>${esc(version)}</td><td>${stats.callCount}</td><td>${stats.totalInputTokens}</td><td>${stats.totalOutputTokens}</td><td>$${stats.totalCost.toFixed(4)}</td></tr>`;
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Extraction Report — ${data.reportId}</title>
<style>
  :root { --bg: #f8fafc; --card: #fff; --border: #e2e8f0; --text: #1e293b; --muted: #94a3b8; --green: #16a34a; --red: #dc2626; --yellow: #ca8a04; --blue: #2563eb; --indigo: #4f46e5; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--text); padding: 24px; max-width: 1400px; margin: 0 auto; font-size: 14px; line-height: 1.5; }
  h1 { font-size: 24px; font-weight: 700; margin-bottom: 4px; }
  h2 { font-size: 18px; font-weight: 600; margin: 24px 0 12px; }
  .report-meta { color: var(--muted); margin-bottom: 24px; font-size: 13px; }
  .report-meta span { margin-right: 16px; }

  /* Summary Table */
  .summary-table { width: 100%; border-collapse: collapse; margin-bottom: 32px; background: var(--card); border-radius: 8px; overflow: hidden; border: 1px solid var(--border); }
  .summary-table th { background: #f1f5f9; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }
  .summary-table th, .summary-table td { padding: 8px 12px; text-align: left; border-bottom: 1px solid var(--border); font-size: 13px; }
  .summary-table tr:last-child td { border-bottom: none; }
  .summary-table a { color: var(--indigo); text-decoration: none; font-weight: 500; }
  .summary-table a:hover { text-decoration: underline; }

  /* Result Card */
  .result-card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 20px; margin-bottom: 16px; }
  .card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
  .card-title { display: flex; align-items: center; gap: 8px; }
  .fixture-id { font-weight: 700; font-size: 16px; }
  .prompt-version { color: var(--muted); font-size: 14px; }
  .card-meta { color: var(--muted); font-size: 12px; }
  .card-description { color: var(--muted); font-size: 12px; margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px solid var(--border); }

  /* Badge */
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; letter-spacing: 0.02em; }

  /* Metric Box */
  .metric-box { text-align: center; padding: 8px 16px; }
  .metric-value { font-size: 20px; font-weight: 700; }
  .metric-label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; margin-top: 2px; }

  /* Checks */
  .check-row { display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: 13px; }
  .check-icon { width: 20px; text-align: center; font-weight: 700; }
  .check-pass .check-icon { color: var(--green); }
  .check-fail .check-icon { color: var(--red); }
  .check-name { font-weight: 500; }
  .check-msg { color: var(--red); font-size: 12px; margin-left: 8px; }

  /* textFit */
  .textfit-section { margin: 12px 0; }
  .textfit-row { display: flex; align-items: center; gap: 24px; }
  .textfit-detail { font-size: 13px; line-height: 1.8; }

  /* Lists Section */
  .lists-section { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin: 12px 0; }
  .list-card { background: #f8fafc; border: 1px solid var(--border); border-radius: 8px; padding: 12px; }
  .list-card-header { font-weight: 700; font-size: 14px; margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px solid var(--border); }
  .list-metrics { display: flex; gap: 4px; margin-bottom: 8px; justify-content: center; }
  .list-metrics .metric-box { padding: 4px 8px; }
  .list-metrics .metric-value { font-size: 16px; }

  /* Precision */
  .precision-section { display: flex; align-items: center; gap: 16px; margin: 12px 0; padding: 12px; background: #f8fafc; border-radius: 8px; border: 1px solid var(--border); }

  /* Term Tags */
  .term-tag { display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; border-radius: 4px; font-size: 12px; margin: 2px; border: 1px solid transparent; }
  .term-text { font-weight: 500; }
  .term-level { font-size: 10px; opacity: 0.7; }
  .term-tag.matched { background: #dcfce7; color: #166534; border-color: #bbf7d0; }
  .term-tag.missed { background: #fee2e2; color: #991b1b; border-color: #fecaca; }
  .term-tag.violation { background: #fee2e2; color: #991b1b; border-color: #fca5a5; font-weight: 700; }
  .term-tag.extra { background: #f1f5f9; color: #475569; border-color: #e2e8f0; }
  .mismatch-row { font-size: 12px; padding: 2px 0; color: var(--yellow); }

  /* Dropdown */
  .dropdown { margin: 4px 0; }
  .dropdown summary { cursor: pointer; font-size: 13px; font-weight: 500; padding: 6px 0; color: var(--text); user-select: none; }
  .dropdown summary:hover { color: var(--indigo); }
  .dropdown-content { padding: 8px 0 4px 12px; }
  .empty-list { color: var(--muted); font-size: 12px; font-style: italic; }

  /* Aggregates */
  .aggregates { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 20px; margin-top: 24px; }
  .aggregates table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  .aggregates th { background: #f1f5f9; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }
  .aggregates th, .aggregates td { padding: 8px 12px; text-align: left; border-bottom: 1px solid var(--border); font-size: 13px; }

  /* Color utilities */
  .text-green { color: var(--green); }
  .text-red { color: var(--red); }
  .text-yellow { color: var(--yellow); }
  .text-blue { color: var(--blue); }
  .muted { color: var(--muted); }

  /* Metric Definitions */
  .metric-definitions { font-size: 13px; }
  .def-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .def-section h3 { font-size: 13px; font-weight: 700; margin-bottom: 8px; color: var(--indigo); }
  .def-section dl { margin: 0; }
  .def-section dt { font-weight: 600; margin-top: 6px; }
  .def-section dd { margin: 0 0 4px 0; color: #555; }
  .interp-table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 4px; }
  .interp-table th, .interp-table td { padding: 4px 8px; border: 1px solid var(--border); text-align: left; }
  .interp-table th { background: #f1f5f9; }

  /* Overall Scores Hero */
  .overall-scores { background: var(--card); border: 2px solid var(--indigo); border-radius: 12px; padding: 24px; margin-bottom: 24px; }
  .overall-grid { display: flex; justify-content: center; gap: 48px; margin-bottom: 16px; }
  .overall-card { text-align: center; }
  .overall-value { font-size: 36px; font-weight: 800; }
  .overall-label { font-size: 14px; font-weight: 600; margin-top: 4px; }
  .overall-sub { font-size: 11px; color: var(--muted); margin-top: 2px; }
  .overall-interpretation { text-align: center; font-size: 15px; font-weight: 500; padding: 12px; background: #f8fafc; border-radius: 8px; }

  /* Fixture scores in detail card */
  .fixture-scores { display: flex; gap: 16px; margin-bottom: 8px; padding: 8px 0; border-bottom: 1px solid var(--border); }

  @media (max-width: 900px) { .lists-section { grid-template-columns: 1fr; } .overall-grid { flex-direction: column; gap: 16px; } }
</style>
</head>
<body>
<h1>Extraction Experiment Report</h1>
<div class="report-meta">
  <span>${esc(data.reportId)}</span>
  <span>${esc(data.timestamp)}</span>
  <span>Model: ${esc(data.model)}</span>
  <span>Filters: ${data.filtersApplied.fixtureIds ? 'fixture=' + data.filtersApplied.fixtureIds.join(',') : data.filtersApplied.groups ? 'group=' + data.filtersApplied.groups.join(',') : 'default'}${data.filtersApplied.promptVersion ? ' · prompt=' + data.filtersApplied.promptVersion : ''}</span>
</div>

${overallHtml}
<h2>Summary</h2>
<table class="summary-table">
  <thead>
    <tr>
      <th>Fixture</th><th>Prompt</th><th>Level</th><th>textFit</th>
      <th>Phrases</th><th>Polysem.</th><th>Vocab</th><th>Precision</th>
      <th>Recall</th><th>Accuracy</th>
      <th>Tokens</th><th>Latency</th><th>Cost</th>
    </tr>
  </thead>
  <tbody>${summaryRows}</tbody>
</table>

<h2>Results</h2>
${resultCards}

<div class="aggregates">
  <h2>Metric Definitions</h2>
  <div class="metric-definitions">
    <div class="def-grid">
      <div class="def-section">
        <h3>Per-List Metrics (scored independently for phrases, polysemous, vocabulary)</h3>
        <dl>
          <dt>Recall</dt><dd>Of the terms we expected the AI to find in this list, what % did it actually extract? <strong>Primary metric.</strong></dd>
          <dt>Level Accuracy</dt><dd>Of the matched terms, what % had the exact correct CEFR level? Strict — no ±1 tolerance.</dd>
          <dt>Found / Missed</dt><dd>Which specific target terms were found vs missed by the AI.</dd>
          <dt>Level Mismatches</dt><dd>Terms found but assigned a different CEFR level than expected.</dd>
        </dl>
      </div>
      <div class="def-section">
        <h3>Cross-List Metrics</h3>
        <dl>
          <dt>Precision</dt><dd>Of all extracted terms across all lists, what % were NOT in the mustNotContain blocklist? Measures whether the AI avoids extracting function words, proper nouns, and below-range terms.</dd>
          <dt>textFit Accuracy</dt><dd>Did the AI correctly assess passage difficulty? 100 = exact match, 50 = off by 1 step, 0 = off by 2+ steps.</dd>
          <dt>Unmatched Terms</dt><dd>Terms the AI extracted that aren't in our target lists and aren't in mustNotContain. Not scored — listed for human review.</dd>
        </dl>
      </div>
      <div class="def-section">
        <h3>Composite Scores</h3>
        <dl>
          <dt>Fixture Recall</dt><dd>(phrases_recall + polysemous_recall + vocabulary_recall) / 3. Did the AI find what it should find?</dd>
          <dt>Fixture Accuracy</dt><dd>50% × avg_level_accuracy + 30% × precision + 20% × textFit. When the AI did extract, how correct was it?</dd>
          <dt>Overall Recall / Accuracy</dt><dd>Average across all fixtures in this report.</dd>
        </dl>
      </div>
      <div class="def-section">
        <h3>Interpretation</h3>
        <table class="interp-table">
          <tr><th>Recall</th><th>Accuracy</th><th>Meaning</th></tr>
          <tr><td>80%+</td><td>80%+</td><td>🟢 Great prompt</td></tr>
          <tr><td>80%+</td><td>50-80%</td><td>🟡 Good recall, levels/precision need work</td></tr>
          <tr><td>80%+</td><td>&lt;50%</td><td>🟠 Finds terms but wrong levels/categories</td></tr>
          <tr><td>50-80%</td><td>80%+</td><td>🟡 Conservative — misses terms but accurate</td></tr>
          <tr><td>50-80%</td><td>50-80%</td><td>🟠 Needs improvement on both</td></tr>
          <tr><td>&lt;50%</td><td>any</td><td>🔴 Poor recall — major revision needed</td></tr>
        </table>
      </div>
    </div>
  </div>
</div>

<div class="aggregates">
  <h2>Token Usage &amp; Cost</h2>
  <p style="color:var(--muted);margin-bottom:8px">Total: ${data.aggregates.totalInputTokens} in + ${data.aggregates.totalOutputTokens} out = $${data.aggregates.totalCost.toFixed(4)}</p>
  <table>
    <thead><tr><th>Prompt</th><th>Calls</th><th>Input</th><th>Output</th><th>Cost</th></tr></thead>
    <tbody>${aggregateRows}</tbody>
  </table>
</div>
</body>
</html>`;

  writeFileSync(reportPath, html, 'utf-8');
  return { reportId: data.reportId, reportPath };
}
