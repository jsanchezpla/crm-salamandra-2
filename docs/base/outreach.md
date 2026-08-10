# Módulo base: `outreach`

> Ficha técnica del **base**. Generada del código el 2026-08-07 (commit `030a35e`).
> Detalle funcional y de negocio en [`docs/modules/outreach.md`](../modules/outreach.md).

---

## Resumen

Captación: empresas encontradas y puntuadas con IA (Claude), por línea de negocio y sector. **`OutreachLead` no es `Lead`**: el primero es una empresa sin contactar, el segundo una oportunidad comercial. Sin FK entre ellos.

## De un vistazo

| | |
| --- | --- |
| **moduleKey** | `outreach` |
| **Tenants que lo usan** | (ninguno en local) |
| **Tamaño** | 21 ficheros · 3479 LOC |
| **Overrides hoy** | Ninguno. |

## Ficheros que componen el base

Esto es lo que hay que clonar en una iteración de F2.

### Páginas (3)

```
    9  app/(dashboard)/outreach/[id]/page.jsx
    8  app/(dashboard)/outreach/configuracion/page.jsx
    8  app/(dashboard)/outreach/page.jsx
```

### Endpoints (11)

```
  228  app/api/outreach/leads/buscar-nuevos/route.js
  161  app/api/outreach/leads/[id]/analizar/route.js
  143  app/api/outreach/leads/route.js
  129  app/api/outreach/leads/[id]/enviar-correo/route.js
  126  app/api/outreach/leads/[id]/route.js
  101  app/api/outreach/leads/[id]/convertir-cliente/route.js
   73  app/api/outreach/business-lines/[id]/route.js
   65  app/api/outreach/business-lines/route.js
   58  app/api/outreach/settings/route.js
   57  app/api/outreach/leads/bulk-delete/route.js
   19  app/api/outreach/google-usage/route.js
```

### Módulos UI (7)

```
  772  modules/outreach/OutreachLeadDetail.jsx
  756  modules/outreach/OutreachModule.jsx
  490  modules/outreach/OutreachSettingsModule.jsx
  132  modules/outreach/SectorPicker.jsx
   51  modules/outreach/scores.js
   49  modules/outreach/useIntegrations.js
   44  modules/outreach/IntegrationGate.jsx
```

## Puntos de extensión

Sin mecanismo de override hoy: habría que añadir el mapa `UI_OVERRIDES` a su página principal. Ver [`routing-overrides.md`](routing-overrides.md) §6.

## Antes de tocar este módulo

1. Leer [`routing-overrides.md`](routing-overrides.md) — el mecanismo tiene trampas (clave con underscore, carpeta con guión).
2. `hasModule("outreach")` en todo endpoint nuevo.
3. Un cambio aquí llega a **todos** los tenants de la lista de arriba, a la vez.
4. El detalle de negocio está en [`docs/modules/outreach.md`](../modules/outreach.md); si el código y el doc discrepan, **manda el código**: actualiza el doc.
