import { generateObject, models } from '@mycortex/ai-core';
import { meterAi } from '@mycortex/db';
import type { Db } from '@mycortex/db';
import { z } from 'zod';

/**
 * Revisión del backlog: "conectas tu correo y en 2 minutos te digo las
 * conversaciones que murieron sin respuesta tuya".
 *
 * Es la pieza de onboarding que acerca MyCortex a "indispensable": el primer
 * día debe encontrar algo que se te cayó (una cotización, un cliente esperando)
 * y devolver ese valor antes de pedir nada.
 *
 * Dos filtros, en orden de costo (lección de cortex-alerts: no gastar LLM en
 * ruido evidente):
 *   1. Remitente (dato duro, gratis) — descarta máquinas y envíos masivos.
 *   2. Haiku (barato) — de lo que sobrevive, decide qué es una PERSONA real
 *      esperando una respuesta concreta vs. un boletín con nombre humano.
 *
 * "Sin respuesta" = un hilo con al menos un INBOX y NINGÚN mensaje SENT tuyo.
 * Si contestaste alguna vez en el hilo, no es backlog.
 */

// Remitentes-máquina y envíos masivos. Deliberadamente ancho pero NO toca
// dominios de banca/facturación legítimos por su nombre (ahí puede haber acción
// real): filtramos por marcadores de automatización/marketing, no por sector.
const NOISE_SENDER =
  /no-?reply|nore?ply|do-?not-?reply|not{1,2}ifica|notification|newsletter|mailer|mailchimp|sendgrid|marketing|promo(?:ción|tion|s)?|bounce|updates?@|news@|hello@|team@|info@|@.*\.(?:mailer|email|mktg)\b|substack\.com|automated/i;

export function isNoiseSender(from: string): boolean {
  return NOISE_SENDER.test(from);
}

type MailNode = {
  gmail_thread_id: string;
  from: string;
  to: string;
  subject: string;
  date: string; // header RFC 2822
  labels: string[];
  snippet: string;
};

export type BacklogThread = {
  threadId: string;
  subject: string;
  from: string;
  fromName: string;
  lastDate: string; // ISO
  ageDays: number;
  messageCount: number;
  category: 'cliente' | 'proveedor' | 'personal' | 'tramite' | 'otro';
  reason: string; // por qué merece respuesta (1 línea)
  suggestedReply: string; // primer paso concreto
};

function nameOf(from: string): string {
  const m = from.match(/^"?([^"<]+?)"?\s*</);
  return (m?.[1] ?? from.replace(/<.*/, '')).trim();
}

function parseDate(raw: string): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Agrupa los nodos-correo en hilos y devuelve solo los que están sin respuesta
 * y no son ruido evidente. Puro cómputo — no llama al LLM.
 */
function unansweredThreads(mails: MailNode[]): { threadId: string; msgs: MailNode[]; last: MailNode }[] {
  const byThread = new Map<string, MailNode[]>();
  for (const m of mails) {
    const arr = byThread.get(m.gmail_thread_id) ?? [];
    arr.push(m);
    byThread.set(m.gmail_thread_id, arr);
  }
  const out: { threadId: string; msgs: MailNode[]; last: MailNode }[] = [];
  for (const [threadId, msgs] of byThread) {
    const hasInbox = msgs.some((m) => m.labels.includes('INBOX'));
    const iReplied = msgs.some((m) => m.labels.includes('SENT'));
    if (!hasInbox || iReplied) continue;
    // Último mensaje entrante del hilo (por fecha).
    const sorted = [...msgs].sort(
      (a, b) => (parseDate(a.date)?.getTime() ?? 0) - (parseDate(b.date)?.getTime() ?? 0),
    );
    const last = sorted[sorted.length - 1]!;
    if (isNoiseSender(last.from)) continue;
    out.push({ threadId, msgs: sorted, last });
  }
  return out;
}

const ReviewSchema = z.object({
  items: z.array(
    z.object({
      threadId: z.string(),
      // El modelo marca si de verdad merece respuesta; filtramos por esto.
      needsReply: z.boolean(),
      category: z.enum(['cliente', 'proveedor', 'personal', 'tramite', 'otro']),
      reason: z.string().min(1),
      suggestedReply: z.string().min(1),
    }),
  ),
});

const BACKLOG_SYSTEM = `Eres CORTEX, asistente personal. Recibes HILOS de correo que le llegaron al usuario y a los que NUNCA respondió. Tu trabajo: separar las conversaciones donde una PERSONA REAL espera una respuesta concreta del usuario, del ruido que solo parece personal (boletines firmados por una persona, marketing con nombre propio, avisos automáticos, "webinars", promociones).

Para CADA hilo decide needsReply:
- true SOLO si es un ser humano identificable escribiéndole al usuario y esperando algo de él: una cotización, una respuesta a una pregunta, confirmar una reunión, un trámite, una decisión. Correo de trabajo o personal real.
- false para: newsletters (aunque los firme una persona), marketing/promos, "te extrañamos", invitaciones a webinars/eventos masivos, avisos de productos, notificaciones de plataformas, "aprovecha el descuento".

- false también para POSIBLES ESTAFAS: desconocidos preguntando por la disponibilidad/precio de un producto que el usuario NO vende (p. ej. electrónica, un iPad, un auto) cuando el negocio del usuario es otro; ofertas de pago por adelantado; "sigo interesado en tu artículo"; mensajes en idioma extranjero de un remitente desconocido sobre una compra. Es el patrón clásico de fraude de marketplace. needsReply=false.

Ante la duda, needsReply=false. Es peor llenar el backlog de ruido que perder un caso dudoso.

category: cliente | proveedor | personal | tramite | otro.
reason: 1 frase, por qué espera respuesta (concreto: "pide cotización de X", "espera confirmar reunión del Y").
suggestedReply: el primer paso concreto en 1 frase, en español neutro de Ecuador con "tú" (nunca voseo). Ej: "Responde con la tarifa de 12 pasajeros GYE-CUE."

Devuelve SIEMPRE el array items con TODOS los hilos recibidos (cada uno con su needsReply). No inventes threadId: usa exactamente los que recibes.`;

