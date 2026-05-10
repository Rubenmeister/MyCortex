import { z } from 'zod';

// Treat empty strings (common when .env keys are placeholder-empty) as missing.
const optKey = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  z.string().min(1).optional(),
);

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.string().default('info'),

  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_ANON_KEY: z.string().min(1),

  OPENAI_API_KEY: optKey,
  ANTHROPIC_API_KEY: optKey,
  GOOGLE_GENERATIVE_AI_API_KEY: optKey,
  TAVILY_API_KEY: optKey,

  // Google OAuth (Drive, Gmail). Optional — integrations gracefully
  // disable themselves if these aren't configured.
  GOOGLE_OAUTH_CLIENT_ID: optKey,
  GOOGLE_OAUTH_CLIENT_SECRET: optKey,
  GOOGLE_OAUTH_REDIRECT_URI: optKey,

  // Where to redirect the user back to after OAuth (the web app).
  // Defaults to the Vercel prod URL.
  WEB_BASE_URL: z.string().url().default('https://my-cortex-web-gxoh.vercel.app'),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('Invalid environment:', parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  cached = parsed.data;
  return cached;
}
