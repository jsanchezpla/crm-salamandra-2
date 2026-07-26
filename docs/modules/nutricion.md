# Módulo Nutrición (Recetario)

Estado: **Sprint Recetario cerrado en local 2026-06-24. C1+C2+C3 en
producción. C4+C5 pendientes de despliegue.**

> **REWORK SEMANA REAL (2026-07-22, decisión de producto Rodrigo+Jorge).**
> Anula parcialmente lo descrito más abajo; en caso de conflicto prevalece esto
> (y en última instancia el código):
>
> - **La semana existe en el modelo**: `plan_meals.weekday` SMALLINT (1=Lunes …
>   7=Domingo, NULL = comida sin día para planes pre-rework). Un menú nuevo nace
>   con **7 días × 5 comidas** (35 comidas, cada una con su "Opción 1").
>   Migración: `scripts/migrate-nutricion-week-recipe-media.js` (byTable).
> - **La tira de días sobre los Comentarios está RETIRADA** (insertaba "Lunes:"
>   como texto en `plans.description`). El editor tiene pestañas Lunes…Domingo
>   (+ "Sin día" si hay comidas legacy, con selector de día por comida) y una
>   **vista de semana completa** en cuadrícula 7×comidas. `plans.description`
>   vuelve a ser solo comentarios generales.
> - **Recetas con FOTO y PASOS** (revierte D4 "solo ingredientes"):
>   `recipes.photo_path` (disco, patrón documentStorage, helper
>   `lib/nutricion/recipePhotoStorage.js`, JPEG/PNG/WebP ≤5 MB, magic bytes) y
>   `recipes.steps` JSONB [string]. Endpoints POST/GET/DELETE
>   `/api/nutricion/recipes/[id]/photo`. Foto y pasos se leen EN VIVO desde los
>   menús (via `recipeId` de provenance); el snapshot sigue congelando solo
>   nombre e ingredientes.
> - **El PDF del menú agrupa por día** (banda por día, comidas dentro), embebe
>   la foto de cada receta y sus pasos numerados, y **omite comidas/días vacíos**.
>   Los planes sin días se imprimen plano, como antes.
> - **Catálogo saneado**: el catálogo branded (2.925 productos de marca de OFF)
>   fue un malentendido y se retiró — `scripts/cleanup-branded-foods.js` archiva
>   `source='openfoodfacts' AND 'marca'=ANY(tags)`; el seed y sus datos se
>   eliminaron del repo. El catálogo es `seed-foods-base-catalog.js` (~500
>   alimentos con macros) + los alimentos propios de la nutricionista.
> - `loadFromTemplate` del editor copia ahora también `weekday` y las recetas de
>   cada opción (antes se perdían ambas cosas).

> **Sprint Nutrinotas (2026-07-18, rama `feat/nutricion-recetario-ux`):**
> feedback directo de Laura aplicado sobre el estado post-Sprint 8:
>
> - **OpenFoodFacts RETIRADO por completo** (búsqueda online, import, badges
>   "Origen", endpoints `search-external`/`import-external` y funciones de
>   `lib/nutricion/foods.js`). El catálogo base se siembra con
>   `scripts/seed-foods-base-catalog.js` (~500 ingredientes genéricos españoles
>   con macros por 100 g, idempotente por slug, lee tenants de `master.tenants`).
>   Las filas ya importadas conservan `source='openfoodfacts'` en BD.
> - **Alta de alimento inline**: si la búsqueda del editor de recetas o del
>   editor de menús no encuentra el alimento, aparece "+ Añadir «X» al catálogo"
>   (crea el food solo con nombre; las macros se completan en el catálogo).
> - **POST `/api/nutricion/plans` ya NO crea la plantilla vacía**: siembra las 5
>   comidas estándar (Desayuno, Almuerzo, Comida, Merienda, Cena) con una opción
>   por defecto cada una, en transacción. Escape hatch: `skipDefaultMeals: true`.
> - El nombre del menú nuevo se pide con un modal del CRM (sin `window.prompt`).
> - Cards de receta 100% clicables (incluida la zona de macros P/C/G/F).
> - Tira de días de la semana (L-D) encima de los Comentarios del menú como
>   organizador visual: pulsar un día inserta su encabezado "Día:" en el texto
>   (sin cambio de modelo de datos — decisión de Jorge 2026-07-18).
> - **Asignación directa desde el editor de menú** (panel derecho): lista de
>   pacientes con el menú + selector para asignar sin salir. Mantiene la
>   semántica de copia independiente (deep-copy) + "Re-aplicar".
> - El smoke C1 pasa a verificar que los endpoints externos responden 404.

