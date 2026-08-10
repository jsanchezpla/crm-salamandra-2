# Módulo base: `leads`

> Ficha técnica del **base**. Generada del código el 2026-08-07 (commit `030a35e`).
> Detalle funcional y de negocio en [`docs/modules/leads.md`](../modules/leads.md).

---

## Resumen

Embudo comercial por etapas. Es el módulo con más overrides del CRM: cada tenant tiene su propio funnel. Convive con `formularios` (leads de la web) bajo el mismo grupo de menú.

## De un vistazo

| | |
| --- | --- |
| **moduleKey** | `leads` |
| **Tenants que lo usan** | aumenta, demo, nutri_laura, quality_energy, spain_enzymes, abarcaia* |
| **Tamaño** | 12 ficheros · 1732 LOC |
| **Overrides hoy** | **8 overrides**: quality-energy, retorika, aumenta, sandbox, abarcaia, demo, spain-enzymes, nutri-laura. El módulo más personalizado del CRM. |

\* solo en producción.

## Ficheros que componen el base

Esto es lo que hay que clonar en una iteración de F2.

### Páginas (3)

```
  251  app/(dashboard)/comercial/leads/page.jsx
  239  app/(dashboard)/leads/estadisticas/page.jsx
   58  app/(dashboard)/leads/page.jsx
```

### Endpoints (8)

```
  224  app/api/leads/import/excel/route.js
  192  app/api/leads/import/template/route.js
  182  app/api/leads/export/route.js
  141  app/api/leads/route.js
  113  app/api/leads/[id]/route.js
  112  app/api/leads/import/route.js
  110  app/api/leads/[id]/convert-to-project/route.js
   29  app/api/leads/estadisticas/route.js
```

### Módulos UI (1)

```
   81  modules/leads/LeadsModule.jsx
```

## Puntos de extensión

Ya resuelto: `modules/leads/LeadsModule.jsx` es el base y cada tenant clona ese único fichero. Es el modelo a imitar en el resto de módulos.

## Antes de tocar este módulo

1. Leer [`routing-overrides.md`](routing-overrides.md) — el mecanismo tiene trampas (clave con underscore, carpeta con guión).
2. `hasModule("leads")` en todo endpoint nuevo.
3. Un cambio aquí llega a **todos** los tenants de la lista de arriba, a la vez.
4. El detalle de negocio está en [`docs/modules/leads.md`](../modules/leads.md); si el código y el doc discrepan, **manda el código**: actualiza el doc.