export type BacklogReview = {
  threadsScanned: number;
  noiseFiltered: number;
  reviewed: number;
  backlog: BacklogThread[];
};

/**
 * Ejecuta la revisión del backlog de correo de un workspace.
 * @param lookbackDays ventana de antigüedad de los correos a considerar.
 */
export async function reviewEmailBacklog(
  db: Db,
  workspaceId: string,
  opts: { lookbackDays?: number; maxThreads?: number } = {},
): Promise<BacklogReview> {
  const lookbackDays = opts.lookbackDays ?? 120;
  const maxThreads = opts.maxThreads ?? 60;
  const since = new Date(Date.now() - lookbackDays * 24 * 3600_000).toISOString();

  const { data, error } = await db
    .from('nodes')
    .select('content, external_metadata')
    .eq('workspace_id', workspaceId)
    .eq('external_source', 'gmail')
    .gte('created_at', since)
    .limit(2000);
  if (error) throw new Error(`backlog_fetch_failed:${error.message}`);

  const mails: MailNode[] = [];
  for (const row of data ?? []) {
    const m = (row.external_metadata ?? {}) as Record<string, unknown>;
    const threadId = m.gmail_thread_id as string | undefined;
    if (!threadId) continue;
    mails.push({
      gmail_thread_id: threadId,
      from: (m.from as string) ?? '',
      to: (m.to as string) ?? '',
      subject: (m.subject as string) ?? '(sin asunto)',
      date: (m.date as string) ?? '',
      labels: Array.isArray(m.labels) ? (m.labels as string[]) : [],
      snippet: (row.content as string | null)?.slice(0, 300).replace(/\s+/g, ' ') ?? '',
    });
  }

  const allThreads = new Set(mails.map((m) => m.gmail_thread_id)).size;
  const candidates = unansweredThreads(mails);
  // Hilos que NO llegan al LLM: respondidos, sin INBOX, o remitente-ruido.
  const noiseFiltered = allThreads - candidates.length;

  // Un solo hilo por threadId para el LLM (el último entrante representa el hilo).
  const forLlm = candidates.slice(0, maxThreads);
  if (forLlm.length === 0) {
    return { threadsScanned: allThreads, noiseFiltered, reviewed: 0, backlog: [] };
  }

  // Por LOTES, no los 60 hilos de un saque. Misma razón que en entities.ts:
  // en una sola llamada el modelo debe emitir un objeto por hilo, se pasa del
  // tope de salida, el JSON sale cortado (AI_NoObjectGeneratedError) y se pierde
  // TODO el backlog. Con lotes la salida cabe y un lote caído solo se lleva lo
  // suyo.
  const CHUNK = 15;
  const reviewed: z.infer<typeof ReviewSchema>['items'] = [];
  let failedChunks = 0;
  for (let i = 0; i < forLlm.length; i += CHUNK) {
    const chunk = forLlm.slice(i, i + CHUNK);
    const prompt =
      `Revisa estos ${chunk.length} hilos sin responder. Devuelve items con needsReply para cada uno.\n\n` +
      chunk
        .map(
          ({ threadId, msgs, last }) =>
            `=== threadId=${threadId} (${msgs.length} msg)\n` +
            `De: ${last.from}\nAsunto: ${last.subject}\n${last.snippet}`,
        )
        .join('\n\n');
    try {
      const { object, usage } = await generateObject({
        model: models.reasoner,
        schema: ReviewSchema,
        system: BACKLOG_SYSTEM,
        prompt,
        maxTokens: 4000,
      });
      void meterAi(db, workspaceId, models.reasoner.modelId, usage);
      reviewed.push(...object.items);
    } catch {
      failedChunks++;
    }
  }
  void failedChunks;

  const byId = new Map(forLlm.map((t) => [t.threadId, t]));
  const now = Date.now();
  const backlog: BacklogThread[] = [];
  for (const item of reviewed) {
    if (!item.needsReply) continue;
    const t = byId.get(item.threadId);
    if (!t) continue;
    const d = parseDate(t.last.date);
    backlog.push({
      threadId: t.threadId,
      subject: t.last.subject,
      from: t.last.from,
      fromName: nameOf(t.last.from),
      lastDate: d ? d.toISOString() : t.last.date,
      ageDays: d ? Math.floor((now - d.getTime()) / 86_400_000) : 0,
      messageCount: t.msgs.length,
      category: item.category,
      reason: item.reason,
      suggestedReply: item.suggestedReply,
    });
  }
  // Más viejo primero: lo que lleva más tiempo colgando es lo más urgente.
  backlog.sort((a, b) => b.ageDays - a.ageDays);

  return {
    threadsScanned: allThreads,
    noiseFiltered,
    reviewed: forLlm.length,
    backlog,
  };
}
