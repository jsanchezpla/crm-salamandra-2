# Módulo base: `cuestionarios` — RETIRADO

> ⚠️ **Ya no es un módulo (10/08/2026).** Sigue siendo una pantalla real
> (`/formacion/cuestionarios`), pero pertenece a **Formación**: sus siete
> endpoints piden `hasModule("training")` y la clave `cuestionarios` no gatea
> nada. Se retiró del catálogo de venta porque nunca separó nada — la puerta era
> `training || cuestionarios`— y porque los datos decían lo contrario de lo que
> parecía: el único tenant con intentos reales (`retorika`, 526 de 65 alumnos)
> **no tenía la clave**, y los dos que sí la tenían iban a 0 y 18.
>
> Esta ficha se conserva porque el código y la tabla `quiz_attempts` no se han
> tocado. Para el detalle funcional, ver [`training.md`](training.md).

> Ficha técnica del **base**. Generada del código el 2026-08-07 (commit `030a35e`).

---

## Resumen

Cuestionarios de TutorLMS. Vive dentro del área de Formación.

## De un vistazo

| | |
| --- | --- |
| **moduleKey** | `cuestionarios` |
| **Tenants que lo usan** | demo |
| **Tamaño** | 6 ficheros · 1446 LOC |
| **Overrides hoy** | Ninguno. |

## Ficheros que componen el base

Esto es lo que hay que clonar en una iteración de F2.

### Páginas (1)

```
    6  app/(dashboard)/cuestionarios/page.jsx
```

### Endpoints (3)

```
  168  app/api/cuestionarios/sync/route.js
   41  app/api/cuestionarios/route.js
   15  app/api/cuestionarios/[id]/route.js
```

### Módulos UI (2)

```
  870  modules/cuestionarios/CuestionariosModule.jsx
  346  modules/cuestionarios/CuestionariosDashboard.jsx
```

## Puntos de extensión

Sin mecanismo de override hoy: habría que añadir el mapa `UI_OVERRIDES` a su página principal. Ver [`routing-overrides.md`](routing-overrides.md) §6.

## Antes de tocar este módulo

1. Leer [`routing-overrides.md`](routing-overrides.md) — el mecanismo tiene trampas (clave con underscore, carpeta con guión).
2. `hasModule("cuestionarios")` en todo endpoint nuevo.
3. Un cambio aquí llega a **todos** los tenants de la lista de arriba, a la vez.
