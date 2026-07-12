# Módulo Configuración

Ruta: `/configuracion` · API: `/api/tenant/settings` · UI: `modules/config/ConfigModule.jsx`

Página de ajustes del tenant. No es un módulo con `moduleKey` propio: la entrada
del sidebar (sección **Ajustes**) es **siempre visible** para cualquier tenant
(como "Inicio"), mediante el flag `always: true` en `components/layout/Sidebar.jsx`.

Su razón de ser principal hoy: dar de alta, en autoservicio, las **claves de IA
por tenant** (BYOK) que consume el módulo Outreach.

---

## Secciones

### 1. Facturación

Reutiliza el endpoint existente `/api/billing/settings` (modelo
`TenantBillingSettings`, fila única por tenant). Muestra y edita los datos
fiscales básicos: razón social, NIF/CIF, dirección, ciudad, CP, país, IVA por
defecto, IRPF por defecto y días de vencimiento. Enlaza a la **configuración
completa** de facturación (`/facturacion/configuracion`) para series, todos los
tipos de IVA, etc.

Solo aparece si el tenant tiene el módulo `billing` (si el GET responde 403, la
sección se oculta).

### 2. Inteligencia Artificial (BYOK)

Dos tarjetas con **alta guiada** de la clave (tutorial de pasos + botón a la
plataforma + campo para pegar la clave), estilo autoservicio con fricción:

| Tarjeta | Clave | La usa | Plataforma |
| ------- | ----- | ------ | ---------- |
| **Anthropic (Claude)** | `anthropicApiKey` | Análisis IA de Outreach (`/analizar`) + resumen/estructura de sesiones clínicas | console.anthropic.com |
| **OpenAI (Whisper)** | `openaiApiKey` | Transcripción de audio de sesiones clínicas (voz → texto) con la API de Whisper | platform.openai.com |
| **Google Cloud (Places)** | `googlePlacesApiKey` | `"Buscar nuevos"` de Google Maps | console.cloud.google.com |
| **Resend (correo captación)** | `resendApiKey` (+ `resendFromEmail`, `resendReplyTo`) | Enviar el correo modelo en frío | resend.com |

> **Transcripción de audio (sesiones clínicas):** Claude NO transcribe audio, así que
> el paso voz→texto lo hace la **API de Whisper de OpenAI** (clave `openaiApiKey`,
> por-tenant, cifrada; resolver `lib/ai/openaiKey.js`). Luego Claude hace el
> resumen/estructura (texto → sesión).

> **Modelo de Claude (selector):** debajo de la clave de Anthropic hay un selector de
> modelo — **Sonnet (por defecto)** · Opus · Haiku. Se guarda en
> `settings.integrations.anthropicModel` (sin cifrar, no es secreto) y se aplica a
> **TODO el CRM** vía `getTenantAnthropicModel(ctx)` (`lib/ai/anthropicModel.js`).
> Sonnet por defecto porque Opus consume muchos más tokens. Lista de modelos
> admitidos: `ANTHROPIC_MODELS` (misma fuente que valida el backend y pinta la UI).

Cada tarjeta muestra estado **Conectada / Sin configurar** con una pista
enmascarada (p.ej. `AIza…1234`), y permite reemplazar o eliminar la clave.

> La sección "Datos del tenant" (nombre, colores, logo) existió y se retiró a
> petición. El endpoint sigue soportando `name` y `brand` por si se reactiva.

---

## Dónde se guardan las claves (y por qué son seguras)

Las claves viven en **`master.tenants.settings.integrations`** (JSONB):

```json
{ "brand": { ... }, "integrations": { "anthropicApiKey": "...", "googlePlacesApiKey": "..." } }
```

Son **secretos**, y se protegen así:

1. **Cifradas en reposo** (AES-256-GCM, `lib/crypto/secretBox.js`) con
   `SETTINGS_ENCRYPTION_KEY` del entorno. En la BD solo hay texto cifrado
   (`enc:v1:…`): un dump o backup filtrado **no sirve** sin esa clave, que nunca
   está en la base de datos. Se cifra al guardar y se descifra al usar.
1. **La API nunca las devuelve en claro.** `GET /api/tenant/settings` devuelve
   solo `{ configured, hint }` por clave (estado + pista corta).
2. **No llegan al cliente.** El layout del dashboard (`app/(dashboard)/layout.jsx`)
   **elimina `settings.integrations`** del tenant antes de serializarlo al
   navegador (es el único punto que pasa el tenant entero al cliente).
3. **Escritura solo admin**, y tras guardar se llama a `invalidateTenantCache`
   para que Outreach vea la clave nueva de inmediato (la caché de tenant dura ~60s).

Consumo desde Outreach:
- `analizar` lee la clave del tenant vía `getTenantAnthropicKey(ctx)`
  (`lib/ai/anthropicKey.js`). **Sin fallback de entorno**: sin clave → `503`.
- `buscar-nuevos` lee la clave de Google del tenant y la **descifra** con
  `decryptSecret` (sin fallback de entorno).

---

## API — `/api/tenant/settings`

| Método | Qué hace |
| ------ | -------- |
| `GET` | Devuelve `{ name, slug, plan, brand, integrations: { anthropic:{configured,hint}, googlePlaces:{configured,hint} } }`. Nunca la clave en claro |
| `PATCH` | **Admin.** Acepta `name`, `brand`, `anthropicApiKey`, `anthropicModel`, `openaiApiKey`, `googlePlacesApiKey`, `resendApiKey` (+ `resendFromEmail`/`resendReplyTo`). Invalida la caché de tenant |

Semántica de las claves en `PATCH`:

- `undefined` → no se toca (permite guardar la marca sin perder la clave).
- `null` o `""` → se borra.
- string → se fija (trim).

No hay migración: `settings` es JSONB, ya existe en `master.tenants`.

---

## Ficheros

- `app/(dashboard)/configuracion/page.jsx` — página (renderiza el módulo).
- `modules/config/ConfigModule.jsx` — UI (facturación + IA + tarjetas de clave).
- `app/api/tenant/settings/route.js` — GET/PATCH, enmascarado y `invalidateTenantCache`.
- `app/(dashboard)/layout.jsx` — elimina `settings.integrations` antes del cliente.
- `components/layout/Sidebar.jsx` — entrada "Configuración" (`always: true`).

---

## Cifrado en reposo (hecho)

Las claves se guardan **cifradas** (AES-256-GCM) con `SETTINGS_ENCRYPTION_KEY`.
Detalle en `lib/crypto/secretBox.js`. Migración para cifrar claves antiguas en
claro: `scripts/encrypt-tenant-secrets.js` (idempotente). Sin la env var, se
guardan en claro (aviso por stderr) — hay que configurarla en el `.env`.

## Pendiente / ideas

- Reactivar "Datos del tenant" (marca/logo) si se necesita edición desde aquí.
- Rotación/re-cifrado de secretos si algún día se rota `SETTINGS_ENCRYPTION_KEY`.
