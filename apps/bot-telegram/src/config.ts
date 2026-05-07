import { z } from 'zod';

const optKey = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  z.string().min(1).optional(),
);

const EnvSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_DEFAULT_USER_ID: z.string().uuid(),
  API_URL: z.string().url().default('http://localhost:4000'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  OPENAI_API_KEY: optKey,
});

export type Config = z.infer<typeof EnvSchema>;

export function loadConfig(): Config {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'invalid_env',
        issues: parsed.error.flatten().fieldErrors,
      }),
    );
    process.exit(1);
  }
  return parsed.data;
}
