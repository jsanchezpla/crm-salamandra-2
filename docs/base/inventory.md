# Módulo base: `inventory`

> Ficha técnica del **base**. Generada del código el 2026-08-07 (commit `030a35e`).
> Detalle funcional y de negocio en [`docs/modules/inventory.md`](../modules/inventory.md).

---

## Resumen

Productos con su unidad, entradas de mercancía con proveedor y stock como SUMA DE MOVIMIENTOS (no hay columna de saldo). Rehecho el 02/08/2026.

## De un vistazo

| | |
| --- | --- |
| **moduleKey** | `inventory` |
| **Tenants que lo usan** | aumenta, demo, spain_enzymes |
| **Tamaño** | 5 ficheros · 871 LOC |
| **Overrides hoy** | Ninguno. |

## Ficheros que componen el base

Esto es lo que hay que clonar en una iteración de F2.

### Páginas (1)

```
  458  app/(dashboard)/inventario/page.jsx
```

### Endpoints (4)

```
  114  app/api/inventory/products/[id]/route.js
  109  app/api/inventory/entries/route.js
  103  app/api/inventory/stock-movements/route.js
   87  app/api/inventory/products/route.js
```

## Puntos de extensión

Sin mecanismo de override hoy: habría que añadir el mapa `UI_OVERRIDES` a su página principal. Ver [`routing-overrides.md`](routing-overrides.md) §6.

## Antes de tocar este módulo

1. Leer [`routing-overrides.md`](routing-overrides.md) — el mecanismo tiene trampas (clave con underscore, carpeta con guión).
2. `hasModule("inventory")` en todo endpoint nuevo.
3. Un cambio aquí llega a **todos** los tenants de la lista de arriba, a la vez.
4. El detalle de negocio está en [`docs/modules/inventory.md`](../modules/inventory.md); si el código y el doc discrepan, **manda el código**: actualiza el doc.
