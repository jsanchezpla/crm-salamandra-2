# Módulo base: `analytics`

> Ficha técnica del **base**. Generada del código el 2026-08-07 (commit `030a35e`).
> Detalle funcional y de negocio en [`docs/modules/analytics.md`](../modules/analytics.md).

---

## Resumen

Analítica de visitas web. Reincorporado al menú el 2026-07-31, cuando por fin tuvo página y endpoint.

## De un vistazo

| | |
| --- | --- |
| **moduleKey** | `analytics` |
| **Tenants que lo usan** | spain_enzymes* |
| **Tamaño** | 4 ficheros · 912 LOC |
| **Overrides hoy** | Ninguno. |

\* solo en producción.

## Ficheros que componen el base

Esto es lo que hay que clonar en una iteración de F2.

### Páginas (1)

```
   25  app/(dashboard)/analiticas/page.jsx
```

### Endpoints (1)

```
  218  app/api/analiticas/route.js
```

### Módulos UI (2)

```
  649  modules/analytics/AnaliticasModule.jsx
   20  modules/analytics/worldMap.js
```

## Puntos de extensión

Sin mecanismo de override hoy: habría que añadir el mapa `UI_OVERRIDES` a su página principal. Ver [`routing-overrides.md`](routing-overrides.md) §6.

## Antes de tocar este módulo

1. Leer [`routing-overrides.md`](routing-overrides.md) — el mecanismo tiene trampas (clave con underscore, carpeta con guión).
2. `hasModule("analytics")` en todo endpoint nuevo.
3. Un cambio aquí llega a **todos** los tenants de la lista de arriba, a la vez.
4. El detalle de negocio está en [`docs/modules/analytics.md`](../modules/analytics.md); si el código y el doc discrepan, **manda el código**: actualiza el doc.
