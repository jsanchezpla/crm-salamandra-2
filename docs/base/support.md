# Módulo base: `support`

> Ficha técnica del **base**. Generada del código el 2026-08-07 (commit `030a35e`).
> Detalle funcional y de negocio en [`docs/modules/support.md`](../modules/support.md).

---

## Resumen

Helpdesk del tenant hacia SUS clientes: nº correlativo, hilo con notas internas, SLA, plantillas y portal público.

## De un vistazo

| | |
| --- | --- |
| **moduleKey** | `support` |
| **Tenants que lo usan** | (demo, solo local) |
| **Tamaño** | 18 ficheros · 3450 LOC |
| **Overrides hoy** | Ninguno (mapa vacío). |

## Ficheros que componen el base

Esto es lo que hay que clonar en una iteración de F2.

### Páginas (1)

```
   26  app/(dashboard)/soporte/page.jsx
```

### Endpoints (11)

```
  261  app/api/tickets/[id]/route.js
  211  app/api/tickets/route.js
  165  app/api/tickets/[id]/messages/route.js
  153  app/api/tickets/stats/route.js
  103  app/api/tickets/settings/route.js
   95  app/api/tickets/[id]/ai/route.js
   68  app/api/tickets/categories/[id]/route.js
   63  app/api/tickets/templates/[id]/route.js
   50  app/api/tickets/categories/route.js
   48  app/api/tickets/attachments/[attachmentId]/route.js
   48  app/api/tickets/templates/route.js
```

### Módulos UI (6)

```
  773  modules/support/TicketDetail.jsx
  450  modules/support/SupportConfig.jsx
  415  modules/support/SupportModule.jsx
  270  modules/support/NewTicketModal.jsx
  176  modules/support/SupportReports.jsx
   75  modules/support/supportUi.js
```

## Puntos de extensión

Sin mecanismo de override hoy: habría que añadir el mapa `UI_OVERRIDES` a su página principal. Ver [`routing-overrides.md`](routing-overrides.md) §6.

## Antes de tocar este módulo

1. Leer [`routing-overrides.md`](routing-overrides.md) — el mecanismo tiene trampas (clave con underscore, carpeta con guión).
2. `hasModule("support")` en todo endpoint nuevo.
3. Un cambio aquí llega a **todos** los tenants de la lista de arriba, a la vez.
4. El detalle de negocio está en [`docs/modules/support.md`](../modules/support.md); si el código y el doc discrepan, **manda el código**: actualiza el doc.
