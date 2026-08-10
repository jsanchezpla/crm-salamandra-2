# Módulo base: `training`

> Ficha técnica del **base**. Generada del código el 2026-08-07 (commit `030a35e`).
> Detalle funcional y de negocio en [`docs/modules/training.md`](../modules/training.md).

---

## Resumen

Cursos, alumnos, empresas, matrículas y cuestionarios. Integración con TutorLMS (WordPress) por webhook HMAC para `retorika`.

## De un vistazo

| | |
| --- | --- |
| **moduleKey** | `training` |
| **Tenants que lo usan** | aumenta, demo, nutri_laura, retorika |
| **Tamaño** | 47 ficheros · 8017 LOC |
| **Overrides hoy** | `aumenta/FormacionOverview.jsx`. ⚠️ La BD dice que nutri_laura tiene uno, pero **el fichero no existe** (H1). |

## Ficheros que componen el base

Esto es lo que hay que clonar en una iteración de F2.

### Páginas (8)

```
 1517  app/(dashboard)/formacion/empresas/[id]/page.jsx
  352  app/(dashboard)/formacion/cursos/page.jsx
  286  app/(dashboard)/formacion/usuarios/page.jsx
  253  app/(dashboard)/formacion/empresas/page.jsx
  211  app/(dashboard)/formacion/alumnos/page.jsx
   29  app/(dashboard)/formacion/page.jsx
   16  app/(dashboard)/formacion/cursos/[id]/page.jsx
   10  app/(dashboard)/formacion/cuestionarios/page.jsx
```

### Endpoints (28)

```
  250  app/api/training/course-registrations/stats/route.js
  243  app/api/training/course-registrations/export/route.js
  242  app/api/training/users/import/route.js
  232  app/api/training/quiz-attempts/stats/route.js
  226  app/api/training/users/import/preview/route.js
  158  app/api/training/users/route.js
  118  app/api/training/companies/[id]/courses/bulk/route.js
  104  app/api/training/users/import/template/route.js
   97  app/api/training/companies/[id]/route.js
   94  app/api/training/companies/route.js
   94  app/api/training/companies/[id]/courses/route.js
   92  app/api/training/course-registrations/route.js
   92  app/api/training/courses/[id]/route.js
   92  app/api/training/enrollments/export/route.js
   90  app/api/training/users/[id]/route.js
   81  app/api/training/users/export/route.js
   68  app/api/training/quiz-attempts/quizzes-list/route.js
   62  app/api/training/sync/route.js
   59  app/api/training/sync-status/route.js
   56  app/api/training/enrollments/route.js
   47  app/api/training/courses/route.js
   47  app/api/training/quiz-attempts/route.js
   42  app/api/training/quiz-attempts/courses-list/route.js
   41  app/api/training/quiz-attempts/companies-list/route.js
   39  app/api/training/users/[id]/restore/route.js
   31  app/api/training/course-registrations/[id]/route.js
   25  app/api/training/companies/[id]/courses/[courseId]/route.js
   16  app/api/training/quiz-attempts/[id]/route.js
```

### Componentes (6)

```
  189  components/training/EditCourseDrawer.jsx
  188  components/training/CreateEmployeeDrawer.jsx
  110  components/training/HardDeleteUserDialog.jsx
   78  components/training/TrainingTable.jsx
   75  components/training/ArchiveUserDialog.jsx
   32  components/training/TrainingBadge.jsx
```

### Módulos UI (5)

```
  531  modules/default/CourseRegistrationsList.jsx
  407  modules/default/CourseRegistrationDetail.jsx
  342  modules/default/CourseRegistrationStats.jsx
  307  modules/default/CursoDetailModule.jsx
  246  modules/training/FormacionOverview.jsx
```

## Puntos de extensión

`FormacionOverview` es la portada y ya tiene override en aumenta. El resto de páginas (cursos, alumnos, empresas) no tienen mecanismo.

## Antes de tocar este módulo

1. Leer [`routing-overrides.md`](routing-overrides.md) — el mecanismo tiene trampas (clave con underscore, carpeta con guión).
2. `hasModule("training")` en todo endpoint nuevo.
3. Un cambio aquí llega a **todos** los tenants de la lista de arriba, a la vez.
4. El detalle de negocio está en [`docs/modules/training.md`](../modules/training.md); si el código y el doc discrepan, **manda el código**: actualiza el doc.
