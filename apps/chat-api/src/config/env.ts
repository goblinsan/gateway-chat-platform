import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  DATABASE_URL: z.string().default('file:./data/gateway.db'),
  LOG_DIR: z.string().optional(),
  RETENTION_DAYS_CONVERSATIONS: z.coerce.number().default(90),
  RETENTION_DAYS_LOGS: z.coerce.number().default(30),

  // LM Studio instances
  LM_STUDIO_A_BASE_URL: z.string().url().optional(),
  LM_STUDIO_B_BASE_URL: z.string().url().optional(),

  // Paid provider API keys
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  GOOGLE_API_KEY: z.string().optional(),

  // Allowed CORS origins (comma-separated list, e.g. https://chat.yourdomain.com)
  // If empty, all origins are allowed in development and none in production.
  ALLOWED_ORIGINS: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []))
    .default(''),

  // Cloudflare Access
  CF_ACCESS_TEAM_DOMAIN: z.string().optional(),
  CF_ACCESS_AUD: z.string().optional(),

  // Build metadata
  BUILD_VERSION: z.string().default('0.0.0'),
  BUILD_COMMIT: z.string().default('unknown'),

  // TTS service
  TTS_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1')
    .default('false'),
  TTS_BASE_URL: z.string().default('http://192.168.0.172:5000'),
  TTS_DEFAULT_VOICE: z.string().default('assistant_v1'),
  TTS_GENERATE_PATH: z.string().default('/tts'),
  TTS_STREAM_PATH: z.string().default('/tts/stream'),
  TTS_VOICES_PATH: z.string().default('/voices'),
  TTS_HEALTH_PATH: z.string().default('/health'),

  // Scheduled inbox delivery
  REDIS_URL: z.string().optional(),
  CHAT_DEFAULT_USER_ID: z.string().default('me'),
  CHAT_DEFAULT_CHANNEL_ID: z.string().default('coach'),

  // Internal agent-service (orchestration)
  AGENT_SERVICE_URL: z.string().url().optional(),
  AGENT_SERVICE_API_KEY: z.string().optional(),
  AGENT_SERVICE_TIMEOUT_MS: z.coerce.number().default(30000),
  AGENT_SERVICE_RETRY_COUNT: z.coerce.number().default(2),
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