Tenant activo: `nutri_laura` únicamente. El backend está pensado para
escalar a otros tenants sin reescribir nada: el módulo `nutricion` se
"registra" insertando una fila en `master.tenant_modules`.

> **Refactor Sprint 8 (en planificación):** reestructura del módulo
> (Alimentos→Recetas, Plantillas→Menús con comidas×recetas×opciones,
> Asignados→Pacientes Nutrición, PDF+email del menú). Plan detallado, riesgos
> y decisiones abiertas en
> [`docs/decisions/2026-07-nutricion-refactor-sprint-8.md`](../decisions/2026-07-nutricion-refactor-sprint-8.md).

---

## 1. Resumen ejecutivo

Mini-Harbiz integrado en el CRM para la nutricionista Laura. Cubre:

- **Catálogo de alimentos** local con macros por 100 g + búsqueda
  externa contra OpenFoodFacts (OFF) e import idempotente al catálogo.
- **Plantillas de plan** reutilizables (estructura de comidas, opciones
  intercambiables, alimentos con 3 modos de cantidad).
- **Asignación a paciente** con deep-copy independiente: editar la
  plantilla NO afecta a los planes ya asignados.
- **UI Harbiz-like** (modal grande con acordeón de comidas + pills de
  opciones + tabla de alimentos + macros calculados al vuelo).
- **Tab "Plan"** en la ficha del paciente con plan activo + histórico
  colapsable + acción "Re-aplicar plantilla origen".
- **Sin kcal**: solo proteínas, carbohidratos, grasas y fibra (en g).
  Decisión cerrada en C0 — Laura no las muestra al paciente.
- **Sin portal cliente**: la entrega del plan se hace en PDF por
  WhatsApp (sprint futuro). El flag `plans.visible_to_client` queda en
  BD por compatibilidad pero su toggle UI se retiró en C4.

Otros tenants: NO disponible. Las tablas `foods/plans/plan_meals/…`
solo existen en `crm_nutri_laura`. Replicar a otro tenant requiere
re-ejecutar los scripts de migración cambiando el slug.

---

## 2. Activación del módulo

El proyecto NO tiene tabla maestra `master.modules` — los módulos se
"registran" implícitamente al crear filas en `master.tenant_modules`.
Por eso "activar el módulo nutrición" significa ejecutar los scripts
de migración por orden:

```powershell
# C1 — Crea enums, tabla foods, fila tenant_modules con
#      uiOverride='nutri-laura/NutricionFoodsModule' + featureFlag
#      externalSearchEnabled=true + añade 'nutricion' al moduleAccess
#      del admin.
npm run db:add-nutricion-nutri-laura

# C2 — Crea tablas plans, plan_meals, plan_meal_options,
#      plan_meal_option_foods + enums + CHECKs + FKs.
npm run db:add-nutricion-c2-nutri-laura

# C3 — Instala la extensión `unaccent` de Postgres (DB-wide, no per
#      schema) para la búsqueda accent-insensitive del catálogo.
npm run db:install-unaccent
```

En producción se ejecuta vía `docker exec`:

```bash
docker exec -it crm-salamandra-app-1 node scripts/add-nutricion-module-nutri-laura.js
docker exec -it crm-salamandra-app-1 node scripts/add-nutricion-c2-plans-nutri-laura.js
docker exec -it crm-salamandra-app-1 node scripts/install-unaccent-extension.js
```

> Las variantes `:prod` del package.json **NO** llevan `--env-file=.env.production`
> (fix C5): las vars vienen del entorno del contenedor Docker, no de un
> fichero. Si queda algún script `:prod` con ese flag, fallará en VPS.

Todos los scripts son **idempotentes**: re-ejecutarlos no duplica nada
ni rompe la BD.

---

## 3. Arquitectura BD

Schema `crm_nutri_laura`:

### `foods` — catálogo de alimentos (C1)

