import type { Db } from './index.js';

/**
 * Medición de consumo de IA por workspace.
 *
 * Existe porque el precio de MyCortex ($3-5/mes, apuesta del 16-jul-2026) no se
 * puede defender sin saber el costo por persona — y no se puede leer de la
 * factura: el gasto de Anthropic/OpenAI de Rubén está dominado por Claude Code y
 * generación de imágenes, así que MyCortex queda enterrado ahí.
 *
 * NO necesita migración: `usage_counters.metric` es texto libre y la PK es
 * (workspace_id, period, metric). Se guardan tres métricas por llamada:
 *   ai_ops                          → cuántas operaciones
 *   tok_in:<modelo> / tok_out:<modelo>  → tokens, separados por modelo porque
 *                                          cada uno tiene precio distinto
 *
 * Best-effort SIEMPRE: medir no puede tumbar una respuesta al usuario.
 */

export function currentPeriod(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Lo que devuelve `usage` del Vercel AI SDK v4. */
export type AiUsage = {
  promptTokens?: number;
  completionTokens?: number;
};

async function bump(db: Db, workspaceId: string, metric: string, delta: number): Promise<void> {
  if (delta <= 0) return;
  try {
    await db.rpc('increment_usage', {
      p_workspace_id: workspaceId,
      p_period: currentPeriod(),
      p_metric: metric,
      p_delta: delta,
    } as never);
  } catch {
    /* best-effort: nunca romper el flujo por una métrica */
  }
}

/**
 * Registra una llamada al LLM. Llamar con `void meterAi(...)` — no hace falta
 * esperarla.
 *
 * @param modelId  El id EXACTO del modelo (ej. 'claude-haiku-4-5-20251001').
 *                 Se usa como parte de la métrica, así que un cambio de modelo
 *                 queda visible en los datos en vez de mezclarse.
 */
export async function meterAi(
  db: Db,
  workspaceId: string,
  modelId: string,
  usage: AiUsage | undefined,
): Promise<void> {
  await bump(db, workspaceId, 'ai_ops', 1);
  await bump(db, workspaceId, `tok_in:${modelId}`, usage?.promptTokens ?? 0);
  await bump(db, workspaceId, `tok_out:${modelId}`, usage?.completionTokens ?? 0);
}

/**
 * Precio por millón de tokens, en USD. Fuente: pricing público de Anthropic y
 * OpenAI al 16-jul-2026. Si un modelo no está aquí, su costo se reporta como
 * desconocido en vez de asumir cero — un costo silencioso es peor que un hueco
 * visible.
 */
export const PRICE_PER_MTOK: Record<string, { in: number; out: number }> = {
  'claude-haiku-4-5-20251001': { in: 1, out: 5 },
  'claude-sonnet-4-6': { in: 3, out: 15 },
  'claude-opus-4-8': { in: 5, out: 25 },
  'gpt-4o-mini': { in: 0.15, out: 0.6 },
  'text-embedding-3-small': { in: 0.02, out: 0 },
};

export type CostBreakdown = {
  totalUsd: number;
  aiOps: number;
  byModel: { model: string; tokensIn: number; tokensOut: number; usd: number | null }[];
  /** Modelos vistos sin precio conocido: su costo NO está en totalUsd. */
  unpriced: string[];
};

/** Traduce los contadores crudos de un período a dólares. */
export async function costForPeriod(
  db: Db,
  workspaceId: string,
  period = currentPeriod(),
): Promise<CostBreakdown> {
  const { data } = await db
    .from('usage_counters')
    .select('metric, count')
    .eq('workspace_id', workspaceId)
    .eq('period', period);

  const models = new Map<string, { tokensIn: number; tokensOut: number }>();
  let aiOps = 0;
  for (const row of data ?? []) {
    const metric = row.metric as string;
    const count = row.count as number;
    if (metric === 'ai_ops') {
      aiOps = count;
      continue;
    }
    const m = /^tok_(in|out):(.+)$/.exec(metric);
    if (!m) continue;
    const entry = models.get(m[2]!) ?? { tokensIn: 0, tokensOut: 0 };
    if (m[1] === 'in') entry.tokensIn = count;
    else entry.tokensOut = count;
    models.set(m[2]!, entry);
  }

  const unpriced: string[] = [];
  let totalUsd = 0;
  const byModel = [...models.entries()].map(([model, t]) => {
    const price = PRICE_PER_MTOK[model];
    if (!price) {
      unpriced.push(model);
      return { model, ...t, usd: null };
    }
    const usd = (t.tokensIn / 1_000_000) * price.in + (t.tokensOut / 1_000_000) * price.out;
    totalUsd += usd;
    return { model, ...t, usd };
  });

  return { totalUsd, aiOps, byModel, unpriced };
}
