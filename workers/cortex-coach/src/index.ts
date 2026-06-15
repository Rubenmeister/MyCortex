import { z } from 'zod';
import { createDb, type Db } from '@mycortex/db';
import {
  deriveUserProfile,
  generateCoachSuggestions,
  persistCoachGeneration,
} from '@mycortex/cortex-engine';

const EnvSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  // El coach razona con Claude; sin esto no hay coaching.
  ANTHROPIC_API_KEY: z.string().min(1),
  COACH_LOOKBACK_DAYS: z.coerce.number().int().positive().default(45),
  // Nudge contextual: si está, empujamos el foco por Telegram a los chats
  // vinculados del workspace. Opcional — sin token no hay push.
  TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),
});

/** Empuja un mensaje a todos los chats de Telegram vinculados al workspace. */
async function pushTelegram(
  db: Db,
  token: string,
  workspaceId: string,
  text: string,
): Promise<number> {
  const { data } = await db
    .from('telegram_links')
    .select('chat_id')
    .eq('workspace_id', workspaceId);
  let sent = 0;
  for (const link of data ?? []) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: link.chat_id, text, parse_mode: 'Markdown' }),
      });
      if (res.ok) sent++;
    } catch {
      /* best-effort */
    }
  }
  return sent;
}

function log(level: 'info' | 'warn' | 'error', msg: string, extra?: unknown): void {
  console.log(JSON.stringify({ level, msg, ts: new Date().toISOString(), ...(extra as object) }));
}

/**
 * cortex-coach: corre semanalmente (Cloud Scheduler), genera el coaching de
 * crecimiento por workspace y lo persiste en coach_runs + coach_suggestions
 * para habilitar el seguimiento. Patrón: igual que cortex-cron/digest.
 */
async function main(): Promise<void> {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    log('error', 'invalid_env', { issues: parsed.error.flatten().fieldErrors });
    process.exit(1);
  }
  const cfg = parsed.data;
  const db = createDb(cfg.SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY);

  log('info', 'cortex_coach_start', { lookbackDays: cfg.COACH_LOOKBACK_DAYS });
  const started = Date.now();

  const { data: workspaces, error } = await db.from('workspaces').select('id, owner_id');
  if (error) {
    log('error', 'list_workspaces_failed', { error: error.message });
    process.exit(1);
  }
  if (!workspaces || workspaces.length === 0) {
    log('info', 'no_workspaces');
    return;
  }

  const totals = { workspaces: 0, withSuggestions: 0, inserted: 0, nudged: 0, errors: 0 };

  for (const ws of workspaces) {
    totals.workspaces++;
    try {
      // 1. Refrescar el perfil (que el coach "te conozca"): se inyecta en la
      //    generación. Best-effort — si falla, el coach corre igual.
      try {
        await deriveUserProfile(db, ws.id, ws.owner_id, { lookbackDays: cfg.COACH_LOOKBACK_DAYS * 2 });
      } catch (err) {
        log('warn', 'profile_refresh_failed', { workspaceId: ws.id, error: String(err).slice(0, 160) });
      }

      // 2. Generar + persistir el coaching.
      const gen = await generateCoachSuggestions(db, ws.id, { lookbackDays: cfg.COACH_LOOKBACK_DAYS });
      if (gen.result.suggestions.length === 0) continue;
      const { inserted } = await persistCoachGeneration(db, ws.id, ws.owner_id, gen);
      if (inserted > 0) {
        totals.withSuggestions++;
        totals.inserted += inserted;
      }

      // 3. Nudge contextual: empujar el foco por Telegram (si hay token).
      if (cfg.TELEGRAM_BOT_TOKEN) {
        const text = `🎯 *Tu foco de la semana*\n${gen.result.focus}\n\n_Abrí MyCortex para ver tus ${inserted} sugerencias._`;
        totals.nudged += await pushTelegram(db, cfg.TELEGRAM_BOT_TOKEN, ws.id, text);
      }
    } catch (err) {
      totals.errors++;
      log('warn', 'coach_workspace_failed', { workspaceId: ws.id, error: String(err).slice(0, 200) });
    }
  }

  log('info', 'cortex_coach_done', { elapsedMs: Date.now() - started, ...totals });
}

main().catch((err) => {
  log('error', 'cortex_coach_crashed', { error: String(err) });
  process.exit(1);
});
