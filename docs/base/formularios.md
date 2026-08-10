# Módulo base: `formularios`

> Ficha técnica del **base**. Generada del código el 2026-08-07 (commit `030a35e`).
> Detalle funcional y de negocio en [`docs/modules/formularios.md`](../modules/formularios.md).

---

## Resumen

«Leads Comerciales»: formularios públicos → bandeja de aceptación → ficha. **Requiere `leads`**: una bandeja sin embudo donde caer no es un producto.

## De un vistazo

| | |
| --- | --- |
| **moduleKey** | `formularios` |
| **Tenants que lo usan** | nutri_laura |
| **Tamaño** | 5 ficheros · 997 LOC |
| **Overrides hoy** | Ninguno (mapa vacío). |

## Ficheros que componen el base

Esto es lo que hay que clonar en una iteración de F2.

### Páginas (1)

```
   23  app/(dashboard)/formularios/page.jsx
```

### Endpoints (3)

```
  217  app/api/formularios/[id]/accept/route.js
  124  app/api/formularios/[id]/route.js
   68  app/api/formularios/route.js
```

### Módulos UI (1)

```
  565  modules/formularios/FormulariosModule.jsx
```

## Puntos de extensión

Sin mecanismo de override hoy: habría que añadir el mapa `UI_OVERRIDES` a su página principal. Ver [`routing-overrides.md`](routing-overrides.md) §6.

## Antes de tocar este módulo

1. Leer [`routing-overrides.md`](routing-overrides.md) — el mecanismo tiene trampas (clave con underscore, carpeta con guión).
2. `hasModule("formularios")` en todo endpoint nuevo.
3. Un cambio aquí llega a **todos** los tenants de la lista de arriba, a la vez.
4. El detalle de negocio está en [`docs/modules/formularios.md`](../modules/formularios.md); si el código y el doc discrepan, **manda el código**: actualiza el doc.
