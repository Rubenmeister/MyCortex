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
  COHERE_API_KEY: optKey,
  RESEND_API_KEY: optKey,
  /** From address for outbound mails. Defaults to a Resend sandbox sender. */
  RESEND_FROM_EMAIL: optKey,

  /** Telegram bot username (without @) — used to build the t.me deep link
   *  for the multi-user linking flow. Optional: if not set, the UI shows
   *  the token to copy/paste manually. */
  TELEGRAM_BOT_USERNAME: optKey,

  /** Dedicated HMAC secret for signing OAuth state tokens (Drive, Gmail,
   *  Calendar). Falls back to SUPABASE_SERVICE_ROLE_KEY for backwards
   *  compat with deployments that haven't rotated yet, but production
   *  SHOULD set this to a different random value so a state-token leak
   *  doesn't expose the master DB key. */
  OAUTH_STATE_SECRET: optKey,

  // ---- WhatsApp Cloud API (Meta) ----
  /** Permanent access token from Meta Business app. Required to send
   *  messages and to verify webhook ownership at registration time. */
  WHATSAPP_ACCESS_TOKEN: optKey,
  /** WhatsApp Business phone number ID — NOT the phone number itself.
   *  Comes from Meta dashboard once a number is added. */
  WHATSAPP_PHONE_NUMBER_ID: optKey,
  /** Display phone number including country code (e.g. +593987654321).
   *  Shown to users in the linking instructions ("send to this number"). */
  WHATSAPP_DISPLAY_NUMBER: optKey,
  /** Shared secret used during webhook verification GET handshake +
   *  validated as the X-Hub-Signature on incoming POST webhooks. */
  WHATSAPP_VERIFY_TOKEN: optKey,
  /** App secret from Meta — used to validate incoming webhook signatures
   *  (X-Hub-Signature-256 HMAC-SHA256 of request body). */
  WHATSAPP_APP_SECRET: optKey,

  // Google OAuth (Drive, Gmail). Optional — integrations gracefully
  // disable themselves if these aren't configured. Each provider has its
  // own redirect URI registered in Google Cloud Console.
  GOOGLE_OAUTH_CLIENT_ID: optKey,
  GOOGLE_OAUTH_CLIENT_SECRET: optKey,
  GOOGLE_OAUTH_REDIRECT_URI: optKey,         // Drive callback URI
  GMAIL_OAUTH_REDIRECT_URI: optKey,          // Gmail callback URI
  CALENDAR_OAUTH_REDIRECT_URI: optKey,       // Calendar callback URI

  // Where to redirect the user back to after OAuth (the web app).
  // Defaults to the Vercel prod URL.
  WEB_BASE_URL: z.string().url().default('https://my-cortex-web-gxoh.vercel.app'),

  /** Sentry DSN para captura de errores en producción. Optional —
   *  si está vacío, Sentry se inicializa pero no envía nada
   *  (sentry SDK lo trata como "disabled"). */
  SENTRY_DSN: optKey,
  /** Sample rate para traces (performance). 0.1 = 10% — suficiente para
   *  detectar regresiones de p95 sin gastar cupo de Sentry. */
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),
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
