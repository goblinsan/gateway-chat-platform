import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  // LM Studio instances
  LM_STUDIO_A_BASE_URL: z.string().url().optional(),
  LM_STUDIO_B_BASE_URL: z.string().url().optional(),

  // Paid provider API keys
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  GOOGLE_API_KEY: z.string().optional(),

  // Cloudflare Access
  CF_ACCESS_TEAM_DOMAIN: z.string().optional(),
  CF_ACCESS_AUD: z.string().optional(),

  // Build metadata
  BUILD_VERSION: z.string().default('0.0.0'),
  BUILD_COMMIT: z.string().default('unknown'),
})

export type Env = z.infer<typeof envSchema>

let _env: Env | undefined

export function loadEnv(): Env {
  if (_env) return _env
  const result = envSchema.safeParse(process.env)
  if (!result.success) {
    console.error('Invalid environment configuration:', result.error.format())
    process.exit(1)
  }
  _env = result.data
  return _env
}

export function getEnv(): Env {
  if (!_env) return loadEnv()
  return _env
}
