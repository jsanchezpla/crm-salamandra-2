# Módulo base: `team`

> Ficha técnica del **base**. Generada del código el 2026-08-07 (commit `030a35e`).
> Detalle funcional y de negocio en [`docs/modules/team.md`](../modules/team.md).

---

## Resumen

Plantilla, altas, usuarios del CRM, roles y accesos por módulo. Con `team_avanzado` se añaden Desempeño, Dirección, Productividad, Incidencias, Bandeja, Ocupación y Actividad.

## De un vistazo

| | |
| --- | --- |
| **moduleKey** | `team` |
| **Tenants que lo usan** | aumenta, demo, nutri_laura |
| **Tamaño** | 30 ficheros · 6431 LOC |
| **Overrides hoy** | Ninguno. |

## Ficheros que componen el base

Esto es lo que hay que clonar en una iteración de F2.

### Páginas (14)

```
  792  app/(dashboard)/equipo/page.jsx
  680  app/(dashboard)/equipo/desempeno-config/page.jsx
  578  app/(dashboard)/equipo/direccion/page.jsx
  323  app/(dashboard)/equipo/_components/IncidenciaModal.jsx
  252  app/(dashboard)/equipo/_components/PerformanceEditor.jsx
  246  app/(dashboard)/equipo/productividad/page.jsx
  241  app/(dashboard)/equipo/mi-desempeno/page.jsx
  226  app/(dashboard)/equipo/actividad/page.jsx
  223  app/(dashboard)/equipo/ocupacion/page.jsx
  220  app/(dashboard)/equipo/_components/IncentiveItemsEditor.jsx
  163  app/(dashboard)/equipo/incidencias/page.jsx
  157  app/(dashboard)/equipo/bandeja/page.jsx
  153  app/(dashboard)/equipo/_components/IncentiveTiersEditor.jsx
   35  app/(dashboard)/equipo/_components/performanceIcons.jsx
```

### Endpoints (12)

```
  320  app/api/team/[id]/route.js
  297  app/api/team/[id]/access/route.js
  260  app/api/team/route.js
  125  app/api/team/[id]/modules/route.js
  112  app/api/team/me/documents/route.js
   90  app/api/team/[id]/hours/route.js
   81  app/api/team/me/documents/[id]/route.js
   68  app/api/team/[id]/access/password/route.js
   42  app/api/team/[id]/projects/route.js
   34  app/api/team/[id]/billing-summary/route.js
   31  app/api/team/me/route.js
   29  app/api/team/modules/route.js
```

### Componentes (4)

```
  261  components/team/AccessSection.jsx
  204  components/team/MiEquipo.jsx
  113  components/team/TeamHoursEditor.jsx
   75  components/team/CredentialsModal.jsx
```

## Puntos de extensión

Sin mecanismo de override hoy: habría que añadir el mapa `UI_OVERRIDES` a su página principal. Ver [`routing-overrides.md`](routing-overrides.md) §6.

## Antes de tocar este módulo

1. Leer [`routing-overrides.md`](routing-overrides.md) — el mecanismo tiene trampas (clave con underscore, carpeta con guión).
2. `hasModule("team")` en todo endpoint nuevo.
3. Un cambio aquí llega a **todos** los tenants de la lista de arriba, a la vez.
4. El detalle de negocio está en [`docs/modules/team.md`](../modules/team.md); si el código y el doc discrepan, **manda el código**: actualiza el doc.
