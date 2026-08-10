# Módulo base: `documents`

> Ficha técnica del **base**. Generada del código el 2026-08-07 (commit `030a35e`).
> Detalle funcional y de negocio en [`docs/modules/documents.md`](../modules/documents.md).

---

## Resumen

Contrato de Prestación de Servicios del centro (básico). Con `documents_avanzado`: carpetas, buscador, subida general y cuota.

## De un vistazo

| | |
| --- | --- |
| **moduleKey** | `documents` |
| **Tenants que lo usan** | (ninguno en local) |
| **Tamaño** | 15 ficheros · 1671 LOC |
| **Overrides hoy** | Ninguno. |

## Ficheros que componen el base

Esto es lo que hay que clonar en una iteración de F2.

### Páginas (1)

```
   40  app/(dashboard)/documentos/page.jsx
```

### Endpoints (9)

```
  223  app/api/documents/route.js
  177  app/api/documents/folders/[id]/route.js
  135  app/api/documents/folders/route.js
   77  app/api/documents/contrato-servicios/route.js
   69  app/api/documents/[id]/route.js
   57  app/api/documents/[id]/preview/route.js
   51  app/api/documents/[id]/download/route.js
   43  app/api/documents/contrato-servicios/download/route.js
   30  app/api/documents/quota/route.js
```

### Componentes (4)

```
  152  components/documents/ContratoServiciosCard.jsx
   96  components/documents/UploadDropzone.jsx
   53  components/documents/PdfPreviewModal.jsx
   26  components/documents/FileTypeIcon.jsx
```

### Módulos UI (1)

```
  442  modules/documents/DocumentsModule.jsx
```

## Puntos de extensión

Sin mecanismo de override hoy: habría que añadir el mapa `UI_OVERRIDES` a su página principal. Ver [`routing-overrides.md`](routing-overrides.md) §6.

## Antes de tocar este módulo

1. Leer [`routing-overrides.md`](routing-overrides.md) — el mecanismo tiene trampas (clave con underscore, carpeta con guión).
2. `hasModule("documents")` en todo endpoint nuevo.
3. Un cambio aquí llega a **todos** los tenants de la lista de arriba, a la vez.
4. El detalle de negocio está en [`docs/modules/documents.md`](../modules/documents.md); si el código y el doc discrepan, **manda el código**: actualiza el doc.
