# Módulo base: `pacientes`

> Ficha técnica del **base**. Generada del código el 2026-08-07 (commit `030a35e`).
> Detalle funcional y de negocio en [`docs/modules/pacientes.md`](../modules/pacientes.md).

---

## Resumen

Pacientes del centro clínico, distintos del Cliente (que es la familia que paga). CRUD e historial. Va siempre acompañado de `clinica`.

## De un vistazo

| | |
| --- | --- |
| **moduleKey** | `pacientes` |
| **Tenants que lo usan** | aumenta |
| **Tamaño** | 15 ficheros · 3100 LOC |
| **Overrides hoy** | Ninguno. |

## Ficheros que componen el base

Esto es lo que hay que clonar en una iteración de F2.

### Páginas (4)

```
  890  app/(dashboard)/pacientes/[id]/page.jsx
  423  app/(dashboard)/pacientes/[id]/sesiones/nueva/page.jsx
  359  app/(dashboard)/pacientes/_components/dummyData.js
  340  app/(dashboard)/pacientes/page.jsx
```

### Endpoints (11)

```
  169  app/api/pacientes/route.js
  168  app/api/pacientes/[id]/plan/route.js
  157  app/api/pacientes/[id]/route.js
  134  app/api/pacientes/[id]/documents/route.js
  115  app/api/pacientes/[id]/contactos/route.js
   97  app/api/pacientes/[id]/contactos/[contactoId]/route.js
   64  app/api/pacientes/contract-template/route.js
   56  app/api/pacientes/[id]/contract/route.js
   49  app/api/pacientes/[id]/documents/[docId]/download/route.js
   45  app/api/pacientes/contract-template/download/route.js
   34  app/api/pacientes/[id]/documents/[docId]/route.js
```

## Puntos de extensión

Sin mecanismo de override hoy: habría que añadir el mapa `UI_OVERRIDES` a su página principal. Ver [`routing-overrides.md`](routing-overrides.md) §6.

## Antes de tocar este módulo

1. Leer [`routing-overrides.md`](routing-overrides.md) — el mecanismo tiene trampas (clave con underscore, carpeta con guión).
2. `hasModule("pacientes")` en todo endpoint nuevo.
3. Un cambio aquí llega a **todos** los tenants de la lista de arriba, a la vez.
4. El detalle de negocio está en [`docs/modules/pacientes.md`](../modules/pacientes.md); si el código y el doc discrepan, **manda el código**: actualiza el doc.