| Columna | Tipo | Notas |
| ------- | ---- | ----- |
| `id` | UUID PK | `gen_random_uuid()` |
| `name` | VARCHAR(255) NOT NULL | indexado |
| `slug` | VARCHAR(255) | indexado, auto-generado desde `name` |
| `default_unit` | ENUM `g\|ml\|unidad` | default `g` |
| `protein_per_100`, `carbs_per_100`, `fat_per_100`, `fiber_per_100` | NUMERIC(8,2) NULL | macros por 100 g |
| `household_measures` | JSONB NOT NULL DEFAULT `[]` | array `[{label, grams}]` |
| `source` | ENUM `openfoodfacts\|custom` | default `custom` |
| `external_id`, `barcode` | VARCHAR(255) | EAN/UPC si viene de OFF |
| `tags` | TEXT[] NOT NULL DEFAULT `{}` | tags libres |
| `archived_at` | TIMESTAMPTZ NULL | soft delete |
| timestamps | | |

Seed de medidas caseras por defecto cuando se crea un food sin
`household_measures` — definido en `lib/nutricion/foods.js`
(`HOUSEHOLD_MEASURES_SEED`): cucharada/cucharadita/unidades/puñado/
taza/vaso/lata, valores estándar.

### `plans` — plantilla o plan asignado (C2)

| Columna | Tipo | Notas |
| ------- | ---- | ----- |
| `id` | UUID PK | |
| `name` | VARCHAR(255) NOT NULL | |
| `description` | TEXT | "Comentarios" estilo Harbiz |
| `type` | ENUM `template\|assigned` | NOT NULL |
| `template_id` | UUID → `plans.id` ON DELETE SET NULL | NULL para plantillas |
| `client_id` | UUID | NULL para plantillas (sin FK física, como Booking) |
| `visible_to_client` | BOOLEAN DEFAULT FALSE | columna muerta tras C4 (toggle UI retirado) |
| `assigned_at`, `archived_at` | TIMESTAMPTZ NULL | |
| timestamps | | |

CHECK `plans_type_client_chk` garantiza coherencia entre `type` y
`client_id/assigned_at`:

```sql
(type='template' AND client_id IS NULL  AND assigned_at IS NULL)
OR
(type='assigned' AND client_id IS NOT NULL AND assigned_at IS NOT NULL)
```

Índices: `plans_type_idx`, parciales por `client_id`, `template_id`,
`archived_at`.

### `plan_meals` — comidas dentro del plan (C2)

`{id, plan_id, name, description, order, timestamps}`.

FK `plan_id` → `plans.id` ON DELETE CASCADE.

### `plan_meal_options` — opciones intercambiables (C2)

`{id, meal_id, name, order, is_default, timestamps}`.

Unicidad de `is_default=true` por comida se enforce en la API (no en
BD) — la API hace un UPDATE en transacción que pone `false` en las
demás opciones de la misma comida.

### `plan_meal_option_foods` — alimentos dentro de una opción (C2)

| Columna | Tipo | Notas |
| ------- | ---- | ----- |
| `id` | UUID PK | |
| `option_id` | UUID → `plan_meal_options.id` ON DELETE CASCADE | |
| `food_id` | UUID → `foods.id` ON DELETE **RESTRICT** | bloquea borrar el food si está en uso |
| `amount` | NUMERIC(10,2) NULL | gramos directos (`g`) o número de medidas (`household`) |
| `unit` | ENUM `g\|household\|free` NOT NULL | |
| `household_label`, `household_grams` | VARCHAR/NUMERIC NULL | solo si `unit='household'` |
| `notes` | TEXT | texto libre |
| `order` | INTEGER NOT NULL | |
| timestamps | | |

CHECK `plan_meal_option_foods_unit_chk`:

```sql
(unit='g'         AND amount NOT NULL AND household_* NULL)
OR
(unit='household' AND amount NOT NULL AND household_label NOT NULL AND household_grams NOT NULL)
OR
(unit='free'      AND amount NULL     AND household_* NULL)
```

---

## 4. Rutas frontend

| Ruta | Componente (override nutri_laura) | Descripción |
| ---- | -------------------------------- | ----------- |
| `/nutricion/alimentos` | `NutricionFoodsModule.jsx` | Catálogo paginado, edit inline macros, buscar online OFF, papelera (C1) |
| `/nutricion/plantillas` | `NutricionPlantillasModule.jsx` | Grid de cards con preview de comidas + contador de asignaciones, CRUD, duplicar (C3) |
| `/nutricion/asignados` | `NutricionAsignadosModule.jsx` | Tabla lg / cards mobile + filtro por plantilla origen + botón "+ Nueva asignación" (C3+C4) |
| `/clientes/[id]` (tab "Plan") | `ClientPlansPanel.jsx` dentro de `ClientDetailModule.jsx` | Plan activo + histórico colapsable + acciones (C4) |

