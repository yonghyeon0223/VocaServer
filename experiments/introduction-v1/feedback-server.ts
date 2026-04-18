// Lightweight local server for persisting feedback from the HTML report.
// Also serves the report HTML so it's accessed via http:// (not file://).
// This avoids CORS issues with fetch() from file:// origins.
//
// Usage:
//   npm run feedback-server
//   Then open http://localhost:3456 to view the latest report.

import { createServer } from 'http';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

const RESULTS_DIR = 'experiments/introduction-v1/results';
const REPORTS_DIR = 'experiments/introduction-v1/reports';
const FEEDBACK_FILE = join(RESULTS_DIR, 'feedback.json');
const DEFAULT_PORT = 3456;

interface FeedbackStore {
  [termId: string]: {
    feedback: string;
    updatedAt: string;
  };
}

function loadFeedback(): FeedbackStore {
  if (!existsSync(FEEDBACK_FILE)) return {};
  try {
    return JSON.parse(readFileSync(FEEDBACK_FILE, 'utf-8')) as FeedbackStore;
  } catch {
    return {};
  }
}

function saveFeedbackStore(store: FeedbackStore): void {
  writeFileSync(FEEDBACK_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

function updateResultFile(termId: string, feedback: string): void {
  if (!existsSync(RESULTS_DIR)) return;

  const files = readdirSync(RESULTS_DIR)
    .filter((f: string) => f.startsWith(termId + '_') && f.endsWith('.json') && f !== 'feedback.json')
    .sort()
    .reverse();

  if (files.length === 0) return;

  const latestFile = join(RESULTS_DIR, files[0]);
  try {
    const result = JSON.parse(readFileSync(latestFile, 'utf-8'));
    result.feedback = feedback;
    writeFileSync(latestFile, JSON.stringify(result, null, 2), 'utf-8');
  } catch {
    // Non-critical — feedback.json is the primary store
  }
}

function getLatestReport(): string | null {
  if (!existsSync(REPORTS_DIR)) return null;
  const files = readdirSync(REPORTS_DIR)
    .filter((f) => f.endsWith('.html'))
    .sort()
    .reverse();
  return files.length > 0 ? join(REPORTS_DIR, files[0]) : null;
}

const port = Number(process.env['FEEDBACK_PORT']) || DEFAULT_PORT;

const server = createServer((req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Serve latest report at root
  if (req.method === 'GET' && (req.url === '/' || req.url === '/report')) {
    const reportPath = getLatestReport();
    if (!reportPath) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('No reports found. Run npm run test:intro-prompt first.');
      return;
    }
    const html = readFileSync(reportPath, 'utf-8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  // Serve specific report by filename
  if (req.method === 'GET' && req.url?.startsWith('/report/')) {
    const filename = req.url.slice('/report/'.length);
    const reportPath = join(REPORTS_DIR, filename);
    if (!existsSync(reportPath) || !filename.endsWith('.html')) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Report not found');
      return;
    }
    const html = readFileSync(reportPath, 'utf-8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  // List all reports
  if (req.method === 'GET' && req.url === '/reports') {
    if (!existsSync(REPORTS_DIR)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('[]');
      return;
    }
    const files = readdirSync(REPORTS_DIR).filter((f) => f.endsWith('.html')).sort().reverse();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(files));
    return;
  }

  // Save feedback
  if (req.method === 'POST' && req.url === '/feedback') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const { termId, feedback } = JSON.parse(body) as { termId: string; feedback: string };
        if (!termId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'termId required' }));
          return;
        }

        const store = loadFeedback();
        store[termId] = { feedback: feedback ?? '', updatedAt: new Date().toISOString() };
        saveFeedbackStore(store);
        updateResultFile(termId, feedback ?? '');

        console.log(`  Saved feedback for ${termId} (${(feedback ?? '').length} chars)`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  // Get all feedback
  if (req.method === 'GET' && req.url === '/feedback') {
    const store = loadFeedback();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(store));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(port, () => {
  console.log(`\n  Feedback server running on http://localhost:${port}`);
  console.log(`  ──────────────────────────────────────────────`);
  console.log(`  GET  /           — view latest report`);
  console.log(`  GET  /reports    — list all reports`);
  console.log(`  POST /feedback   — save feedback for a term`);
  console.log(`  GET  /feedback   — list all saved feedback`);
  console.log(`\n  Open http://localhost:${port} in your browser`);
  console.log(`  Press Ctrl+C to stop\n`);
});
