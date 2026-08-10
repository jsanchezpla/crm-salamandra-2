# Módulo base: `nutricion`

> Ficha técnica del **base**. Generada del código el 2026-08-07 (commit `030a35e`).
> Detalle funcional y de negocio en [`docs/modules/nutricion.md`](../modules/nutricion.md).

---

## Resumen

Recetario, alimentos, menús y pautas asignadas a paciente. Módulo del que `nutri_laura` es tenant reina.

## De un vistazo

| | |
| --- | --- |
| **moduleKey** | `nutricion` |
| **Tenants que lo usan** | nutri_laura |
| **Tamaño** | 27 ficheros · 2934 LOC |
| **Overrides hoy** | ⚠️ Las 4 páginas usan el override de nutri-laura **como base por defecto**: este módulo NO tiene base (H3). |

## Ficheros que componen el base

Esto es lo que hay que clonar en una iteración de F2.

### Páginas (4)

```
   22  app/(dashboard)/nutricion/alimentos/page.jsx
   20  app/(dashboard)/nutricion/recetas/page.jsx
   18  app/(dashboard)/nutricion/asignados/page.jsx
   18  app/(dashboard)/nutricion/plantillas/page.jsx
```

### Endpoints (23)

```
  253  app/api/nutricion/plans/route.js
  204  app/api/nutricion/foods/route.js
  183  app/api/nutricion/foods/[id]/route.js
  181  app/api/nutricion/plans/[id]/route.js
  175  app/api/nutricion/recipes/[id]/photo/route.js
  171  app/api/nutricion/recipes/route.js
  158  app/api/nutricion/plans/[id]/meals/reorder/route.js
  155  app/api/nutricion/recipes/[id]/route.js
  151  app/api/nutricion/plans/[id]/reapply-template/route.js
  146  app/api/nutricion/plans/[id]/send-email/route.js
  134  app/api/nutricion/plans/[id]/meals/[mealId]/options/[optionId]/foods/[foodId]/route.js
  124  app/api/nutricion/plans/[id]/assign/route.js
  105  app/api/nutricion/plans/[id]/meals/[mealId]/options/[optionId]/recipes/route.js
  104  app/api/nutricion/plans/[id]/meals/[mealId]/options/[optionId]/route.js
   95  app/api/nutricion/plans/[id]/duplicate/route.js
   85  app/api/nutricion/plans/[id]/meals/[mealId]/route.js
   79  app/api/nutricion/plans/[id]/meals/[mealId]/options/[optionId]/recipes/[pmorId]/route.js
   75  app/api/nutricion/plans/[id]/meals/[mealId]/options/[optionId]/foods/route.js
   69  app/api/nutricion/plans/[id]/meals/[mealId]/options/route.js
   59  app/api/nutricion/plans/[id]/meals/route.js
   58  app/api/nutricion/recipes/facetas/route.js
   48  app/api/nutricion/plans/[id]/pdf/route.js
   44  app/api/nutricion/foods/tags/route.js
```

## Puntos de extensión

⚠️ Bloqueado: hay que extraer un base antes de poder clonar nada (H3).

## Antes de tocar este módulo

1. Leer [`routing-overrides.md`](routing-overrides.md) — el mecanismo tiene trampas (clave con underscore, carpeta con guión).
2. `hasModule("nutricion")` en todo endpoint nuevo.
3. Un cambio aquí llega a **todos** los tenants de la lista de arriba, a la vez.
4. El detalle de negocio está en [`docs/modules/nutricion.md`](../modules/nutricion.md); si el código y el doc discrepan, **manda el código**: actualiza el doc.