El sidebar (`components/layout/Sidebar.jsx`) tiene una entrada
"Nutrición" plegable con las 3 sub-rutas; se auto-expande cuando
`pathname.startsWith("/nutricion/")`.

Modales reutilizados desde varias rutas:

- `PlanEditorModal.jsx` — editor Harbiz-like (C3). Persistencia
  totalmente en tiempo real (autosave), sin botón Guardar.
- `AssignPlanModal.jsx` — wizard 3 pasos paciente → plantilla →
  confirmar (C4).
- `FoodEditModal.jsx` — crear/editar food del catálogo (C1).
- ~~`FoodSearchExternalModal.jsx`~~ — ELIMINADO en Nutrinotas (2026-07-18).

---

## 5. Endpoints REST

Base: `/api/nutricion/*` + `/api/clients/[id]/plans`. Todos requieren
JWT válido + tenant con módulo `nutricion` activo (sin auth → 401,
con auth pero sin módulo → 403).

### Catálogo de alimentos (C1)

| Método | Path | Notas |
| ------ | ---- | ----- |
| GET | `/api/nutricion/foods` | Lista paginada. Query: `q`, `tag`, `source`, `limit`, `page`. Búsqueda case+accent insensitive (C3). |
| GET | `/api/nutricion/foods/[id]` | Detalle (404 si archived). |
| POST | `/api/nutricion/foods` | Crea food manual. `source='custom'`. |
| PATCH | `/api/nutricion/foods/[id]` | Editar parcial. Protege `source` (no se puede cambiar). |
| DELETE | `/api/nutricion/foods/[id]` | Soft delete (`archived_at`). |
| ~~GET~~ | ~~`/api/nutricion/foods/search-external`~~ | ELIMINADO en Nutrinotas (2026-07-18). |
| ~~POST~~ | ~~`/api/nutricion/foods/import-external`~~ | ELIMINADO en Nutrinotas (2026-07-18). |

### Planes (C2)

| Método | Path | Notas |
| ------ | ---- | ----- |
| GET | `/api/nutricion/plans?type=template\|assigned` | Lista. Query: `q`, `clientId`, `includeArchived`, `withSummary`, paginación. |
| GET | `/api/nutricion/plans/[id]` | Detalle con árbol meals→options→foods. Cada food incluye snapshot de macros + `household_measures`. |
| POST | `/api/nutricion/plans` | Crea plantilla con las 5 comidas estándar + opción por defecto (Nutrinotas); `skipDefaultMeals: true` la crea vacía. |
| PATCH | `/api/nutricion/plans/[id]` | Edita `name`, `description`, `visibleToClient`. Devuelve `hadAssignments`. |
| DELETE | `/api/nutricion/plans/[id]` | Soft delete. |
| POST | `/api/nutricion/plans/[id]/duplicate` | Solo plantillas. Deep-copy en transacción. |
| POST | `/api/nutricion/plans/[id]/assign` | Solo plantillas. Body: `{clientId, nameOverride?}`. 409 si ya hay asignación activa. |
| POST | `/api/nutricion/plans/[id]/reapply-template` | C4. Solo asignados. Archive viejo + deep-copy plantilla origen. 409 si plantilla origen archivada. |

CRUD anidado de comidas/opciones/alimentos:

| Método | Path |
| ------ | ---- |
| POST/PATCH/DELETE | `/api/nutricion/plans/[id]/meals[/[mealId]]` |
| POST/PATCH/DELETE | `/api/nutricion/plans/[id]/meals/[mealId]/options[/[optionId]]` |
| POST/PATCH/DELETE | `/api/nutricion/plans/[id]/meals/[mealId]/options/[optionId]/foods[/[foodId]]` |
| POST | `/api/nutricion/plans/[id]/meals/reorder` | **C5**. Reordena TODAS las comidas en una transacción. Body: `{order: [{id, order}]}`. |

Cada endpoint anidado valida pertenencia en cadena
(`assertMealBelongsToPlan` → `assertOptionBelongsToMeal` →
`assertFoodLineBelongsToOption`) para impedir manipulación cross-plan
vía path.

### Listado por cliente (C4)

| Método | Path | Notas |
| ------ | ---- | ----- |
| GET | `/api/clients/[id]/plans` | Devuelve activos + archivados ordenados por `createdAt DESC`. Cada item con `templateName`, `mealCount`, `templateArchived`. Auth: `hasModule('nutricion')`. |

### `withSummary=true` en listados de planes (C3)

Cuando se activa el flag, `GET /api/nutricion/plans` añade:

