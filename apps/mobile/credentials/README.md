# credentials/ — claves para publicar en tiendas

Esta carpeta guarda la **clave de la cuenta de servicio de Google Play** que usa
`eas submit` para publicar sin tocar la consola.

> ⚠️ La clave JSON está en `.gitignore` — **NUNCA se sube al repo**. Solo este
> README se versiona.

## Qué archivo va aquí

```
credentials/google-play-service-account.json
```

Esta ruta ya está referenciada en `apps/mobile/eas.json` →
`submit.production.android.serviceAccountKeyPath`.

## Cómo obtener esa clave (una sola vez)

1. **Play Console** → https://play.google.com/console → tu cuenta de desarrollador
   ($25 pago único si aún no la tienes).
2. **Crear la app**: nombre `MyCortex`, paquete `com.mycortex.app`, gratis.
3. **Primer envío = manual** (Google no deja publicar la 1ª versión por API):
   Pruebas → **Pruebas internas** → Crear versión → sube el `.aab` que genera
   `eas build --platform android --profile production`. Agrega testers por correo.
4. **Vincular Google Cloud + cuenta de servicio**:
   Play Console → **Configuración → Acceso a la API** → vincular proyecto GCP
   (p. ej. `mycortex-prod`) → **Crear cuenta de servicio** (`eas-play-publisher`)
   → crear **clave JSON** y descargarla.
5. **Permisos**: en Acceso a la API → junto a la cuenta de servicio → **Otorgar
   acceso** → *Ver información de la app* + *Gestionar versiones*. Guardar.
6. **Coloca la clave descargada aquí** como `google-play-service-account.json`.

## De ahí en adelante — publicar una versión nueva

```bash
# 1. Compilar el AAB de producción (versiona solo por EAS: appVersionSource=remote)
eas build --platform android --profile production

# 2. Enviar el último build al track "internal"
eas submit --platform android --profile production --latest
```

## Camino a producción (cuenta nueva de Google)

1. **Pruebas internas** — hasta 100 testers por correo, sin espera. ← empiezas aquí
2. **Pruebas cerradas** — Google exige **12 testers activos por 14 días** antes de
   habilitar producción.
3. **Producción** — público en Play Store, tras el gate anterior + revisión.
