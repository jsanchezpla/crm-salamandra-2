# Módulo base: `orders`

> Ficha técnica del **base**. Generada del código el 2026-08-07 (commit `030a35e`).

---

## Resumen

Pedidos de cliente con su configuración. Descuenta stock si el tenant tiene `inventory`.

## De un vistazo

| | |
| --- | --- |
| **moduleKey** | `orders` |
| **Tenants que lo usan** | aumenta, spain_enzymes |
| **Tamaño** | 7 ficheros · 1562 LOC |
| **Overrides hoy** | Ninguno. |

## Ficheros que componen el base

Esto es lo que hay que clonar en una iteración de F2.

### Páginas (3)

```
  592  app/(dashboard)/pedidos/[id]/page.jsx
  283  app/(dashboard)/pedidos/page.jsx
  168  app/(dashboard)/pedidos/configuracion/page.jsx
```

### Endpoints (4)

```
  196  app/api/orders/[id]/complete/route.js
  144  app/api/orders/[id]/route.js
  123  app/api/orders/route.js
   56  app/api/orders/settings/route.js
```

## Puntos de extensión

Sin mecanismo de override hoy: habría que añadir el mapa `UI_OVERRIDES` a su página principal. Ver [`routing-overrides.md`](routing-overrides.md) §6.

## Antes de tocar este módulo

1. Leer [`routing-overrides.md`](routing-overrides.md) — el mecanismo tiene trampas (clave con underscore, carpeta con guión).
2. `hasModule("orders")` en todo endpoint nuevo.
3. Un cambio aquí llega a **todos** los tenants de la lista de arriba, a la vez.
