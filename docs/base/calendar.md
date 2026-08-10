# Módulo base: `calendar`

> Ficha técnica del **base**. Generada del código el 2026-08-07 (commit `030a35e`).

---

## Resumen

Calendario general del tenant, distinto de `citas` (que son reservas con profesional, pago y portal).

## De un vistazo

| | |
| --- | --- |
| **moduleKey** | `calendar` |
| **Tenants que lo usan** | aumenta, demo |
| **Tamaño** | 4 ficheros · 1253 LOC |
| **Overrides hoy** | Ninguno. |

## Ficheros que componen el base

Esto es lo que hay que clonar en una iteración de F2.

### Páginas (1)

```
  959  app/(dashboard)/calendario/page.jsx
```

### Endpoints (3)

```
  120  app/api/calendar/reorganize/route.js
   95  app/api/calendar/tasks/route.js
   79  app/api/calendar/tasks/[id]/route.js
```

## Puntos de extensión

Sin mecanismo de override hoy: habría que añadir el mapa `UI_OVERRIDES` a su página principal. Ver [`routing-overrides.md`](routing-overrides.md) §6.

## Antes de tocar este módulo

1. Leer [`routing-overrides.md`](routing-overrides.md) — el mecanismo tiene trampas (clave con underscore, carpeta con guión).
2. `hasModule("calendar")` en todo endpoint nuevo.
3. Un cambio aquí llega a **todos** los tenants de la lista de arriba, a la vez.
