# MyCortex — Roadmap de inteligencia

> Norte (Rubén, 14-jun-2026): MyCortex **no es PKM** (no es Notion ni Obsidian).
> Es un **coach proactivo de crecimiento personal** que sugiere mejoras en salud,
> ejercicio, proyectos y productividad, fundadas en tu material — y te ayuda a
> ejecutarlas. No te ayuda a *guardar* notas; te ayuda a *mejorar tu vida*.

## La idea central: el loop

Hoy Coach, Agenda y Productividad son silos sueltos y poco conectados. El salto
no es engordar cada uno por separado, sino **conectarlos en un loop** que ninguna
app de notas hace:

```
  🎯 Coach detecta  →  ✅ Productividad lo vuelve tarea  →  📅 Agenda lo agenda
        ↑                                                              │
        └──────────────  🔁 Seguimiento cierra el ciclo  ←────────────┘
```

De "te da consejos" a "detecta → agenda → te hace cumplir".

---

## Fase 1 — El loop (en curso)

| Pieza | Qué es | Estado | Toca prod? |
|---|---|---|---|
| **Coach v1** | Sugerencias on-demand por dominio de vida, fundadas + citadas | ✅ enviado (`/coach/suggestions`, `/app/coach`) | no |
| **Agenda + prep** | Vista de agenda + brief automático antes de cada reunión (RAG) | 🚧 en construcción | no (solo lectura) |
| **Capa de tareas** | Action items extraídos → tablero todo/haciendo/hecho | 🚧 código + migración (sin aplicar) | sí (tabla `tasks`) |
| **Coach proactivo** | Worker semanal que genera, persiste y empuja sugerencias | 🚧 código + migración (sin aplicar) | sí (tabla `coach_suggestions`) |
| **Seguimiento** | El coach recuerda lo que sugirió y pregunta si avanzaste | ⏳ tras persistencia | sí |

> Migraciones nuevas (`tasks`, `coach_suggestions`) quedan como **archivos sin
> aplicar** hasta OK explícito de Rubén — tocan la base de producción.

## Fase 2 — Profundidad

- **Memoria episódica / diario automático** — tendencias en el tiempo ("tu foco bajó 2 semanas").
- **Detección de sobrecarga / ánimo** — del tono + carga de agenda; ajusta el tono, sugiere frenar.
- **Salud/ejercicio con datos reales** — Google Fit / Apple Health / wearable (hoy es un hueco).
- **Perfil que aprende** — deja de re-derivar tu vida en cada corrida.

## Fase 3 — Canal

- **Coach por voz / Telegram / WhatsApp** — le hablás "¿cómo voy?" y responde (Whisper + TTS + bot ya existen).
- **Nudges contextuales** — el empujón justo (mañana / antes de reunión / cierre del día) sin abrir la app.

## Fase 4 — Estructura

- **Grafo navegable de entidades** — personas/proyectos/empresas + backlinks ("mostrame todo sobre X").
- **Briefings por proyecto** — estado vivo de THORN AI / Going / MyCortex.
- **Puente Going ↔ MyCortex** — cerebro ejecutivo del negocio: ya le llegan deploys, incidentes y alertas de seguridad de Going; que coachee sobre la empresa, no solo sobre la persona.

---

## Notas técnicas (para quien construya)

- El motor de IA está sobre Vercel AI SDK v4. `generateObject` con Claude revienta
  la respuesta entera si el schema tiene `.max()` estrictos o `.uuid()`; mantener
  permisivo y validar después. `maxTokens` chico → `NoObjectGeneratedError`.
- `enum node_category` = going/personal/urgent/unknown (legado). NO sirve para
  dominios de vida; se derivan con LLM.
- Engines de inteligencia van como funciones puras (db + workspaceId) reutilizables
  por API y por workers proactivos. Ver `apps/api/src/modules/coach/engine.ts`.
- Validación anti-alucinación: descartar siempre IDs de nodos citados que no estén
  en el corpus enviado (patrón de `workers/cortex-alerts`).
