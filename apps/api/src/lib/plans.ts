import type { Db } from '@mycortex/db';
import type { IntegrationProvider } from '@mycortex/db/types';
import { getDb } from './db.js';

/**
 * Planes y cuotas.
 *
 * Los límites de aquí son EXACTAMENTE los que /pricing promete públicamente
 * (Personal: 500 nodos + 1 integración · Pro: 50.000 + todas · Team: +RBAC).
 * Enforzarlos no cambia ninguna promesa: solo la hace cumplir.
 *
 * Nodos e integraciones se cuentan con un count() real sobre sus tablas (siempre
 * exacto). El uso de IA vive en usage_counters (no se puede derivar), y solo lo
 * escribe el service-role — el usuario no puede resetear su propia cuota.
 */

export type Plan = 'free' | 'pro' | 'team';

export type PlanLimits = {
  /** Máximo de nodos indexados. */
  nodes: number;
  /** Máximo de integraciones conectadas (Drive/Gmail/Calendar…). */
  integrations: number;
  /** Rerank premium con Cohere (coste por llamada). Pro+. */
  cohere: boolean;
  /** Web search proactiva con Tavily (coste por llamada). Pro+. */
  tavily: boolean;
  /** Push a WhatsApp / Telegram. Pro+. */
  push: boolean;
  /** Workspaces compartidos + RBAC. Solo Team. */
  sharedWorkspaces: boolean;
  /**
   * Tope mensual de operaciones de IA (Claude). `null` = sin tope.
   *
   * ⚠️ HOY VA EN null A PROPÓSITO: /pricing NO promete ningún límite de IA en el
   * plan gratis ("gratis siempre"), así que MEDIMOS pero no cortamos. Poner un
   * número aquí lo activa al instante — es una decisión de producto pendiente
   * (un free activo puede costar ~$15/mes en Claude sin tope).
   */
  aiOpsPerMonth: number | null;
};

export const PLANS: Record<Plan, PlanLimits> = {
  free: {
    nodes: 500,
    integrations: 1,
    cohere: false,
    tavily: false,
    push: false,
    sharedWorkspaces: false,
    aiOpsPerMonth: null,
  },
  pro: {
    nodes: 50_000,
    integrations: 99,
    cohere: true,
    tavily: true,
    push: true,
    sharedWorkspaces: false,
    aiOpsPerMonth: null,
  },
  team: {
    nodes: 50_000,
    integrations: 99,
    cohere: true,
    tavily: true,
    push: true,
    sharedWorkspaces: true,
    aiOpsPerMonth: null,
  },
};

/** Error de cuota: la ruta lo traduce a 402 (plan insuficiente / límite). */
export class QuotaError extends Error {
  constructor(
    public readonly code: string,
    public readonly detail: Record<string, unknown> = {},
  ) {
    super(code);
    this.name = 'QuotaError';
  }
}

/** Período de facturación: mes calendario UTC, 'YYYY-MM'. */
export function currentPeriod(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

export async function getPlan(db: Db, workspaceId: string): Promise<Plan> {
  const { data } = await db.from('workspaces').select('plan').eq('id', workspaceId).maybeSingle();
  const plan = (data as { plan?: string } | null)?.plan;
  return plan === 'pro' || plan === 'team' ? plan : 'free';
}

export async function limitsFor(db: Db, workspaceId: string): Promise<PlanLimits> {
  return PLANS[await getPlan(db, workspaceId)];
}

async function countRows(db: Db, table: 'nodes' | 'integrations', workspaceId: string): Promise<number> {
  const { count } = await db
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId);
  return count ?? 0;
}

export const countNodes = (db: Db, workspaceId: string) => countRows(db, 'nodes', workspaceId);
export const countIntegrations = (db: Db, workspaceId: string) => countRows(db, 'integrations', workspaceId);

/** Operaciones de IA consumidas este mes. */
export async function getAiOps(db: Db, workspaceId: string, period = currentPeriod()): Promise<number> {
  const { data } = await db
    .from('usage_counters')
    .select('count')
    .eq('workspace_id', workspaceId)
    .eq('period', period)
    .eq('metric', 'ai_ops')
    .maybeSingle();
  return (data as { count?: number } | null)?.count ?? 0;
}

/**
 * Suma una operación de IA. Best-effort: medir NUNCA debe tumbar la petición
 * del usuario. Usa service-role (el usuario no puede escribir su contador).
 */
export async function incrementAiOps(workspaceId: string, delta = 1): Promise<void> {
  try {
    await getDb().rpc('increment_usage', {
      p_workspace_id: workspaceId,
      p_period: currentPeriod(),
      p_metric: 'ai_ops',
      p_delta: delta,
    } as never);
  } catch {
    /* best-effort */
  }
}

/** Tope de nodos indexados (500 free / 50.000 pro). */
export async function assertNodeQuota(db: Db, workspaceId: string): Promise<void> {
  const limits = await limitsFor(db, workspaceId);
  const used = await countNodes(db, workspaceId);
  if (used >= limits.nodes) {
    throw new QuotaError('node_limit_reached', { used, limit: limits.nodes });
  }
}

/**
 * Tope de integraciones conectadas (1 en free: Drive O Gmail O Calendar).
 *
 * `provider` importa: el upsert es por (workspace, provider, cuenta), así que
 * RE-conectar un proveedor que ya tienes es un update y no debe consumir cupo
 * nuevo (si no, un free con Drive no podría re-autorizar Drive).
 */
export async function assertIntegrationQuota(
  db: Db,
  workspaceId: string,
  provider?: NonNullable<IntegrationProvider>,
): Promise<void> {
  const limits = await limitsFor(db, workspaceId);
  if (provider) {
    const { count: sameProvider } = await db
      .from('integrations')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('provider', provider);
    if ((sameProvider ?? 0) > 0) return; // reconexión: no consume cupo
  }
  const used = await countIntegrations(db, workspaceId);
  if (used >= limits.integrations) {
    throw new QuotaError('integration_limit_reached', { used, limit: limits.integrations });
  }
}

/**
 * Tope mensual de IA. Hoy es no-op (aiOpsPerMonth = null en todos los planes):
 * medimos sin cortar. En cuanto se defina un número en PLANS, esto corta solo.
 */
export async function assertAiQuota(db: Db, workspaceId: string): Promise<void> {
  const limits = await limitsFor(db, workspaceId);
  if (limits.aiOpsPerMonth === null) return;
  const used = await getAiOps(db, workspaceId);
  if (used >= limits.aiOpsPerMonth) {
    throw new QuotaError('ai_limit_reached', { used, limit: limits.aiOpsPerMonth });
  }
}
