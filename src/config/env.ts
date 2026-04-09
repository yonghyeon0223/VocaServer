import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']),
  PORT: z.coerce.number().int().positive().default(3000),

  // Database
  DB_URI: z.string().min(1),
  DB_NAME: z.string().min(1),

  // Rate limiting
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(100),

  // CORS
  CORS_ORIGINS: z.string().default('http://localhost:3000'),

  // Logging
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
});

export type EnvConfig = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:');
  console.error(parsed.error.format());
  process.exit(1);
}

export const config: EnvConfig = parsed.data;
