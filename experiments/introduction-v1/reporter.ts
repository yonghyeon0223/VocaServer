import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import type { TermResult } from './runner.js';
import { estimateCost } from './runner.js';
import type { ParsedIntroduction } from './structural-checks.js';

// ---- Types ----

export interface ReportData {
  reportId: string;
  timestamp: string;
  model: string;
  promptVersion: string;
  results: TermResult[];
  aggregates: {
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCost: number;
    totalTerms: number;
    totalParseErrors: number;
    structuralChecksPassed: number;
    structuralChecksTotal: number;
    avgLatencyMs: number;
    avgExploreTurns: number;
  };
}

// ---- Report ID ----

export function generateReportId(): string {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `report-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

// ---- Build Report Data ----

export function buildReportData(results: TermResult[]): ReportData {
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalParseErrors = 0;
  let structuralChecksPassed = 0;
  let structuralChecksTotal = 0;
  let totalLatency = 0;
  let totalExploreTurns = 0;
  let parsedCount = 0;

  for (const r of results) {
    totalInputTokens += r.tokenUsage.inputTokens;
    totalOutputTokens += r.tokenUsage.outputTokens;
    totalParseErrors += r.parseErrors.length;
    totalLatency += r.latencyMs;
    if (r.parsed) {
      totalExploreTurns += r.parsed.explore.length;
      parsedCount++;
    }
    for (const check of r.structuralChecks) {
      structuralChecksTotal++;
      if (check.passed) structuralChecksPassed++;
    }
  }

  return {
    reportId: generateReportId(),
    timestamp: new Date().toISOString(),
    model: results[0]?.model ?? 'unknown',
    promptVersion: results[0]?.promptVersion ?? 'unknown',
    results,
    aggregates: {
      totalInputTokens,
      totalOutputTokens,
      totalCost: results.reduce((sum, r) => sum + estimateCost(r.tokenUsage.inputTokens, r.tokenUsage.outputTokens, r.tokenUsage.cacheRead, r.tokenUsage.cacheCreation), 0),
      totalTerms: results.length,
      totalParseErrors,
      structuralChecksPassed,
      structuralChecksTotal,
      avgLatencyMs: results.length > 0 ? Math.round(totalLatency / results.length) : 0,
      avgExploreTurns: parsedCount > 0 ? Math.round((totalExploreTurns / parsedCount) * 10) / 10 : 0,
    },
  };
}

// ---- HTML Helpers ----

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function escJson(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function levelBg(level: string): string {
  switch (level) {
    case 'A1': return '#dcfce7';
    case 'A2': return '#bbf7d0';
    case 'B1': return '#fef9c3';
    case 'B2': return '#fde68a';
    case 'C1': return '#fecaca';
    case 'C2': return '#fca5a5';
    default: return '#f1f5f9';
  }
}

const TYPE_LABELS: Record<string, string> = {
  AR: '행동·결과 예측',
  CP: '비교',
  CR: '원인 추론',
  SC: '문장 완성',
  OP: '반대 상황',
  CX: '맥락 전환',
  PD: '다의어 구분',
  CL: '콜로케이션',
  IN: '강도 배치',
  MU: '오용 판별',
  MF: '형태 변환',
  WD: '구성 요소 분해',
};

// ---- Render Interactive Term Card ----

function renderTermCard(result: TermResult, index: number): string {
  const cost = estimateCost(result.tokenUsage.inputTokens, result.tokenUsage.outputTokens, result.tokenUsage.cacheRead, result.tokenUsage.cacheCreation);
  const passedChecks = result.structuralChecks.filter((c) => c.passed).length;
  const totalChecks = result.structuralChecks.length;
  const exploreTurns = result.parsed ? result.parsed.explore.length : 0;
  const termId = esc(result.termId);

  let html = `
    <div class="term-card" id="card-${termId}">
      <details${index < 5 ? ' open' : ''}>
        <summary class="term-header">
          <span class="term-word">${esc(result.word)}</span>
          <span class="level-badge" style="background:${levelBg(result.level)}">${esc(result.level)}</span>
          <span class="imp-badge">imp ${result.importance}</span>
          <span class="type-badge">${result.termType === 'phrase' ? 'phrase' : 'vocab'}</span>
          <span class="term-def">${esc(result.definition)}</span>
          <span class="term-stats">
            <span class="stat-turns">${exploreTurns}t</span>
            <span class="stat-checks ${passedChecks === totalChecks ? 'all-pass' : 'has-fail'}">${passedChecks}/${totalChecks}</span>
            <span class="stat-cost">$${cost.toFixed(4)}</span>
          </span>
        </summary>
        <div class="term-body">`;

  // Structural checks bar
  html += `<div class="checks-bar">`;
  for (const check of result.structuralChecks) {
    const cls = check.passed ? 'ck-pass' : 'ck-fail';
    html += `<span class="${cls}" title="${esc(check.message)}">${check.passed ? '✓' : '✗'} ${esc(check.name)}</span>`;
  }
  html += `</div>`;

  if (!result.parsed) {
    html += `<div class="error-box">Parse failed. Raw response:<pre>${esc(result.rawResponse.slice(0, 2000))}</pre></div>`;
  } else {
    const p = result.parsed;


    // Interactive intro turn
    html += `<div class="turn-section">
      <h4 class="turn-title">소개</h4>
      <div class="scene-text">${esc(p.intro.scene)}</div>
      <div class="question-text">${esc(p.intro.question)}</div>
      <div class="options-container" data-term="${termId}" data-turn="intro">`;

    for (let oi = 0; oi < p.intro.options.length; oi++) {
      const opt = p.intro.options[oi];
      html += `<button class="option-btn intro-btn" onclick="selectOption(this, '${termId}', 'intro', ${oi})">
        <span class="option-num">${oi + 1}</span>
        <span class="option-text">${esc(opt.text)}</span>
      </button>
      <div class="response-box" id="resp-${termId}-intro-${oi}" style="display:none">
        <div class="response-text">${esc(opt.response)}</div>
      </div>`;
    }

    html += `</div></div>`;

    // Interactive explore turns
    for (let ti = 0; ti < p.explore.length; ti++) {
      const turn = p.explore[ti];
      const typeLabel = TYPE_LABELS[turn.type] ?? turn.type;

      html += `<div class="turn-section explore-turn">
        <h4 class="turn-title">탐색 ${ti + 1} <span class="turn-type">${esc(turn.type)} — ${esc(typeLabel)}</span></h4>
        <div class="question-text">${esc(turn.question)}</div>
        <div class="options-container" data-term="${termId}" data-turn="explore-${ti}">`;

      for (let oi = 0; oi < turn.options.length; oi++) {
        const opt = turn.options[oi];
        const correctClass = opt.correct ? 'correct-option' : 'incorrect-option';
        html += `<button class="option-btn explore-btn" data-correct="${opt.correct}" onclick="selectExplore(this, '${termId}', ${ti}, ${oi})">
          <span class="option-num">${oi + 1}</span>
          <span class="option-text">${esc(opt.text)}</span>
        </button>
        <div class="response-box ${correctClass}" id="resp-${termId}-explore-${ti}-${oi}" style="display:none">
          <div class="response-text">${esc(opt.response)}</div>
        </div>`;
      }

      html += `</div></div>`;
    }
  }

  // Learning objectives
  if (result.parsed?.objectives && result.parsed.objectives.length > 0) {
    html += `<div class="turn-section">
      <h4 class="turn-title">학습 목표</h4>
      <ol style="margin:0 0 0 20px;font-size:13px;line-height:1.8;">`;
    for (const obj of result.parsed.objectives) {
      html += `<li>${esc(obj)}</li>`;
    }
    html += `</ol></div>`;
  }

  // Summary (closing turn)
  if (result.parsed?.summary) {
    html += `<div class="turn-section">
      <h4 class="turn-title">종료</h4>
      <div class="scene-text">${esc(result.parsed.summary)}</div>
    </div>`;
  }

  // Stats bar
  html += `<div class="stats-bar">
    <span>Tokens: ${result.tokenUsage.inputTokens} in / ${result.tokenUsage.outputTokens} out</span>
    <span>Latency: ${result.latencyMs}ms</span>
    <span>Cost: $${cost.toFixed(4)}</span>
    <span>Source: ${esc(result.source)}</span>
  </div>`;

  // Parse errors
  if (result.parseErrors.length > 0) {
    html += `<div class="parse-errors"><h4>Parse Errors</h4>`;
    for (const err of result.parseErrors) {
      html += `<div class="parse-error">${esc(err)}</div>`;
    }
    html += `</div>`;
  }

  // Feedback textarea
  html += `<div class="feedback-section">
    <label class="feedback-label" for="fb-${termId}">Feedback</label>
    <textarea id="fb-${termId}" class="feedback-textarea" rows="3"
      placeholder="이 단어의 소개·탐색 품질에 대한 피드백..."
      oninput="markUnsaved('${termId}')">${esc(result.feedback)}</textarea>
    <button class="save-btn" id="save-${termId}" onclick="saveFeedback('${termId}')">Save</button>
    <span class="save-status" id="status-${termId}"></span>
  </div>`;

  html += `</div></details></div>`;
  return html;
}

// ---- Summary Section ----

function renderSummary(data: ReportData): string {
  const { aggregates: agg } = data;

  let html = `<div class="summary">
    <div class="summary-grid">
      <div class="sg-item"><div class="sg-value">${agg.totalTerms}</div><div class="sg-label">Terms</div></div>
      <div class="sg-item"><div class="sg-value">${agg.structuralChecksPassed}/${agg.structuralChecksTotal}</div><div class="sg-label">Checks</div></div>
      <div class="sg-item"><div class="sg-value">${agg.avgExploreTurns}</div><div class="sg-label">Avg Turns</div></div>
      <div class="sg-item"><div class="sg-value">${agg.avgLatencyMs}ms</div><div class="sg-label">Avg Latency</div></div>
      <div class="sg-item"><div class="sg-value">$${agg.totalCost.toFixed(3)}</div><div class="sg-label">Total Cost</div></div>
      <div class="sg-item"><div class="sg-value">${(agg.totalOutputTokens / 1000).toFixed(1)}k</div><div class="sg-label">Output Tokens</div></div>
    </div>
    <div class="summary-meta">${esc(data.model)} · ${esc(data.promptVersion)} · ${esc(data.timestamp)}</div>

    <table class="overview-table"><thead><tr>
      <th>Term</th><th>Level</th><th>Imp</th><th>Type</th><th>Turns</th><th>Checks</th><th>Tokens in/out</th><th>Latency</th><th>Cost</th>
    </tr></thead><tbody>`;

  for (const r of data.results) {
    const passed = r.structuralChecks.filter((c) => c.passed).length;
    const total = r.structuralChecks.length;
    const cost = estimateCost(r.tokenUsage.inputTokens, r.tokenUsage.outputTokens, r.tokenUsage.cacheRead, r.tokenUsage.cacheCreation);
    const turns = r.parsed ? r.parsed.explore.length : 0;
    const checksClass = passed === total ? 'all-pass' : 'has-fail';
    html += `<tr>
      <td><a href="#card-${esc(r.termId)}">${esc(r.word)}</a></td>
      <td><span class="level-badge-sm" style="background:${levelBg(r.level)}">${esc(r.level)}</span></td>
      <td>${r.importance}</td>
      <td>${r.termType === 'phrase' ? 'P' : 'V'}</td>
      <td>${turns}</td>
      <td class="${checksClass}">${passed}/${total}</td>
      <td class="tok-cell">${r.tokenUsage.inputTokens}/${r.tokenUsage.outputTokens}</td>
      <td>${r.latencyMs}ms</td>
      <td>$${cost.toFixed(4)}</td>
    </tr>`;
  }

  html += `</tbody></table></div>`;
  return html;
}

// ---- Full HTML ----

function generateHtml(data: ReportData, feedbackPort: number): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>Introduction v1 — ${esc(data.reportId)}</title>
<style>
:root {
  --bg: #f8fafc; --card: #fff; --border: #e2e8f0; --border-light: #f1f5f9;
  --text: #1e293b; --text-muted: #64748b; --text-faint: #94a3b8;
  --accent: #6366f1; --accent-light: #eef2ff; --accent-border: #c7d2fe;
  --correct: #16a34a; --correct-bg: #f0fdf4; --correct-border: #bbf7d0;
  --incorrect: #dc2626; --incorrect-bg: #fef2f2; --incorrect-border: #fecaca;
  --scene-bg: #fffbeb; --scene-border: #fde68a;
  --question-bg: #f0f9ff; --question-border: #bae6fd;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'Pretendard', 'Inter', -apple-system, sans-serif; line-height: 1.6; padding: 24px; max-width: 1000px; margin: 0 auto; background: var(--bg); color: var(--text); font-size: 14px; }
h1 { font-size: 22px; font-weight: 700; margin-bottom: 20px; }

/* Summary */
.summary { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 20px; margin-bottom: 20px; }
.summary-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 12px; margin-bottom: 12px; }
.sg-item { text-align: center; padding: 10px; background: var(--bg); border-radius: 8px; }
.sg-value { font-size: 20px; font-weight: 700; }
.sg-label { font-size: 11px; color: var(--text-faint); text-transform: uppercase; letter-spacing: 0.5px; }
.summary-meta { font-size: 12px; color: var(--text-faint); text-align: center; margin-bottom: 16px; }

/* Overview table */
.overview-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.overview-table th { text-align: left; padding: 8px 6px; font-size: 11px; text-transform: uppercase; color: var(--text-faint); border-bottom: 2px solid var(--border); }
.overview-table td { padding: 6px; border-bottom: 1px solid var(--border-light); }
.overview-table a { color: var(--accent); text-decoration: none; font-weight: 600; }
.overview-table a:hover { text-decoration: underline; }
.tok-cell { font-size: 11px; color: var(--text-faint); }
.all-pass { color: var(--correct); font-weight: 600; }
.has-fail { color: var(--incorrect); font-weight: 600; }

/* Badges */
.level-badge, .level-badge-sm { display: inline-block; padding: 1px 8px; border-radius: 8px; font-size: 12px; font-weight: 700; }
.level-badge-sm { font-size: 10px; padding: 1px 6px; }
.imp-badge { font-size: 11px; color: var(--text-muted); }
.type-badge { font-size: 11px; padding: 1px 6px; border-radius: 4px; background: #f1f5f9; color: var(--text-muted); }

/* Term card */
.term-card { background: var(--card); border: 1px solid var(--border); border-radius: 10px; margin-bottom: 10px; overflow: hidden; }
.term-header { padding: 12px 16px; cursor: pointer; display: flex; align-items: center; gap: 8px; font-size: 13px; flex-wrap: wrap; }
.term-header:hover { background: #fafbfc; }
.term-word { font-weight: 700; font-size: 15px; min-width: 120px; }
.term-def { flex: 1; color: var(--text-muted); font-size: 12px; min-width: 200px; }
.term-stats { display: flex; gap: 10px; font-size: 11px; color: var(--text-faint); }
.stat-turns { color: var(--accent); font-weight: 600; }
.term-body { padding: 0 16px 16px; }

/* Checks */
.checks-bar { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 12px; }
.ck-pass, .ck-fail { font-size: 11px; padding: 2px 8px; border-radius: 4px; }
.ck-pass { color: var(--correct); background: var(--correct-bg); }
.ck-fail { color: var(--incorrect); background: var(--incorrect-bg); }

/* Reasoning */
.reasoning-block { margin-bottom: 16px; }
.reasoning-block summary { font-size: 13px; font-weight: 600; color: var(--text-muted); cursor: pointer; }
.reasoning-content { margin-top: 8px; padding: 12px; background: var(--bg); border-radius: 8px; }
.r-field { margin-bottom: 6px; font-size: 13px; line-height: 1.6; }
.r-field code { background: #e2e8f0; padding: 2px 6px; border-radius: 4px; font-size: 12px; }

/* Turn sections */
.turn-section { margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid var(--border-light); }
.turn-title { font-size: 14px; font-weight: 700; margin-bottom: 10px; display: flex; align-items: center; gap: 8px; }
.turn-type { font-size: 12px; font-weight: 500; color: var(--accent); background: var(--accent-light); padding: 2px 8px; border-radius: 4px; }
.scene-text { background: var(--scene-bg); border-left: 3px solid var(--scene-border); padding: 12px 16px; border-radius: 0 8px 8px 0; margin-bottom: 10px; font-size: 14px; line-height: 1.8; white-space: pre-wrap; }
.question-text { background: var(--question-bg); border-left: 3px solid var(--question-border); padding: 10px 16px; border-radius: 0 8px 8px 0; margin-bottom: 12px; font-size: 14px; font-weight: 600; }

/* Option buttons */
.options-container { display: flex; flex-direction: column; gap: 6px; }
.option-btn { display: flex; align-items: flex-start; gap: 10px; width: 100%; padding: 10px 14px; border: 1px solid var(--border); border-radius: 8px; background: var(--card); cursor: pointer; text-align: left; font-size: 14px; line-height: 1.6; transition: all 0.15s; font-family: inherit; }
.option-btn:hover { border-color: var(--accent); background: var(--accent-light); }
.option-btn.selected { border-color: var(--accent); background: var(--accent-light); box-shadow: 0 0 0 2px var(--accent-border); }
.option-btn.revealed-correct { border-color: var(--correct); background: var(--correct-bg); }
.option-btn.revealed-incorrect { border-color: var(--incorrect); background: var(--incorrect-bg); }
.option-num { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 50%; background: var(--bg); font-size: 12px; font-weight: 700; color: var(--text-muted); flex-shrink: 0; }
.option-text { flex: 1; }

/* Response boxes */
.response-box { margin: 4px 0 8px 34px; padding: 12px 16px; border-radius: 8px; font-size: 13px; line-height: 1.8; animation: fadeIn 0.2s; white-space: pre-wrap; }
.response-box:not(.correct-option):not(.incorrect-option) {
  background: #f8f8ff; border: 1px solid var(--accent-border);
}
.correct-option { background: var(--correct-bg); border: 1px solid var(--correct-border); }
.incorrect-option { background: var(--incorrect-bg); border: 1px solid var(--incorrect-border); }
@keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }

/* Stats */
.stats-bar { display: flex; flex-wrap: wrap; gap: 16px; font-size: 11px; color: var(--text-faint); margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--border-light); }

/* Parse errors */
.parse-errors { margin-top: 8px; }
.parse-error { background: var(--incorrect-bg); color: var(--incorrect); padding: 4px 8px; border-radius: 4px; font-size: 11px; font-family: monospace; margin: 2px 0; }
.error-box { background: var(--incorrect-bg); padding: 12px; border-radius: 8px; margin: 8px 0; }
.error-box pre { font-size: 11px; white-space: pre-wrap; word-break: break-all; }

/* Feedback */
.feedback-section { margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--border-light); }
.feedback-label { font-size: 12px; font-weight: 600; color: var(--text-muted); display: block; margin-bottom: 4px; }
.feedback-textarea { width: 100%; padding: 8px 12px; border: 1px solid var(--border); border-radius: 8px; font-size: 13px; font-family: inherit; resize: vertical; line-height: 1.6; }
.feedback-textarea:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-border); }
.save-btn { margin-top: 6px; padding: 6px 16px; border: 1px solid var(--accent); border-radius: 6px; background: var(--accent-light); color: var(--accent); font-weight: 600; font-size: 12px; cursor: pointer; font-family: inherit; }
.save-btn:hover { background: var(--accent); color: white; }
.save-btn.unsaved { border-color: var(--incorrect); color: var(--incorrect); background: var(--incorrect-bg); }
.save-status { font-size: 11px; color: var(--text-faint); margin-left: 8px; }

.section-title { font-size: 13px; font-weight: 600; color: var(--text-muted); cursor: pointer; }

@media (max-width: 768px) {
  .summary-grid { grid-template-columns: repeat(3, 1fr); }
  body { padding: 12px; }
}
</style>
</head>
<body>
<h1>Word Introduction — ${esc(data.reportId)}</h1>
${renderSummary(data)}
${data.results.map((r, i) => renderTermCard(r, i)).join('\n')}

<script>
const FEEDBACK_PORT = ${feedbackPort};

function selectOption(btn, termId, turn, idx) {
  // Toggle: if already selected, deselect
  const respId = 'resp-' + termId + '-' + turn + '-' + idx;
  const respEl = document.getElementById(respId);
  if (btn.classList.contains('selected')) {
    btn.classList.remove('selected');
    respEl.style.display = 'none';
    return;
  }
  // For intro: allow multiple selections to compare
  // Just toggle this one
  btn.classList.toggle('selected');
  respEl.style.display = respEl.style.display === 'none' ? 'block' : 'none';
}

function selectExplore(btn, termId, turnIdx, optIdx) {
  const respId = 'resp-' + termId + '-explore-' + turnIdx + '-' + optIdx;
  const respEl = document.getElementById(respId);
  const isCorrect = btn.dataset.correct === 'true';

  if (btn.classList.contains('revealed-correct') || btn.classList.contains('revealed-incorrect')) {
    // Toggle off
    btn.classList.remove('revealed-correct', 'revealed-incorrect', 'selected');
    respEl.style.display = 'none';
    return;
  }

  // Reveal this option
  btn.classList.add(isCorrect ? 'revealed-correct' : 'revealed-incorrect');
  btn.classList.add('selected');
  respEl.style.display = 'block';
}

function markUnsaved(termId) {
  var btn = document.getElementById('save-' + termId);
  btn.classList.add('unsaved');
  document.getElementById('status-' + termId).textContent = 'unsaved';
}

async function saveFeedback(termId) {
  var textarea = document.getElementById('fb-' + termId);
  var feedback = textarea.value;
  var statusEl = document.getElementById('status-' + termId);
  var btn = document.getElementById('save-' + termId);

  try {
    var resp = await fetch('http://localhost:' + FEEDBACK_PORT + '/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ termId: termId, feedback: feedback }),
    });
    if (resp.ok) {
      statusEl.textContent = 'saved ✓';
      btn.classList.remove('unsaved');
    } else {
      statusEl.textContent = 'save failed: ' + resp.status;
    }
  } catch (e) {
    statusEl.textContent = 'server unreachable — is feedback-server running?';
  }
}

// Save all on Ctrl+S
document.addEventListener('keydown', function(e) {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    document.querySelectorAll('.save-btn.unsaved').forEach(function(btn) {
      var termId = btn.id.replace('save-', '');
      saveFeedback(termId);
    });
  }
});
</script>
</body>
</html>`;
}

// ---- Generate Report ----

const REPORTS_DIR = 'experiments/introduction-v1/reports';

export function generateReport(data: ReportData, feedbackPort = 3456): { reportId: string; reportPath: string } {
  if (!existsSync(REPORTS_DIR)) {
    mkdirSync(REPORTS_DIR, { recursive: true });
  }

  const html = generateHtml(data, feedbackPort);
  const reportPath = join(REPORTS_DIR, `${data.reportId}.html`);
  writeFileSync(reportPath, html, 'utf-8');

  return { reportId: data.reportId, reportPath };
}