- Cualquier tipo: `mealsSummary: [{id, name, optionCount}]` y `mealCount`.
- `type='template'`: `activeAssignmentsCount` (agrupado, sin N+1).
- `type='assigned'`: `clientName` y `templateName` (eager-loaded).

---

## 6. Helper de macros — `lib/nutricion/macros.js`

Sin kcal nunca. Operación sobre el árbol serializado del plan.

| Helper | Devuelve |
| ------ | -------- |
| `computeFoodMacros(line)` | `{protein, carbs, fat, fiber}` g absolutos. |
| `computeOptionMacros(option)` | Suma de los foods de la opción. |
| `computeMealMacros(meal)` | Macros de la opción `isDefault=true` (o, en su defecto, la de menor `order`). |
| `computePlanMacros(plan)` | Suma de las comidas (sus defaults). |
| `normalizeForSearch(s)` | (C3) Lowercase + strip diacríticos para fallback JS de búsqueda. |

Conversión por modo (en `computeFoodMacros`):

- `unit='g'` → `amount × macro/100`.
- `unit='household'` → `(amount × householdGrams) × macro/100`.
  ⚠️ En C2 el helper ignoraba `amount` en esta rama; bug corregido en
  C3 al introducir UI que permite `amount > 1`.
- `unit='free'` → todo `null` (texto libre, no calculable).

Líneas con macro `null` se ignoran en sumas; si TODAS las líneas son
`null` para un macro, el resultado de ese macro es `null`.

---

## 7. Decisiones arquitectónicas cerradas

**Sprint completo**:

