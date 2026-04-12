import { defineConfig } from 'vitest/config';
import { config as loadEnv } from 'dotenv';

// Load experiment-specific env vars first, then fall back to project .env for AI_ANTHROPIC_KEY
loadEnv({ path: 'experiments/.env.experiments' });
loadEnv({ path: '.env' });

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['experiments/**/*.test.ts'],
    // Exclude framework unit tests — those run via npm run test
    exclude: ['experiments/**/__tests__/**'],
    testTimeout: 600000, // 10 min — AI calls are slow with many combinations
    hookTimeout: 30000,
  },
});
