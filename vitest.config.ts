import { defineConfig } from 'vitest/config';
import { readFileSync } from 'fs';

function loadDotEnv(): Record<string, string> {
  try {
    const content = readFileSync('.env', 'utf8');
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

const envFromFile = loadDotEnv();

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    env: {
      // Defaults from .env file
      ...envFromFile,
      // Test-specific overrides (always applied)
      NODE_ENV: 'test',
      DB_NAME: 'voca_test',
      LOG_LEVEL: 'silent',
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/server.ts'],
    },
    testTimeout: 10000,
    hookTimeout: 10000,
  },
});
