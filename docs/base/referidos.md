# Módulo base: `referidos`

> Ficha técnica del **base**. Generada del código el 2026-08-07 (commit `030a35e`).

---

## Resumen

Programa de referidos por formulario público. El módulo más pequeño del CRM (95 LOC).

## De un vistazo

| | |
| --- | --- |
| **moduleKey** | `referidos` |
| **Tenants que lo usan** | abarcaia* |
| **Tamaño** | 3 ficheros · 95 LOC |
| **Overrides hoy** | Ninguno. |

\* solo en producción.

## Ficheros que componen el base

Esto es lo que hay que clonar en una iteración de F2.

### Páginas (1)

```
   14  app/(dashboard)/referidos/page.jsx
```

### Endpoints (2)

```
   46  app/api/referidos/route.js
   35  app/api/referidos/[id]/route.js
```

## Puntos de extensión

Sin mecanismo de override hoy: habría que añadir el mapa `UI_OVERRIDES` a su página principal. Ver [`routing-overrides.md`](routing-overrides.md) §6.

## Antes de tocar este módulo

1. Leer [`routing-overrides.md`](routing-overrides.md) — el mecanismo tiene trampas (clave con underscore, carpeta con guión).
2. `hasModule("referidos")` en todo endpoint nuevo.
3. Un cambio aquí llega a **todos** los tenants de la lista de arriba, a la vez.
