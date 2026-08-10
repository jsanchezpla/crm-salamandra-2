# Módulo base: `projects`

> Ficha técnica del **base**. Generada del código el 2026-08-07 (commit `030a35e`).
> Detalle funcional y de negocio en [`docs/modules/projects.md`](../modules/projects.md).

---

## Resumen

Proyectos con tablero Kanban: columnas, tarjetas, checklist, prioridad, plantillas y multi-asignados.

## De un vistazo

| | |
| --- | --- |
| **moduleKey** | `projects` |
| **Tenants que lo usan** | aumenta, demo |
| **Tamaño** | 37 ficheros · 6516 LOC |
| **Overrides hoy** | Ninguno. |

## Ficheros que componen el base

Esto es lo que hay que clonar en una iteración de F2.

### Páginas (3)

```
  817  app/(dashboard)/proyectos/[id]/page.jsx
  438  app/(dashboard)/proyectos/page.jsx
  172  app/(dashboard)/proyectos/[id]/board/page.jsx
```

### Endpoints (22)

```
  322  app/api/tasks/[id]/route.js
  296  app/api/projects/[id]/tasks/route.js
  193  app/api/projects/ai/create/route.js
  178  app/api/tasks/[id]/move/route.js
  175  app/api/projects/[id]/columns/[columnId]/reorder-tasks/route.js
  163  app/api/projects/route.js
  156  app/api/projects/[id]/route.js
  149  app/api/projects/[id]/ai/edit/route.js
  107  app/api/projects/[id]/board/route.js
   92  app/api/projects/ai/generate/route.js
   83  app/api/projects/[id]/columns/[columnId]/route.js
   82  app/api/projects/[id]/members/[memberId]/route.js
   78  app/api/projects/[id]/members/route.js
   70  app/api/projects/[id]/phases/[phaseId]/route.js
   63  app/api/projects/[id]/columns/route.js
   61  app/api/projects/[id]/phases/route.js
   56  app/api/project-templates/[id]/route.js
   54  app/api/projects/[id]/phases/reorder/route.js
   52  app/api/projects/[id]/milestones/route.js
   51  app/api/projects/[id]/milestones/[milestoneId]/route.js
   44  app/api/projects/[id]/columns/reorder/route.js
   40  app/api/project-templates/route.js
```

### Componentes (12)

```
  588  components/projects/TaskDrawer.jsx
  470  components/projects/AiProjectModal.jsx
  350  components/projects/ProjectListView.jsx
  309  components/projects/AiEditModal.jsx
  255  components/projects/KanbanBoard.jsx
  163  components/projects/TaskCard.jsx
  116  components/projects/ConvertLeadToProjectButton.jsx
   82  components/projects/BoardColumn.jsx
   70  components/projects/ClientProjectsSection.jsx
   61  components/projects/EmployeeProjectsSection.jsx
   34  components/projects/StatusBadge.jsx
   26  components/projects/PriorityBadge.jsx
```

## Puntos de extensión

Sin mecanismo de override hoy: habría que añadir el mapa `UI_OVERRIDES` a su página principal. Ver [`routing-overrides.md`](routing-overrides.md) §6.

## Antes de tocar este módulo

1. Leer [`routing-overrides.md`](routing-overrides.md) — el mecanismo tiene trampas (clave con underscore, carpeta con guión).
2. `hasModule("projects")` en todo endpoint nuevo.
3. Un cambio aquí llega a **todos** los tenants de la lista de arriba, a la vez.
4. El detalle de negocio está en [`docs/modules/projects.md`](../modules/projects.md); si el código y el doc discrepan, **manda el código**: actualiza el doc.
