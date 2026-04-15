import { defineConfig } from 'vitest/config';
import { readFileSync } from 'fs';

// Manually load .env files and pass them via vitest's env option
// (dotenv's config() runs at config-parse time but vitest may not propagate to test workers)

function loadDotEnv(path: string): Record<string, string> {
  try {
    const content = readFileSync(path, 'utf8');
    const vars: Record<string, string> = {};
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim();
      vars[key] = value;
    }
    return vars;
  } catch {
    return {};
  }
}

// Load project .env first, then experiments-specific overrides
const projectEnv = loadDotEnv('.env');
const experimentEnv = loadDotEnv('experiments/.env.experiments');

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['experiments/extraction-v2/**/*.test.ts'],
    exclude: ['experiments/**/__tests__/**'],
    env: {
      ...projectEnv,
      ...experimentEnv,
    },
    testTimeout: 600000,
    hookTimeout: 30000,
  },
});