1. Plantillas **mutables** + asignados **independientes**. PATCH
   plantilla devuelve `hadAssignments` para que el frontend muestre
   aviso. La propagación a asignados es manual ("Re-aplicar plantilla
   origen" desde la ficha paciente).
2. Sin kcal en BD ni en UI. Las kcal se calculan en frontend si Laura
   las quisiera (4p+4c+9f), pero hoy NO se muestran.
3. Tres modos de cantidad: `g` (gramos directos), `household`
   (`amount × householdGrams`), `free` (texto libre, macros no
   calculables).
4. Tabla `plans` única con discriminator `type` (no dos tablas) — mismo
   árbol estructural para plantillas y asignados; deep-copy reutilizado
   en `/duplicate` y `/assign` y `/reapply-template`.
5. `unicidad de is_default` enforce en API (transacción) en vez de
   UNIQUE INDEX parcial. Permite cambiar política en el futuro sin
   migración.
6. `food_id` FK con `ON DELETE RESTRICT` en `plan_meal_option_foods`.
   Borrar un food vivo en uso falla a nivel BD; el endpoint DELETE de
   food sigue siendo soft delete (no rompe la FK porque la fila no se
   elimina). Backlog: comprobar `count(*) en plan_meal_option_foods`
   antes de archivar y avisar con 409.

**C3 (UI)**:

7. Búsqueda case+accent insensitive vía extensión Postgres `unaccent`,
   con fallback JS lossy si la extensión no está instalada.
   `lib/nutricion/foods.js → hasUnaccentSupport()` cachea por instancia
   Sequelize. Backlog: fallback JS completo (load+paginate in-memory).
8. Persistencia 100% tiempo real en el editor (autosave). Decisión
   tomada en C3.5 tras validación browser: eliminados los botones
   "Cancelar/Guardar" del footer y el confirm al cerrar. Indicador
   "Guardando…/Guardado" en header + footer. Mutaciones estructurales
   commit on click, edición de texto commit on blur.
9. `withSummary=true` como opt-in del listado (no endpoint nuevo) para
   alimentar las cards/tabla sin N+1.
10. Sub-entradas plegables del sidebar (Alimentos / Plantillas /
    Asignados) auto-expanded cuando `pathname.startsWith('/nutricion/')`.

**C4 (asignación + ficha paciente)**:

11. Asignación de plantilla a paciente se inicia **solo desde
    `/nutricion/asignados`**. La ficha paciente no tiene botón
    "Asignar nueva plantilla". Decisión de Jorge tras revisar el flujo:
    asignar es una operación administrativa, no debería estar dentro
    del contexto del paciente.
12. Wizard de asignación: 3 pasos (paciente → plantilla → confirmar).
    El paso 3 con resumen explícito se añadió en C4.5 tras validación
    browser: el paso 2 con confirmación inmediata era demasiado
    abrupto. Filtra del paso 2 las plantillas ya asignadas activas
    para evitar el 409 antes del POST.
13. Re-aplicar plantilla origen: archive del plan actual + deep-copy
    en una transacción. Devuelve 409 si la plantilla origen está
    archivada.
14. Portal cliente DESCARTADO. Toggle "Visible al cliente" retirado
    del header del editor en C4.5. La columna BD `visible_to_client`
    se conserva por compatibilidad y `patchPlanMetadata` sigue
    aceptando el flag. Sprint "Export PDF Recetario para WhatsApp" se
    contempla en backlog futuro.

**C5 (cierre)**:

15. Endpoint `POST /api/nutricion/plans/[id]/meals/reorder` añadido
    para sustituir los N PATCH consecutivos que el frontend usa hoy en
    `moveMeal` del PlanEditorModal. UI de drag&drop queda en backlog.
16. Scripts `:prod` del Recetario (3) sin `--env-file=.env.production`.
    Las vars vienen del entorno del contenedor Docker. Scripts `:prod`
    pre-Recetario tienen el mismo bug pero no se tocan en este sprint
    — apuntados en backlog.

---

## 8. Tests / Smokes

Cinco scripts ejecutables en `scripts/`. Todos usan el mismo patrón de
auth: `SMOKE_PASSWORD` opcional para login HTTP completo, fallback a
firma JWT directa con `JWT_SECRET`.

| Script | Cubre |
| ------ | ----- |
| `smoke-nutri-laura-recetario-c1.mjs` | CRUD foods + OFF online/offline + import idempotente + 401 sin cookie. |
| `smoke-nutri-laura-recetario-c2.mjs` | Backend planes: CRUD plantilla + meals + options + foods (3 modos) + duplicate + assign + hadAssignments + independencia template/assigned + 401 + **POST /meals/reorder (4 casos)**. |
| `smoke-nutri-laura-recetario-c3.mjs` | PARTE A: 14 unit tests de `lib/nutricion/macros.js` (sin red). PARTE B: HTTP/BD del backend C3 — accent-insensitive search, `withSummary=true`, recalc macros, transiciones de `unit` con nulls. |
| `smoke-nutri-laura-recetario-c4.mjs` | Endpoints C4: `/assign` + `/reapply-template` (happy + rechazos) + `GET /api/clients/[id]/plans` + regresión anti-duplicado C2 + 401. |
| `smoke-nutri-laura-recetario-e2e.mjs` | **C5**. Flujo completo de Laura: catálogo → plantilla → asignación → edición → reapply → histórico → PATCH plantilla con asignaciones. 50 asserts. Self-contained con cleanup robusto. |

Ejecutar (necesitan `npm run dev` en otra terminal):

```powershell
node --env-file=.env.local scripts/smoke-nutri-laura-recetario-c1.mjs
node --env-file=.env.local scripts/smoke-nutri-laura-recetario-c2.mjs
node --env-file=.env.local scripts/smoke-nutri-laura-recetario-c3.mjs
node --env-file=.env.local scripts/smoke-nutri-laura-recetario-c3.mjs --only-unit  # sin dev server
node --env-file=.env.local scripts/smoke-nutri-laura-recetario-c4.mjs
node --env-file=.env.local scripts/smoke-nutri-laura-recetario-e2e.mjs
```

Conteo último run (C5):

| Smoke | OK | KO |
| ----- | -- | -- |
| C1 | 32 | 0 |
| C2 | 58 | 0 |
| C3 | 64 | 0 |
| C4 | 43 | 0 |
| E2E | 50 | 0 |

---

## 9. Migrations

Tres scripts idempotentes en `scripts/`:

| Script | Sprint | Hace |
| ------ | ------ | ---- |
| `add-nutricion-module-nutri-laura.js` | C1 | Crea enums + tabla `foods` + fila `master.tenant_modules` con `uiOverride='nutri-laura/NutricionFoodsModule'` + featureFlag `externalSearchEnabled=true` + añade 'nutricion' al `moduleAccess` del admin. |
| `add-nutricion-c2-plans-nutri-laura.js` | C2 | Crea enums `plans_type` y `plan_meal_option_food_unit` + las 4 tablas (`plans`, `plan_meals`, `plan_meal_options`, `plan_meal_option_foods`) + índices + constraints CHECK + FKs. NO toca `tenant_modules` (lo hace C1). |
| `install-unaccent-extension.js` | C3 | `CREATE EXTENSION IF NOT EXISTS unaccent` en la BD principal (es extensión a nivel de BD, no de schema). |

Comando local + producción:

```powershell
# Local
npm run db:add-nutricion-nutri-laura
npm run db:add-nutricion-c2-nutri-laura
npm run db:install-unaccent
```

```bash
# Producción (las vars vienen del entorno del contenedor Docker)
docker exec -it crm-salamandra-app-1 node scripts/add-nutricion-module-nutri-laura.js
docker exec -it crm-salamandra-app-1 node scripts/add-nutricion-c2-plans-nutri-laura.js
docker exec -it crm-salamandra-app-1 node scripts/install-unaccent-extension.js
```

---

## 10. Backlog técnico (sprints futuros)

### Quick wins

- Endpoint `POST /api/nutricion/plans/[id]/restore` para des-archivar
  un plan asignado (caso restaurar histórico desde la ficha paciente).
- Indicador "Guardando…" del editor con tiempo mínimo de display (~300
  ms) para evitar parpadeo en respuestas rápidas.
- Auto-fix del nombre del plan re-aplicado: la heurística
  `split(" - ")[1] || "actualizado"` falla con plantillas que tengan
  guiones en el nombre. Mejor: prompt al confirmar el reapply.
- Smoke "self-hosted" que arranque su propio listener (sin requerir
  `npm run dev`).
- Fallback JS completo de búsqueda si `unaccent` no está disponible
  (hoy fallback parcial: ILIKE + post-filtro JS lossy).
- 4 warnings preexistentes de `react-hooks/set-state-in-effect` —
  patrón project-wide en C1/C3/C4. Cleanup transversal.
- Scripts `:prod` PRE-Recetario en `package.json` siguen usando
  `--env-file=.env.production` (`db:migrate:*:prod`, `db:seed:*:prod`,
  `db:add-*:prod`). Bug latente: si alguien intentara correrlos en VPS
  con `npm run X:prod` fallaría. Solución: igual que el fix C5 — quitar
  el flag. No se tocaron en C5 porque están fuera del alcance del
  sprint (regla #2 del C5: NO modificar más allá del Recetario).
- Búsqueda por tag en `/nutricion/alimentos` — backend ya soporta
  `?tag=`, falta UI con select de tags existentes.

### Mejoras medianas

- Endpoint `POST /api/nutricion/plans/[id]/replace-with-template`
  atómico (hoy el frontend hace N+1 borrando comidas y recreando árbol
  desde el cliente — funciona pero gasta requests).
- `PATCH .../foods/[foodId]` permitiendo cambio de `food_id` sin
  borrar+recrear (cambiar de alimento conservando amount/unit).
- Resumen de macros (P/C/G/F) en la card "Plan activo" de la ficha
  paciente. Hoy solo se muestra mealCount.
- Modo `readOnly` en `PlanEditorModal` para abrir planes archivados
  desde el histórico sin permitir edición (hoy se abre en modo edit
  igual que el activo).
- Drag&drop UI para reordenar comidas/opciones/foods. El endpoint
  `/meals/reorder` ya existe (C5); falta el equivalente para opciones
  y foods + integración con `react-dnd` u otra librería.
- Validación "food en uso" antes de archivar: `SELECT count(*) FROM
  plan_meal_option_foods WHERE food_id=:id` → 409 con número de planes
  afectados y nombre de algunos como ejemplo.

### Features grandes (sprints dedicados)

- **Bulk re-apply plantilla a TODOS los pacientes activos** cuando
  Laura edita la plantilla. Hoy es 1 a 1 desde cada ficha. Necesita UX
  pensada (¿confirmación masiva? ¿blacklist por paciente?).
- **Comparar dos planes side-by-side** (diff de comidas/opciones/
  cantidades) — útil entre revisiones de un mismo paciente.
- **Notificación al paciente** (email/SMS/WhatsApp) cuando Laura
  re-aplica o crea un plan. Integración con n8n.
- **Sprint Export PDF Recetario para WhatsApp** (próximo después de
  C5). Generador PDF con plantilla bonita; envío vía WhatsApp Business
  API o link compartido. Sustituye al portal cliente que se descartó.
- Restaurar un plan archivado (más completo que el endpoint
  `/restore`): incluir UI de selección + confirm + opciones de qué
  hacer con el activo actual.

---

## 11. Recap del sprint

| Checkpoint | Alcance | Fecha local | Producción |
| ---------- | ------- | ----------- | ---------- |
| C1 | Catálogo + OFF | 2026-06-22 | 2026-06-23 |
| C2 | Backend planes | 2026-06-23 | 2026-06-24 |
| C3 | UI constructor + accent search | 2026-06-24 | 2026-06-24 |
| C4 | Asignación + tab Plan | 2026-06-24 | 2026-06-24 |
| C5 | Smoke E2E + docs + reorder + fixes prod scripts | 2026-06-24 | Pendiente |

Total estimado del sprint: ~11 días planificados, ejecutado en ~3 días
gracias a iteración asistida intensiva con LLM.

Archivos nuevos del sprint:

- 24 archivos backend (rutas API + lib + models + scripts).
- 8 archivos frontend (modales + módulos + paneles overrides).
- 5 scripts de smoke + 3 de migración.

Líneas de código aproximadas:
- Backend: ~3000 LOC.
- Frontend: ~3500 LOC.
- Smokes: ~2500 LOC.
- Docs: ~600 LOC (este archivo).

Producción: Laura tiene operativo C1+C2+C3 desde el 2026-06-24. La
inversión está pendiente solo de validación browser de C4+C5 y un
último deploy.

---

## PDF del menú — rediseño del 2026-07-22 (segunda pasada)

Fichero: `lib/nutricion/menuPdf.js`. Es el ÚNICO documento que recibe el
paciente (no hay portal: se envía por email como adjunto).

### Estructura en tres partes

1. **Portada, la única hoja horizontal** — calendario 7 días × comidas.
2. **Días detallados, en vertical** — cada día dentro de una TARJETA de fondo
   tenue con el color de marca y una barra lateral, para que se vea de un
   golpe dónde empieza y acaba cada día. Los días fluyen y paginan solos
   (típicamente 2 por hoja). Detrás del último día van los comentarios
   generales de la nutricionista, en su propia tarjeta.
3. **Recetario** — cada receta usada en la semana, deduplicada por `recipeId`,
   también en tarjeta: foto, ingredientes con cantidades y pasos numerados.

### Motor de bloques

pdfkit pinta en orden de llamada: un rectángulo trazado después del texto lo
taparía. Para poder dibujar el fondo de una tarjeta ANTES de su contenido hay
que saber de antemano cuánto ocupa, así que el contenido se modela como lista
de bloques (`blk`) que se MIDEN con `heightOfString` y luego se pintan con
`drawBlocks`. Si un día o una receta no cabe ni en una hoja entera, hay una
ruta de respaldo que renderiza fluyendo y sin tarjeta (`renderDayFlowing`,
`renderRecipeFlowing`): un menú raro nunca debe romper el documento.

### Orientación — trampa a recordar

`doc.addPage()` SIN argumentos hereda `doc.options`, que se fijaron al crear el
documento. Como la portada abre el PDF en horizontal, todas las páginas que
pdfkit añadía solo (desbordamiento, `ensureSpace`) salían apaisadas. Por eso
`switchToPortrait(doc)` reescribe `doc.options` en cuanto termina la portada.

### Tipografía

Poppins embebida (`lib/pdf/fonts.js`, ficheros en `lib/pdf/fonts/`, licencia
OFL en la misma carpeta), la misma que la interfaz. Cuatro pesos: Regular,
Medium, SemiBold (hace de negrita) e Italic. Los buffers se leen de disco una
vez por proceso. Si faltasen los ficheros se cae a Helvetica en lugar de
fallar: un PDF con la fuente equivocada es un problema estético, uno que no se
genera es un paciente sin su menú. El Dockerfile ya copia `lib/` entera.

### `plans.show_macros` — decisión clínica, no estética

Migración `scripts/migrate-nutricion-show-macros.js`, interruptor en
`PlanEditorModal` ("Lo que ve el paciente"). Gobierna si el PDF imprime
P/H/G/fibra.

**Por defecto `false`, y los menús preexistentes también quedaron en `false`.**
Laura trata trastornos de la conducta alimentaria, donde poner cifras de
gramos delante del paciente puede reforzar justo la conducta que se está
tratando. Enseñarlas tiene que ser una decisión consciente por menú. La
nutricionista sigue viendo todos los macros calculados dentro del CRM: el
interruptor solo gobierna el documento que sale a la calle.

El valor viaja en las copias (`assign`, `duplicate`, `reapply-template`): si la
plantilla decide no enseñar macros, el plan del paciente tampoco.

### Sin pies de página

El documento NO lleva "Generado el … · <tenant>" ni ninguna otra firma. Es
material clínico que entrega la nutricionista.
