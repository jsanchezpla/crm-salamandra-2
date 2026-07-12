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
| **Anthropic (Claude)** | `anthropicApiKey` | Análisis IA de Outreach (`/analizar`) | console.anthropic.com |
| **Google Cloud (Places)** | `googlePlacesApiKey` | `"Buscar nuevos"` de Google Maps | console.cloud.google.com |

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

1. **La API nunca las devuelve en claro.** `GET /api/tenant/settings` devuelve
   solo `{ configured, hint }` por clave (estado + pista corta).
2. **No llegan al cliente.** El layout del dashboard (`app/(dashboard)/layout.jsx`)
   **elimina `settings.integrations`** del tenant antes de serializarlo al
   navegador (es el único punto que pasa el tenant entero al cliente).
3. **Escritura solo admin**, y tras guardar se llama a `invalidateTenantCache`
   para que Outreach vea la clave nueva de inmediato (la caché de tenant dura ~60s).

Consumo desde Outreach:
- `analizar` lee `ctx.tenant.settings?.integrations?.anthropicApiKey` (fallback a
  `ANTHROPIC_API_KEY` del entorno).
- `buscar-nuevos` lee `ctx.tenant.settings?.integrations?.googlePlacesApiKey`
  (sin fallback de entorno).

---

## API — `/api/tenant/settings`

| Método | Qué hace |
| ------ | -------- |
| `GET` | Devuelve `{ name, slug, plan, brand, integrations: { anthropic:{configured,hint}, googlePlaces:{configured,hint} } }`. Nunca la clave en claro |
| `PATCH` | **Admin.** Acepta `name`, `brand`, `anthropicApiKey`, `googlePlacesApiKey`. Invalida la caché de tenant |

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

## Pendiente / ideas

- Cifrado en reposo de las claves (hoy en claro en el JSONB, pero nunca salen al
  cliente ni por la API). Placeholder `GOOGLE_TOKEN_ENCRYPTION_KEY` disponible.
- Reactivar "Datos del tenant" (marca/logo) si se necesita edición desde aquí.
