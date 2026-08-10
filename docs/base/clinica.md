# Módulo base: `clinica`

> Ficha técnica del **base**. Generada del código el 2026-08-07 (commit `030a35e`).
> Detalle funcional y de negocio en [`docs/modules/clinica.md`](../modules/clinica.md).

---

## Resumen

Sesiones clínicas, informes, coordinaciones, talleres y estadísticas del centro. Flujo de audio: Whisper transcribe y Claude estructura. Es el módulo del que `aumenta` es tenant reina.

## De un vistazo

| | |
| --- | --- |
| **moduleKey** | `clinica` |
| **Tenants que lo usan** | aumenta |
| **Tamaño** | 47 ficheros · 6568 LOC |
| **Overrides hoy** | Ninguno. |

## Ficheros que componen el base

Esto es lo que hay que clonar en una iteración de F2.

### Páginas (7)

```
  435  app/(dashboard)/clinica/_components/dummyData.js
  370  app/(dashboard)/clinica/talleres/page.jsx
  312  app/(dashboard)/clinica/estadisticas/page.jsx
  295  app/(dashboard)/clinica/informes/page.jsx
  190  app/(dashboard)/clinica/coordinaciones/page.jsx
  151  app/(dashboard)/clinica/page.jsx
   18  app/(dashboard)/clinica/_components/PreviewBanner.jsx
```

### Endpoints (34)

```
  183  app/api/clinica/incidencias/[id]/route.js
  180  app/api/clinica/performance/route.js
  178  app/api/clinica/performance/config/ai/route.js
  175  app/api/clinica/incidencias/route.js
  165  app/api/clinica/performance/team/route.js
  157  app/api/clinica/performance/planes/route.js
  148  app/api/clinica/reports/[id]/enviar/route.js
  141  app/api/clinica/incentive-items/route.js
  140  app/api/clinica/bandeja/route.js
  120  app/api/clinica/coordinations/route.js
  114  app/api/clinica/performance/me/route.js
  109  app/api/clinica/sessions/[id]/prep-files/route.js
  108  app/api/clinica/incentive-items/[id]/route.js
  108  app/api/clinica/talleres/[id]/route.js
  105  app/api/clinica/reports/[id]/desde-sesiones/route.js
  101  app/api/clinica/sessions/transcribe/route.js
   95  app/api/clinica/derivaciones/route.js
   91  app/api/clinica/performance/config/route.js
   88  app/api/clinica/sessions/[id]/prep-files/[fileId]/route.js
   84  app/api/clinica/sessions/route.js
   81  app/api/clinica/talleres/[id]/inscripciones/route.js
   80  app/api/clinica/performance/approve-all/route.js
   78  app/api/clinica/performance/[id]/route.js
   77  app/api/clinica/productividad/hours/route.js
   73  app/api/clinica/talleres/route.js
   72  app/api/clinica/reports/route.js
   70  app/api/clinica/dashboard/route.js
   70  app/api/clinica/performance/incentive-tiers/route.js
   67  app/api/clinica/overview/route.js
   66  app/api/clinica/reports/[id]/route.js
   62  app/api/clinica/sessions/[id]/route.js
   52  app/api/clinica/estadisticas/export/route.js
   45  app/api/clinica/productividad/route.js
   29  app/api/clinica/estadisticas/route.js
```

### Componentes (6)

```
  314  components/clinica/InformeDrawer.jsx
  248  components/clinica/PatientDocumentsSection.jsx
  238  components/clinica/InterventionPlanSection.jsx
  235  components/clinica/NuevaCoordinacionModal.jsx
  210  components/clinica/PatientExternalContactsSection.jsx
   40  components/clinica/SpecialtyPicker.jsx
```

## Puntos de extensión

Sin mecanismo de override hoy: habría que añadir el mapa `UI_OVERRIDES` a su página principal. Ver [`routing-overrides.md`](routing-overrides.md) §6.

## Antes de tocar este módulo

1. Leer [`routing-overrides.md`](routing-overrides.md) — el mecanismo tiene trampas (clave con underscore, carpeta con guión).
2. `hasModule("clinica")` en todo endpoint nuevo.
3. Un cambio aquí llega a **todos** los tenants de la lista de arriba, a la vez.
4. El detalle de negocio está en [`docs/modules/clinica.md`](../modules/clinica.md); si el código y el doc discrepan, **manda el código**: actualiza el doc.
