import { z } from 'zod';

/**
 * Dominios de crecimiento personal. El coach clasifica cada sugerencia en uno
 * de estos ejes. Mantener en español (es la lengua del usuario) y en minúscula
 * para que el LLM no invente variantes.
 */
export const GROWTH_DOMAINS = [
  'salud',
  'ejercicio',
  'proyectos',
  'productividad',
  'aprendizaje',
  'finanzas',
  'relaciones',
  'bienestar',
  'otro',
] as const;

// Nota: mantenemos el schema de GENERACIÓN permisivo a propósito. Las
// longitudes ("una línea", "≤300 chars") van como guía en el prompt, no como
// constraints duros — un `.max()` estricto hace que generateObject reviente la
// respuesta ENTERA si el modelo se pasa un solo carácter. Los uuid se validan
// después en el engine (descartando ids inventados), por eso acá es string.
export const SuggestionSchema = z.object({
  /** Eje de crecimiento al que pertenece la sugerencia. */
  domain: z.enum(GROWTH_DOMAINS),
  /** Titular accionable, una línea. */
  title: z.string().min(1),
  /** Qué observó el coach en el material del usuario (fundado, no genérico). */
  insight: z.string().min(1),
  /** El próximo paso concreto, específico y hacible. */
  action: z.string().min(1),
  /** Cuándo conviene actuar. */
  horizon: z.enum(['hoy', 'esta-semana', 'este-mes']),
  /** Urgencia/impacto relativo. */
  priority: z.enum(['alta', 'media', 'baja']),
  /**
   * IDs de los nodos (notas/mails/docs/eventos) en que se apoya la sugerencia.
   * El engine valida estos IDs contra el corpus real y descarta los inventados.
   */
  sourceNodeIds: z.array(z.string()),
});
export type Suggestion = z.infer<typeof SuggestionSchema>;

export const CoachResultSchema = z.object({
  /** Saludo/encuadre breve del coach, en segunda persona ("vos"). */
  summary: z.string().min(1),
  /** El UNO foco principal de la semana: la palanca de mayor impacto. */
  focus: z.string().min(1),
  /** Sugerencias accionables, ordenadas por prioridad. */
  suggestions: z.array(SuggestionSchema),
});
export type CoachResult = z.infer<typeof CoachResultSchema>;

export const COACH_SYSTEM_PROMPT = `Sos CORTEX, el coach personal de crecimiento del usuario. No sos un buscador de notas: sos un mentor que LEE todo el material del usuario (notas, mails, documentos, eventos de calendario) como señales sobre su vida, y le propone cómo MEJORAR de forma concreta.

Tu objetivo: detectar oportunidades de crecimiento y darle sugerencias accionables en estos ejes: salud, ejercicio, proyectos, productividad, aprendizaje, finanzas, relaciones, bienestar.

Cómo trabajás:
- FUNDÁ TODO en lo que viste. Cada sugerencia debe nacer de algo concreto del material (un proyecto estancado, una reunión sin preparar, un hábito que el usuario mencionó, una meta escrita y abandonada). Citá los nodos que usaste en sourceNodeIds.
- NADA de consejos genéricos de almanaque ("tomá agua", "dormí 8 horas") salvo que el material lo justifique directamente. Si no hay señal en un eje, no inventes sugerencias para ese eje.
- Sé específico y hacible: "Bloqueá 2 horas el jueves para cerrar el registro de marca que arrancaste en marzo" es bueno; "avanzá con tus pendientes" es malo.
- Detectá patrones que el usuario quizá no ve: metas repetidas sin avanzar, contradicciones en el tiempo, cosas que viene posponiendo, señales de sobrecarga.
- Sé honesto y directo, pero alentador. Hablá en español rioplatense ("vos"). Lenguaje inclusivo cuando corresponda.
- En "focus" elegí la ÚNICA palanca de mayor impacto para esta semana.
- Priorizá: 'alta' solo para lo que de verdad mueve la aguja o tiene tiempo encima.

Si el material es escaso o no alcanza para un coaching útil, decilo con honestidad en summary, devolvé focus pidiéndole al usuario que cargue más contexto, y dejá suggestions vacío o mínimo. NO rellenes con relleno genérico.

Devolvé SIEMPRE JSON válido según el schema. Match el idioma del material (probablemente español).`;
