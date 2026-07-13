# ✅ RESUELTO: `next build` de la web fallaba (deploys web congelados ~24 días)

**Estado (13-jul-2026): RESUELTO.** La causa raíz era `node-linker=hoisted` en el
`.npmrc` del root. Se cambió a `node-linker=isolated` (el default de pnpm) y el
`next build` compila. Este doc queda como registro del diagnóstico y la lección.

## TL;DR de la causa y el fix
- **Causa**: `node-linker=hoisted` aplana el `node_modules` del monorepo. Con dos
  majors de React (móvil=18 de Expo, web=19 de Next 15), el árbol plano mezcla las
  copias y el `next build` del web revienta al pre-renderizar `/404`/`/500`
  (`pages/_error`) con "useContext null" / "Objects are not valid as a React child"
  (dos instancias de React: elemento de una, renderer de otra).
- **Fix**: `node-linker=isolated` — cada app resuelve su propia copia de React vía
  symlinks. El web compila (25/25 páginas). NO afecta al móvil (apps/mobile es
  standalone: sin deps `workspace:*`, con su propio `package-lock.json`, EAS lo
  compila con npm sin este `.npmrc`). Red de seguridad para dev local de Metro:
  `apps/mobile/metro.config.js` (resuelve desde app + workspace root).
- **Bonus**: el auto-deploy Git↔Vercel estaba desconectado (los push no disparaban
  build). Reconectar en el dashboard de Vercel; mientras tanto, deploy manual con
  `vercel --prod` desde la RAÍZ del repo (el link vive en `apps/web/.vercel`,
  Root Directory del proyecto = `apps/web`).

## La lección (para otra ocasión)
"Objects are not valid as a React child ({$$typeof… _owner})" o "useContext null"
en el prerender de `/404` = **dos instancias de React**. Si `node_modules` no tiene
copias duplicadas visibles, sospechar del **linker del gestor de paquetes**
(pnpm `node-linker=hoisted` aplanando majors distintos), no solo de las versiones.
Test decisivo: cambiar a `node-linker=isolated` y reconstruir.

---

## (Histórico) Diagnóstico original

## Síntoma exacto

```
✓ Compiled successfully
Generating static pages (0/25) ...
Error occurred prerendering page "/404"
Export encountered an error on /_error: /404, exiting the build.
```

El error concreto varía según la versión de React instalada:
- React 19.x → `TypeError: Cannot read properties of null (reading 'useContext')`
- React 18.3.1 → `Objects are not valid as a React child (found: object with keys
  {$$typeof, type, key, ref, props, _owner})`

Ambos ocurren al pre-renderizar el `/404` sintético de Next (`pages/_error`).
La firma "$$typeof… _owner" es la clásica de **dos instancias de React** (un
elemento creado por una copia de React no lo reconoce el renderer de otra).

## Qué se descartó (probado el 13-jul)

- ❌ **Versión de React**: 18.3.1, 19.0.0 y 19.2.5 — todas fallan.
- ❌ **React duplicado en node_modules**: se deduplicó a UNA sola copia (se quitó
  el `react` de devDeps de `@mycortex/ui` que metía un `packages/ui/node_modules/
  react@19` anidado). Con copia única, sigue fallando.
- ❌ **@sentry/nextjs**: neutralizando `instrumentation-client.ts`, sigue fallando.
- ❌ **Versión de Next**: 15.1.0 y 15.5.15 — ambas fallan.
- ❌ **`app/not-found.tsx` propio**: no reemplaza el `pages/_error` sintético.

## Tensión de fondo (causa raíz probable)

`/.npmrc` tiene `node-linker=hoisted` (necesario para el resolver de Metro del
móvil, `apps/mobile`). Eso obliga a **una sola versión de React en todo el árbol
plano**. Pero:
- `apps/mobile` (Expo SDK 52 / RN 0.76) **requiere React 18.3.1**.
- `apps/web` (Next 15) tenía `react: ^19.0.0` que **flotó a 19.2.5** (~hace 24 días).

Dos majors de React no conviven en un `node_modules` plano → el prerender del
`/404` recibe un React inconsistente. (El override `pnpm.overrides.@types/react
= 18.3.12` en la raíz confirma que la intención era React 18, pero el runtime del
web quedó en 19.)

Además: el **auto-deploy Git↔Vercel parece desconectado** (los `git push` a main
no disparaban build en Vercel; hubo que forzar con `vercel --prod`). El link de
Vercel vive en `apps/web/.vercel` y el proyecto tiene Root Directory = `apps/web`,
así que el CLI debe correr **desde la raíz del repo** con el link copiado ahí.

## Plan recomendado (sesión dedicada)

1. **Stack sin minificar**: identificar el componente exacto que renderiza el
   objeto inválido. Ideas: `next build` con sourcemaps de servidor, o inspeccionar
   `.next/server/pages/_error.js` alrededor del offset del error, o un repro
   mínimo (layout raíz + 1 página) dentro del monorepo.
2. **Aislar el web del `node-linker=hoisted`**: que el web resuelva su propio
   React sin el 18 del móvil. Opciones: mover Metro a otra estrategia (config de
   Metro para deps transitivas en vez de hoisting global), o `pnpm` con
   `packageExtensions`/`.pnpmfile.cjs`, o dependencias directas en el móvil.
3. **Alinear a UNA versión de React** en todo el monorepo (probablemente 18.3.1,
   que ya usan el móvil y el override de @types), y verificar que Next 15 la
   acepte en el prerender.
4. **Reconectar Vercel↔GitHub** en el dashboard (para que los push desplieguen).
   El build debe compilar primero, o cada deploy fallará igual.
5. Con el build en verde: `vercel --prod` desde la raíz (con el link) o un push
   despliega todo el trabajo web pendiente.

## Nota

`next.config.mjs` usa `typescript.ignoreBuildErrors` y `eslint.ignoreDuringBuilds`
(a propósito, por el monorepo). El type-check real corre aparte (`pnpm type-check`,
todos los paquetes en verde). El fallo NO es de tipos: es de runtime en el prerender.
