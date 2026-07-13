import { generateObject, models } from '@mycortex/ai-core';
import type { Db } from '@mycortex/db';
import { z } from 'zod';

/**
 * Puente Going <-> MyCortex: la INTELIGENCIA. Lee las señales de Going que el
 * worker going-bridge ingirió como nodos (external_source='going') y arma un
 * briefing ejecutivo de fundador. No depende de GitHub/gcloud — solo de los
 * nodos ya ingeridos, así la api también puede regenerarlo on-demand.
 */

const BriefingSchema = z.object({
  // Narrativa ejecutiva en markdown (estado del negocio + lo técnico).
  summary: z.string(),
  // Lectura de salud técnica (deploys, CI, incidentes).
  health: z.string(),
  // Riesgos a vigilar (seguridad, costos, estabilidad).
  risks: z.array(z.string()),
  // 1-3 prioridades de fundador para esta semana.
  priorities: z.array(z.string()),
});
export type ExecutiveBriefing = z.infer<typeof BriefingSchema>;

const EXEC_BRIEFING_SYSTEM_PROMPT = `Eres CORTEX, asesor ejecutivo del fundador de Going (THORN AI). Recibes señales recientes del negocio y de su parte técnica (commits, PRs, estados de CI, deploys, incidentes, alertas de seguridad, costos). Escribe un BRIEFING EJECUTIVO para el fundador, que no quiere leer logs sino entender el estado y qué hacer.

Devuelve JSON:
- summary: 1-2 párrafos en markdown. Qué está pasando en Going (negocio + técnico), en lenguaje de fundador, no de ingeniero. Fundado en las señales.
- health: lectura de la salud técnica (¿el CI está roto? ¿hay deploys fallando? ¿incidentes?). Honesta y concreta.
- risks: riesgos a vigilar (seguridad, estabilidad, costos). Lista corta. Si hay credenciales expuestas o seguridad comprometida, va PRIMERO.
- priorities: las 1-3 cosas que el fundador debería priorizar esta semana, en orden.

REGLAS: fundamenta todo en las señales; NO inventes. Si no hay señales suficientes, dilo con honestidad. Español neutro de Ecuador ("tú", nunca voseo). Devuelve SIEMPRE JSON válido.`;

type GoingNode = {
  id: string;
  title: string | null;
  content: string;
  created_at: string;
  external_metadata: Record<string, unknown> | null;
};

function signalLine(n: GoingNode): string {
  const m = (n.external_metadata ?? {}) as Record<string, unknown>;
  const type = (m.type as string | undefined) ?? 'señal';
  const sev = m.severity ? ` sev=${m.severity}` : '';
  return `[${type}${sev}] ${n.created_at.slice(0, 10)} ${n.title ?? ''}\n${n.content.slice(0, 300).replace(/\s+/g, ' ')}`;
}

export async function generateExecutiveBriefing(
  db: Db,
  workspaceId: string,
  userId: string,
  opts: { lookbackDays?: number; maxSignals?: number } = {},
): Promise<{ briefing: ExecutiveBriefing; signalsAnalyzed: number }> {
  const lookbackDays = opts.lookbackDays ?? 14;
  const maxSignals = opts.maxSignals ?? 100;
  const since = new Date(Date.now() - lookbackDays * 24 * 3600_000).toISOString();

  const { data, error } = await db
    .from('nodes')
    .select('id, title, content, created_at, external_metadata')
    .eq('workspace_id', workspaceId)
    .eq('external_source', 'going')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(maxSignals);
  if (error) throw new Error(`briefing_fetch_failed:${error.message}`);
  const nodes = (data ?? []) as GoingNode[];

  let briefing: ExecutiveBriefing;
  if (nodes.length === 0) {
    briefing = {
      summary:
        'Todavía no llegaron señales de Going a tu segundo cerebro. Cuando el puente sincronice deploys, CI, incidentes y seguridad, vas a ver aquí el estado ejecutivo del negocio.',
      health: 'Sin datos.',
      risks: [],
      priorities: ['Conectar el puente Going (worker going-bridge) para empezar a recibir señales.'],
    };
  } else {
    const prompt =
      `Estas son las ${nodes.length} señales recientes de Going (${lookbackDays} días). Arma el briefing ejecutivo.\n\n` +
      nodes.map((n) => `===\n${signalLine(n)}`).join('\n');
    const { object } = await generateObject({
      model: models.reasoner,
      schema: BriefingSchema,
      system: EXEC_BRIEFING_SYSTEM_PROMPT,
      prompt,
      maxTokens: 2500,
    });
    briefing = object;
  }

  // Persistir.
  const { error: insErr } = await db.from('executive_briefings').insert({
    workspace_id: workspaceId,
    user_id: userId,
    summary: briefing.summary,
    health: briefing.health,
    risks: briefing.risks,
    priorities: briefing.priorities,
    signals_analyzed: nodes.length,
  });
  if (insErr) throw new Error(`briefing_insert_failed:${insErr.message}`);

  return { briefing, signalsAnalyzed: nodes.length };
}
