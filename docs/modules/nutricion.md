# Módulo Nutrición (Recetario)

## Mapa

> Verificado contra el código el 19/08/2026 (lo desplegado en producción es este mismo commit). Si algo no cuadra, manda el código: corrige esta tabla. **Quién tiene el módulo NO se lista aquí** (una lista a mano se queda vieja): `/admin/modulos` en el back-office o `node scripts/inspect-tenant-modules.js <slug>`.

| | |
| --- | --- |
| **moduleKey** | `nutricion` · requiere `clients` (`lib/provisioning/catalogo.js`; alimentos, recetario y menús funcionan solos, pero sin ficha no hay a quién asignar ni enviar una pauta) |
| **Reina** | `nutri_laura` (Laura): el módulo nació como su «mini-Harbiz» (§1 de este doc) y su consulta define el default del módulo (CLAUDE.md, «tenants reina») |
| **Pantallas** | `app/(dashboard)/nutricion/{alimentos,recetas,plantillas,asignados}/page.jsx` → `/nutricion/alimentos` (Alimentos), `/nutricion/recetas` (Recetario), `/nutricion/plantillas` (Menús), `/nutricion/asignados` (Pautas) · pestaña «Pautas» de la ficha: `app/(dashboard)/clientes/[id]/page.jsx` decide en el servidor (`conNutricion`) → `/clientes/[id]` · baldosa «Recetario» de la portada: `app/(dashboard)/page.jsx` |
| **Endpoints** | `app/api/nutricion/**` — 24 `route.js` (`foods` 3, `recipes` 5 —incl. `[id]/photo`, `[id]/propagate`, `facetas`—, `plans` 16 —incl. `[id]/pdf`, `[id]/send-email`, `[id]/assign`, `[id]/duplicate`, `[id]/reapply-template`, `meals/**`—) · fuera de la carpeta: `app/api/clients/[id]/plans/route.js` (pautas de una ficha) y `app/api/clients/[id]/module-assignments/route.js` (marcar «Paciente Nutrición») · públicos: ninguno |
| **Lógica** | `lib/nutricion/`: `foods.js` (catálogo: slug, medidas caseras, búsqueda con `unaccent`), `plans.js` (árbol del plan, `loadPlanTree`, deep-copy, `sanitizeFoodLine`, `UUID_RE`), `recipes.js` (recetario: include, serializer, ingredientes), `macros.js` (P/C/G/fibra, sin kcal), `menuPdf.js` (PDF de la pauta con pdfkit y Poppins de `lib/pdf/fonts.js`), `recipePhotoStorage.js` (foto de receta en disco, ≤5 MB) · fuera de la carpeta: `lib/clients/moduleAssignments.js` (auto-marcado «Paciente Nutrición», `AUTO_ASSIGN_FLAG`), `lib/clients/vocabulario.js` («Pacientes» donde el cliente ES el paciente), `lib/email/templates/nutricion/menuEmail.js` (correo de la pauta), `lib/actividad/etiquetas.js` (frases `nutricion.*` de la auditoría) |
| **UI** | `modules/nutricion/` (12 ficheros): `NutricionFoodsModule.jsx`, `NutricionRecetasModule.jsx`, `NutricionPlantillasModule.jsx`, `NutricionAsignadosModule.jsx`, `PlanEditorModal.jsx` (editor con autosave), `AssignPlanModal.jsx`, `RecipeEditModal.jsx`, `RecipePickerModal.jsx`, `FoodEditModal.jsx`, `PropagarRecetaPanel.jsx`, `ClientPlansPanel.jsx` (pestaña Pautas; la montan `modules/default/ClientDetailModule.jsx` y la ficha de Laura), `foodSections.js` · no hay `components/nutricion/`; el menú plegable «Nutrición» está en `components/layout/Sidebar.jsx` |
| **Modelos** | `models/tenant/`: `Food` (`foods`), `Plan` (`plans`), `PlanMeal` (`plan_meals`), `PlanMealOption` (`plan_meal_options`), `PlanMealOptionFood` (`plan_meal_option_foods`), `Recipe` (`recipes`), `RecipeFood` (`recipe_foods`), `PlanMealOptionRecipe` (`plan_meal_option_recipes`), `PlanMealOptionRecipeFood` (`plan_meal_option_recipe_foods`) — las nueve tablas · comparte con Clientes `ClientModuleAssignment` (`client_module_assignments`) para el marcado «Paciente Nutrición» |
| **Interruptores y parámetros** | `featureFlags.autoAsignarEnAlta` — lo lee `lib/clients/moduleAssignments.js` (`AUTO_ASSIGN_FLAG`) y lo respeta `backfill-nutricion-assignments.js`; en producción solo `nutri_laura` lo tiene a `true` (Aumenta no lo tiene puesto = apagado) · `featureFlags.externalSearchEnabled` está puesto en `nutri_laura` pero **ningún código lo lee**: solo lo escribe `scripts/add-nutricion-module-nutri-laura.js` (histórico, OpenFoodFacts retirado) · `logicOverrides`: ninguno |
| **Pantallas propias** | ninguna. Las cuatro páginas de `/nutricion/*` llevan un mapa `UI_OVERRIDES` con `nutri_laura`, pero apunta al MÓDULO BASE (`modules/nutricion/…`), el mismo componente que el valor por defecto: **mapa vacío de facto**, y por eso ni `sincronizar-ui-override.mjs` ni `/admin/modulos` lo cuentan. Lo de Laura en `modules/overrides/nutri-laura/` es su ficha (`ClientDetailModule.jsx`, que importa `ClientPlansPanel` del base) y su embudo de leads, no nutrición |
| **Scripts** | activar: `node scripts/enable-module.js <slug> nutricion` (fila en `tenant_modules` + las 8 migraciones que declara `scripts/_module-migrations.js` + siembra) · migraciones vivas, en ese orden: `migrate-nutricion-base.js` (las cinco tablas cimiento), `migrate-nutricion-recipes.js`, `migrate-nutricion-week-recipe-media.js`, `migrate-nutricion-day-comments.js`, `migrate-nutricion-show-macros.js`, `migrate-recetas-clasificacion.js`, `migrate-plan-team.js`, `migrate-nutricion-congelar-receta.js`; aparte `install-unaccent-extension.js` (extensión de BD, una vez por base) · seed: `seed-foods-base-catalog.js` (497 alimentos de `scripts/data/foods-base-catalog.mjs`, idempotente por slug) · datos y one-off, a mano: `migrate-auto-asignar-nutricion.js` (MASTER: enciende el flag a nutri_laura), `backfill-nutricion-assignments.js` (marca fichas previas; exige el flag), `import-harbiz-recetas.js` (las 1.083 recetas de Laura, `--confirm`), `cleanup-branded-foods.js` (archiva las marcas de OFF) · históricos que no se ejecutan: `add-nutricion-module-nutri-laura.js`, `add-nutricion-c2-plans-nutri-laura.js` |
| **Pruebas** | `scripts/_smoke-nutri-laura-recetario-{c1,c2,c3,c4,e2e}.mjs` (renombradas el 19/08/2026: antes sin el `_` y el runner no las veía) — piden base de datos y `npm run dev`; `scripts/pruebas.mjs` las clasifica «servidor y base de datos», así que entran en **`npm run test:todo`** y NO en `npm test` (c3 con `--only-unit` prueba `macros.js` sin servidor, a mano) · `_smoke-piezas-ficha.mjs` (`@prueba ligera`, en `npm test`) fija qué paneles ve la consulta de nutrición en la ficha · ningún `_smoke-*` ligero toca `lib/nutricion/` |
| **Decisiones** | `../decisions/2026-07-nutricion-refactor-sprint-8.md`, `../decisions/2026-07-nutricion-8.2-runbook.md`, `../decisions/2026-07-nutricion-8.3-menu-pdf-email.md` (las del sprint) · `../decisions/2026-07-23-conexion-cliente-equipo.md` (`plans.team_member_id`) · `../decisions/2026-07-28-repaso-de-seguridad.md` (la edición granular del menú no se audita) · `../decisions/2026-08-01-activar-un-modulo-tiene-dos-puertas.md` (`enable-module.js` siembra las nueve tablas y los 497 alimentos) · `../decisions/2026-08-01-alta-de-clientes-por-perfil.md` (perfil `salud`) · `../decisions/2026-08-04-clientes-se-llama-pacientes-en-nutricion.md` (Recetario / Pautas) · `../decisions/2026-08-12-migraciones-sin-filtrar-por-status.md` (seed y backfill sí miran `status`) |
| **En este doc** | «2. Activación del módulo» · «3. Arquitectura BD» · «4. Rutas frontend» · «5. Endpoints REST» · «7. Decisiones arquitectónicas cerradas» (Congelado y propagación) · «8. Tests / Smokes» · «9. Migrations» · «PDF del menú — rediseño del 2026-07-22 (segunda pasada)» |

Estado: **todo el módulo está desplegado.** Comprobado el 12/08/2026 dentro del
contenedor: los endpoints de `/api/nutricion/*` y las cuatro pantallas eran
exactamente los mismos que en local (entonces 23; son **24** desde el 13/08
con `recipes/[id]/propagate`, desplegado también).

> ⚠️ **Esta línea decía «C1+C2+C3 en producción, C4+C5 pendientes de
> despliegue», y llevaba semanas sin ser verdad.** El endpoint que cerraba C5
> entró en master el 2026-06-24 (`9822e9a`) y el sub-sprint 8.3 —el PDF del menú
> y el envío por correo— el 2026-07-16 (`e51f0d7`); los dos viajaron con los
> despliegues siguientes. Quien abría esta ficha daba por pendiente media
> nutrición, y esa media nutrición ya la estaba usando Laura.
>
> Estos estados se escribieron durante el sprint y nadie volvió a tocarlos. **No
> se deducen de aquí: se miran en el contenedor**, que es la única respuesta que
> no envejece:
>
> ```bash
> docker exec crm-salamandra-app-1 find .next/server/app/api/nutricion -name route.js
> ```

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
>   `/api/nutricion/recipes/[id]/photo`.
>   ⚠️ **Foto y pasos se leían EN VIVO desde los menús hasta el 13/08/2026**, y
>   eso ya NO es así: ahora el snapshot los congela también. Ver «Congelado y
>   propagación» en la sección 7.
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

Tenants activos (foto de `master` del 19/08/2026): **cinco** — `nutri_laura`
(la reina, 4 pautas), `aumenta`, `demo`, `demo_nutricion` y `somos`. El
backend nació pensado para escalar sin reescribir nada, y desde el 13/08/2026
eso es literal: se da con `scripts/enable-module.js <slug> nutricion` (ver §2).

> **Histórico (hasta 13/08/2026):** aquí decía «Tenant activo: `nutri_laura`
> únicamente», y activarlo en otro significaba ejecutar a mano los scripts C1/C2.

> **Refactor Sprint 8 (hecho en 07/2026: 8.2 recetario, 8.3 PDF + email):**
> reestructura del módulo (Alimentos→Recetas, Plantillas→Menús con
> comidas×recetas×opciones, Asignados→Pacientes Nutrición, PDF+email del
> menú). Plan detallado, riesgos y decisiones en
> [`docs/decisions/2026-07-nutricion-refactor-sprint-8.md`](../decisions/2026-07-nutricion-refactor-sprint-8.md).

---

## 1. Resumen ejecutivo

Mini-Harbiz integrado en el CRM, nacido para la nutricionista Laura y hoy
(13/08/2026) un módulo más que se le da a cualquier cliente. Cubre:

- **Catálogo de alimentos** local con macros por 100 g: los 497 del catálogo
  base (`seed-foods-base-catalog.js`) más los propios de la nutricionista.
  **Histórico (hasta 18/07/2026):** además había búsqueda externa contra
  OpenFoodFacts (OFF) e import idempotente al catálogo; se retiró entero en
  Nutrinotas (las filas importadas conservan `source='openfoodfacts'`).
- **Recetario** (8.2, 22/07/2026): recetas con ingredientes, foto y pasos,
  clasificadas (tipo, etiquetas, alérgenos, preferencias, duración, raciones).
- **Plantillas de plan** reutilizables (estructura de comidas por día de la
  semana, opciones intercambiables, alimentos con 3 modos de cantidad y
  recetas congeladas dentro).
- **Asignación a paciente** con deep-copy independiente: editar la
  plantilla NO afecta a los planes ya asignados.
- **UI Harbiz-like** (modal grande con acordeón de comidas + pills de
  opciones + tabla de alimentos + macros calculados al vuelo).
- **Pestaña "Pautas"** (antes "Plan") en la ficha del paciente con plan activo
  + histórico colapsable + acción "Re-aplicar plantilla origen".
- **Sin kcal**: solo proteínas, carbohidratos, grasas y fibra (en g).
  Decisión cerrada en C0 — Laura no las muestra al paciente.
- **Sin portal cliente**: la pauta se entrega en **PDF** (`plans/[id]/pdf`)
  y por **correo** con el PDF adjunto (`plans/[id]/send-email`, sub-sprint
  8.3). El flag `plans.visible_to_client` queda en BD por compatibilidad pero
  su toggle UI se retiró en C4.

Otros tenants: se activa con `scripts/enable-module.js <slug> nutricion`
(§2), que crea las nueve tablas y siembra el catálogo base.

> **Histórico (hasta 13/08/2026):** «NO disponible. Las tablas
> `foods/plans/plan_meals/…` solo existen en `crm_nutri_laura`. Replicar a
> otro tenant requiere re-ejecutar los scripts de migración cambiando el
> slug.» Era verdad hasta que `migrate-nutricion-base` entró en
> `_module-migrations.js`.

---

## 2. Activación del módulo

### La vía correcta desde el 13/08/2026

```bash
docker exec crm-salamandra-app-1 node scripts/enable-module.js <slug> nutricion
```

Eso hace las TRES cosas en el orden bueno: la fila en `master.tenant_modules`,
las migraciones del módulo (`migrate-nutricion-base` la primera, que crea las
nueve tablas) y la siembra de los **497 alimentos del catálogo base**. Un
recetario sin alimentos no deja escribir ni una receta, así que sin ese último
paso el cliente estrena el módulo y no puede hacer nada con él.

**Quién lo tiene** (comprobado en producción el 13/08/2026): `nutri_laura` —la
reina—, `demo` y `demo_nutricion` de escaparate, `somos` y **`aumenta`**.

⚠️ **El auto-marcado nace APAGADO** (`featureFlags.autoAsignarEnAlta`). Solo
`nutri_laura` lo tiene encendido, porque lo pidió. En un centro grande —Aumenta
tiene 1.083 familias— encenderlo marcaría como paciente de dietas a todo el que
entre por la puerta. `backfill-nutricion-assignments.js` exige el mismo flag, o
sería la puerta de atrás para el mismo estropicio.

### Cómo se hacía antes (histórico)

El proyecto NO tiene tabla maestra `master.modules` — los módulos se
"registran" implícitamente al crear filas en `master.tenant_modules`.
Por eso "activar el módulo nutrición" significaba ejecutar a mano estos
scripts, que **ya no se usan** (hardcodean `crm_nutri_laura`):

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

En el schema de cada tenant con el módulo (`crm_{slug}`): **nueve tablas**.
Las cinco de abajo son el cimiento (C1/C2, hoy las crea
`migrate-nutricion-base`); las columnas marcadas «(post-sprint)» y las cuatro
tablas del recetario llegaron después y las añaden las otras migraciones de
§9.

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
| `day_comments` (post-sprint) | JSONB NOT NULL DEFAULT `{}` | comentarios por día `{ "1": "lunes…", … "7": … }` (`migrate-nutricion-day-comments`, 22/07) |
| `show_macros` (post-sprint) | BOOLEAN NOT NULL DEFAULT FALSE | si el PDF del paciente imprime P/H/G/fibra; apagado a propósito (`migrate-nutricion-show-macros`, 22/07; ver «PDF del menú») |
| `team_member_id` (post-sprint) | UUID NULL → `team_members.id` ON DELETE SET NULL | nutricionista que hizo el plan (`migrate-plan-team`, 23/07) |
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

`{id, plan_id, name, description, order, weekday, timestamps}`.

FK `plan_id` → `plans.id` ON DELETE CASCADE. `weekday` (post-sprint,
`migrate-nutricion-week-recipe-media`, 22/07) es SMALLINT NULL con CHECK 1-7
(1=Lunes … 7=Domingo); NULL = comida sin día (planes pre-rework).

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

### Las cuatro tablas del recetario (8.2, `migrate-nutricion-recipes`)

Aditivas: la estructura de arriba sigue funcionando sola; una opción puede
llevar alimentos sueltos, recetas congeladas, o las dos cosas.

#### `recipes` — catálogo de recetas

| Columna | Tipo | Notas |
| ------- | ---- | ----- |
| `id` | UUID PK | |
| `name` | VARCHAR(255) NOT NULL | |
| `description` | TEXT | |
| `created_by` | UUID NULL | `master.users.id`, sin FK física |
| `is_archived` | BOOLEAN NOT NULL DEFAULT FALSE | soft delete; índice |
| `photo_path` | VARCHAR(500) NULL | foto en disco bajo `UPLOADS_ROOT` (`lib/nutricion/recipePhotoStorage.js`); `migrate-nutricion-week-recipe-media` |
| `steps` | JSONB NOT NULL DEFAULT `[]` | pasos de preparación, en orden; misma migración |
| `external_id` | VARCHAR(120) NULL | id en Harbiz: lo que hace idempotente `import-harbiz-recetas.js` (`migrate-recetas-clasificacion`) |
| `recipe_type` | VARCHAR(40) NULL | STRING y no ENUM a propósito; valores en `lib/nutricion/recipes.js` (`TIPOS_RECETA`) |
| `tags`, `allergens`, `dietary_preferences` | TEXT[] NOT NULL DEFAULT `{}` | etiquetas libres · los 14 alérgenos legales (`ALERGENOS`) · «vegetarian», «vegan»… (`PREFERENCIAS`) |
| `duration_minutes`, `rations` | INTEGER NULL | |
| timestamps | | |

#### `recipe_foods` — ingredientes de la receta

`{id, recipe_id → recipes CASCADE, food_id → foods RESTRICT, amount, unit,
household_label, household_grams, notes, ordering, timestamps}`. Mismo modelo
de cantidad que `plan_meal_option_foods` (reutiliza el enum `g|household|free`).

#### `plan_meal_option_recipes` — receta CONGELADA dentro de una opción

| Columna | Tipo | Notas |
| ------- | ---- | ----- |
| `id` | UUID PK | |
| `plan_meal_option_id` | UUID → `plan_meal_options.id` ON DELETE CASCADE | |
| `recipe_id` | UUID NULL → `recipes.id` ON DELETE SET NULL | de dónde vino; `null` si la receta se borró |
| `name_snapshot` | VARCHAR(255) NOT NULL | |
| `servings` | NUMERIC(6,2) NOT NULL DEFAULT 1 | la ración es del menú, no de la receta |
| `steps_snapshot` | JSONB NOT NULL DEFAULT `[]` | congelados el 13/08/2026 (`migrate-nutricion-congelar-receta`, con backfill desde la receta viva) |
| `photo_path_snapshot` | VARCHAR(500) NULL | idem |
| `ordering` | INTEGER NOT NULL DEFAULT 0 | |
| timestamps | | |

#### `plan_meal_option_recipe_foods` — ingrediente congelado del snapshot

`{id, plan_meal_option_recipe_id → … CASCADE, food_id → foods, amount_snapshot,
unit_snapshot, household_label_snapshot, household_grams_snapshot,
notes_snapshot, ordering, timestamps}`.

Lo que significa «congelada» y cómo se actualiza a propósito está en
«Congelado y propagación» (§7).

---

## 4. Rutas frontend

⚠️ **Los componentes ya NO viven en `modules/overrides/nutri-laura/`**
(13/08/2026). Están en **`modules/nutricion/`**, que es donde debieron nacer:
nunca fueron un override —las cuatro páginas los usaban como valor por defecto
para cualquier cliente, con un mapa `UI_OVERRIDES` cuyo override y cuyo valor por
defecto eran el mismo componente—, y estar en la carpeta de Laura es lo que hizo
que la pestaña Pautas se quedara solo en su ficha. En `overrides/nutri-laura/`
queda lo que sí es suyo: su ficha (rótulos «Historia clínica» y «Sesiones»), su
embudo de leads y sus paneles.

| Ruta | Se llama | Componente (`modules/nutricion/`) | Descripción |
| ---- | -------- | -------------------------------- | ----------- |
| `/nutricion/alimentos` | Alimentos | `NutricionFoodsModule.jsx` | Catálogo paginado, edit inline macros, papelera (C1) |
| `/nutricion/recetas` | **Recetario** | `NutricionRecetasModule.jsx` | Catálogo de recetas con foto y pasos (8.2) |
| `/nutricion/plantillas` | Menús | `NutricionPlantillasModule.jsx` | Grid de cards con preview de comidas + contador de asignaciones, CRUD, duplicar (C3) |
| `/nutricion/asignados` | **Pautas** | `NutricionAsignadosModule.jsx` | Tabla lg / cards mobile + filtro por plantilla origen + botón "+ Nueva asignación" (C3+C4) |
| `/clientes/[id]` (tab "Pautas") | — | `ClientPlansPanel.jsx` (vive en `modules/nutricion/`; lo montan `modules/default/ClientDetailModule.jsx` y la ficha de Laura) | Plan activo + histórico colapsable + acciones (C4). **Desde el 13/08/2026 la ve cualquier cliente con `nutricion`**, no solo Laura. |

⚠️ **Quién decide si sale la pestaña Pautas es el SERVIDOR**:
`app/(dashboard)/clientes/[id]/page.jsx` mira el módulo del tenant y pasa
`conNutricion`. No se puede decidir dentro del panel porque `ClientPlansPanel`
siempre pinta algo —cargando, vacío o el error del 403—, así que nunca se
declararía vacío por su cuenta y `PanelPestana` no escondería la pestaña.

El sidebar (`components/layout/Sidebar.jsx`) tiene una entrada
"Nutrición" plegable con las 4 sub-rutas; se auto-expande cuando
`pathname.startsWith("/nutricion/")`.

⚠️ **Nombres del menú revisados el 04/08/2026** (Rodrigo): «Recetas» pasó a
**Recetario** y «Pacientes» a **Pautas**. Lo segundo era obligado: en una
consulta de nutrición el módulo Clientes ya se llama «Pacientes»
(`lib/clients/vocabulario.js`), y había dos entradas con el mismo nombre en el
mismo sidebar que además no eran lo mismo. Lo que cuelga de `/asignados` son
las PAUTAS asignadas, no la gente. **Rutas, claves y endpoints intactos**, y
el cambio viaja a todo tenant con `nutricion` — entonces `nutri_laura` y
`demo`; hoy cinco—, como cualquier cambio de módulo. En `demo` además deshace la ambigüedad de
tener «Pacientes» en Clínica y en Nutrición a la vez.

⚠️ **Vocabulario de TODO el módulo, cerrado el 04/08/2026** (Rodrigo). Las dos
palabras que se usaban indistintamente pasan a significar cosas distintas, y
así se dice en toda la UI:

| Concepto | Se llama | En BD |
| --- | --- | --- |
| El modelo reutilizable que Laura prepara una vez | **menú** (antes también «plantilla») | `plans` con `type='template'` |
| La copia que recibe una paciente concreta | **pauta** (antes «plan» o «menú») | `plans` con `type='assigned'` |

Se lee natural: «asignas un menú y se convierte en la pauta de Ana». Alcanza
el PDF (incluido su nombre de fichero, `pauta-*.pdf`), el asunto y el cuerpo
del email a la paciente, los mensajes de error de `/api/nutricion/*` y las
frases de auditoría inequívocas de `lib/actividad/etiquetas.js` (assigned,
reapplied, menu_emailed; las que valen para los dos casos se quedan en
«menú»).

**Nada de esto toca el modelo**: siguen siendo `plans` con su `type`, las
claves de auditoría no se han renombrado (romperían el histórico) y el
`PlanEditorModal` decide el rótulo en caliente con `plan.type`.

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
| GET | `/api/nutricion/foods/tags` | Secciones del catálogo con recuento (`[{tag, count}]`, solo alimentos no archivados); alimenta los desplegables de sección. |
| ~~GET~~ | ~~`/api/nutricion/foods/search-external`~~ | ELIMINADO en Nutrinotas (2026-07-18). |
| ~~POST~~ | ~~`/api/nutricion/foods/import-external`~~ | ELIMINADO en Nutrinotas (2026-07-18). |

### Recetario (8.2, 22/07/2026; clasificación 04/08; propagación 13/08)

| Método | Path | Notas |
| ------ | ---- | ----- |
| GET | `/api/nutricion/recipes` | Lista paginada. Query: `q`, `includeArchived`, filtros de clasificación, `page`, `limit` (≤100). |
| POST | `/api/nutricion/recipes` | Crea receta con ingredientes (`sanitizeIngredients`) y pasos (`sanitizeSteps`). Audita. |
| GET | `/api/nutricion/recipes/facetas` | Con qué se puede filtrar: solo los valores que EXISTEN y cuántas recetas tiene cada uno (tipos, etiquetas, alérgenos, preferencias). |
| GET / PATCH / DELETE | `/api/nutricion/recipes/[id]` | Detalle · editar (ingredientes, pasos, clasificación) · archivar. |
| POST / GET / DELETE | `/api/nutricion/recipes/[id]/photo` | Foto de la receta en disco (`lib/nutricion/recipePhotoStorage.js`: JPEG/PNG/WebP ≤5 MB, magic bytes). |
| GET / POST | `/api/nutricion/recipes/[id]/propagate` | `GET`: dónde está usada la receta y qué pautas se han quedado atrás. `POST`: refresca el snapshot solo en los planes que se le pasen (no archivados; no toca `servings` ni `ordering`). Audita `nutricion.recipe.propagated`. Ver §7. |

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
| GET | `/api/nutricion/plans/[id]/pdf` | **8.3.** El menú en PDF (`lib/nutricion/menuPdf.js`, descarga `pauta-*.pdf`). Vale para asignados (con paciente en la cabecera) y para plantillas (un menú tipo). Respeta `show_macros`. |
| POST | `/api/nutricion/plans/[id]/send-email` | **8.3.** Envía la pauta al email del paciente con el PDF adjunto (Resend con la clave del tenant, `lib/outreach/resendConfig.js`). Solo `assigned`; 400 si la ficha no tiene email; **403 en la demo** (`isDemoTenant`); anti-spam en proceso de 30 s por plan. Audita `nutricion.menu_emailed`. |

CRUD anidado de comidas/opciones/alimentos/recetas:

| Método | Path | Notas |
| ------ | ---- | ----- |
| POST/PATCH/DELETE | `/api/nutricion/plans/[id]/meals[/[mealId]]` | Comidas (C2); `PATCH` acepta también `weekday` desde el rework. |
| POST/PATCH/DELETE | `/api/nutricion/plans/[id]/meals/[mealId]/options[/[optionId]]` | Opciones (C2). |
| POST/PATCH/DELETE | `/api/nutricion/plans/[id]/meals/[mealId]/options/[optionId]/foods[/[foodId]]` | Alimentos sueltos (C2). |
| POST | `/api/nutricion/plans/[id]/meals/[mealId]/options/[optionId]/recipes` | **8.2.** Body `{recipeId, servings?}`. Mete una receta del catálogo en la opción CONGELÁNDOLA (snapshot de nombre, ingredientes, pasos y foto). |
| PATCH/DELETE | `/api/nutricion/plans/[id]/meals/[mealId]/options/[optionId]/recipes/[pmorId]` | Editar `servings` / `ordering` / nombre del snapshot · quitar la receta de la opción. |
| POST | `/api/nutricion/plans/[id]/meals/reorder` | **C5**. Reordena TODAS las comidas en una transacción. Body: `{order: [{id, order}]}`. |

Cada endpoint anidado valida pertenencia en cadena
(`assertMealBelongsToPlan` → `assertOptionBelongsToMeal` →
`assertFoodLineBelongsToOption` / `assertRecipeBelongsToOption`) para impedir
manipulación cross-plan vía path.

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

### Congelado y propagación (13/08/2026, Rodrigo)

**La pauta entregada es un documento cerrado.** Al meter una receta en un menú se
copia entera —nombre, ingredientes, **pasos y foto**— a
`plan_meal_option_recipes` / `plan_meal_option_recipe_foods`, y desde ahí no se
mueve. `attachRecipesToTree` lee del snapshot; el PDF del menú, también.

Hasta esta fecha se congelaba MEDIA receta: nombre e ingredientes sí, pasos y
foto se leían en vivo por `recipeId`. Eso daba lo peor de las dos opciones —
corregir una cantidad mal puesta no le llegaba a quien ya tenía la pauta, y
reescribir unos pasos le cambiaba pautas de hace meses sin avisar.

**Para que una corrección llegue hay una acción explícita**:
`/api/nutricion/recipes/[id]/propagate`. `GET` dice dónde está usada la receta y
cuáles se han quedado atrás; `POST` refresca el snapshot solo en los planes que
se le pasen. La UI aparece sola al guardar una receta ya usada
(`modules/nutricion/PropagarRecetaPanel.jsx`) y no interrumpe si no hay nada
desincronizado.

Tres reglas del endpoint:

- **No toca planes archivados.** Una pauta archivada es el registro de lo que se
  entregó aquel día; reescribirla sería falsearlo.
- **No toca `servings` ni `ordering`.** La ración es del menú, no de la receta:
  si alguien puso media, media se queda.
- **Se audita** (`nutricion.recipe.propagated`), al revés que la edición
  granular de un menú: reescribe de golpe lo que ya se había entregado a varias
  personas.

Los menús plantilla salen en la lista aparte y también se pueden propagar. Es lo
que arregla, de paso, «Re-aplicar menú origen»: re-aplicar copia el menú
plantilla tal cual, así que si la plantilla no se corrige, vuelve a repartir el
error.

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

**Se renombraron el 19/08/2026** de `smoke-nutri-laura-recetario-*.mjs` a
`_smoke-nutri-laura-recetario-*.mjs`: con el nombre viejo `scripts/pruebas.mjs`
(que solo recoge `_smoke-*` y `smoke-test-*`) no las veía y nadie las lanzaba.
Ahora las clasifica «servidor y base de datos», así que **entran en
`npm run test:todo`** (con la base local y `npm run dev` en marcha) y **no en
`npm test`**, que es solo para las ligeras.

| Script | Cubre |
| ------ | ----- |
| `_smoke-nutri-laura-recetario-c1.mjs` | CRUD foods + 401 sin cookie. Desde Nutrinotas comprueba que `search-external` / `import-external` responden **404** (OFF retirado), en vez de probar el import. |
| `_smoke-nutri-laura-recetario-c2.mjs` | Backend planes: CRUD plantilla + meals + options + foods (3 modos) + duplicate + assign + hadAssignments + independencia template/assigned + 401 + **POST /meals/reorder (4 casos)**. |
| `_smoke-nutri-laura-recetario-c3.mjs` | PARTE A: 14 unit tests de `lib/nutricion/macros.js` (sin red). PARTE B: HTTP/BD del backend C3 — accent-insensitive search, `withSummary=true`, recalc macros, transiciones de `unit` con nulls. |
| `_smoke-nutri-laura-recetario-c4.mjs` | Endpoints C4: `/assign` + `/reapply-template` (happy + rechazos) + `GET /api/clients/[id]/plans` + regresión anti-duplicado C2 + 401. |
| `_smoke-nutri-laura-recetario-e2e.mjs` | **C5**. Flujo completo de Laura: catálogo → plantilla → asignación → edición → reapply → histórico → PATCH plantilla con asignaciones. 50 asserts. Self-contained con cleanup robusto. |

Ejecutar: todas de una vez con el runner, o una a una (las cinco necesitan
`npm run dev` en otra terminal):

```powershell
npm run test:todo   # las cinco, junto con el resto de pruebas pesadas

node --env-file=.env.local scripts/_smoke-nutri-laura-recetario-c1.mjs
node --env-file=.env.local scripts/_smoke-nutri-laura-recetario-c2.mjs
node --env-file=.env.local scripts/_smoke-nutri-laura-recetario-c3.mjs
node --env-file=.env.local scripts/_smoke-nutri-laura-recetario-c3.mjs --only-unit  # sin dev server
node --env-file=.env.local scripts/_smoke-nutri-laura-recetario-c4.mjs
node --env-file=.env.local scripts/_smoke-nutri-laura-recetario-e2e.mjs
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

⚠️ **LA VÍA CORRECTA PARA DAR NUTRICIÓN A UN CLIENTE ES
`scripts/enable-module.js <slug> nutricion`** (13/08/2026). Hace las tres cosas
en orden: la fila en `master.tenant_modules`, las migraciones del módulo y la
siembra del catálogo base de alimentos. Los dos scripts C1/C2 de abajo son
HISTÓRICOS y están atados a `crm_nutri_laura`: no se ejecutan nunca más.

Las **ocho vivas**, en el orden en que las declara el bloque `nutricion` de
`scripts/_module-migrations.js` (todas aditivas e idempotentes; eligen los
schemas por EXISTENCIA de tabla, `scripts/_schema-targets.js`, sin mirar
`status`):

| Script | Sprint | Hace |
| ------ | ------ | ---- |
| **`migrate-nutricion-base.js`** | 13/08/2026 | **La primera del módulo.** Crea enums + las CINCO tablas cimiento (`foods`, `plans`, `plan_meals`, `plan_meal_options`, `plan_meal_option_foods`) en cualquier schema, y en una segunda pasada BLINDA las que ya existan: los 2 CHECK y los 3 índices parciales que `sequelize.sync()` no crea. Sustituye a C1+C2 como fuente de esas tablas. |
| `migrate-nutricion-recipes.js` | 8.2 (22/07) | Las cuatro tablas del recetario: `recipes`, `recipe_foods`, `plan_meal_option_recipes`, `plan_meal_option_recipe_foods`. Puramente aditiva: la estructura antigua sigue funcionando. |
| `migrate-nutricion-week-recipe-media.js` | rework (22/07) | `plan_meals.weekday` (SMALLINT 1-7, NULL = sin día) + `recipes.photo_path` + `recipes.steps`. |
| `migrate-nutricion-day-comments.js` | rework (22/07) | `plans.day_comments` JSONB (comentarios por día). |
| `migrate-nutricion-show-macros.js` | rework (22/07) | `plans.show_macros` BOOLEAN DEFAULT FALSE (decisión clínica, ver «PDF del menú»). |
| `migrate-recetas-clasificacion.js` | 04/08/2026 | `recipes.external_id`, `recipe_type`, `tags`, `allergens`, `dietary_preferences`, `duration_minutes`, `rations` — lo que hace navegable un recetario de 1.083 recetas. |
| `migrate-plan-team.js` | 23/07/2026 | `plans.team_member_id` → `team_members` (quién hizo el plan). Sin backfill. |
| **`migrate-nutricion-congelar-receta.js`** | 13/08/2026 | Añade `steps_snapshot` y `photo_path_snapshot` a `plan_meal_option_recipes` + backfill desde la receta viva. Ver «Congelado y propagación». |

Y aparte de ese bloque:

| Script | Sprint | Hace |
| ------ | ------ | ---- |
| **`migrate-auto-asignar-nutricion.js`** | 13/08/2026 | ONE_OFF de MASTER: enciende `featureFlags.autoAsignarEnAlta` a quien ya dependía del auto-marcado (`nutri_laura`). Apagado para el resto a propósito. |
| `install-unaccent-extension.js` | C3 | `CREATE EXTENSION IF NOT EXISTS unaccent` en la BD principal (es extensión a nivel de BD, no de schema): una vez por base, no por cliente. |
| `add-nutricion-module-nutri-laura.js` | C1 | **HISTÓRICO, no se ejecuta.** Creaba enums + tabla `foods` + la fila de `tenant_modules` con `uiOverride` y `externalSearchEnabled`, los dos muertos hoy (nadie lee el primero; el segundo era de OpenFoodFacts, retirado el 18/07). Lo que hacía lo hace ahora `migrate-nutricion-base` para cualquier cliente. |
| `add-nutricion-c2-plans-nutri-laura.js` | C2 | **HISTÓRICO, no se ejecuta.** Creaba las 4 tablas de planes solo en `crm_nutri_laura`. Idem. |

Comando local + producción — uno solo, que arrastra las ocho en orden y
siembra el catálogo:

```powershell
# Local
node --env-file=.env.local scripts/enable-module.js <slug> nutricion
```

```bash
# Producción (las vars vienen del entorno del contenedor Docker)
docker exec -it crm-salamandra-app-1 node scripts/enable-module.js <slug> nutricion
```

> **Histórico (hasta 13/08/2026):** aquí estaban los tres comandos
> `npm run db:add-nutricion-nutri-laura` / `db:add-nutricion-c2-nutri-laura` /
> `db:install-unaccent` y sus `docker exec` equivalentes. Los dos primeros
> estaban atados a `crm_nutri_laura`; el de `unaccent` sigue siendo necesario
> una vez por base de datos (ya está hecho en local y en producción).

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
| C5 | Smoke E2E + docs + reorder + fixes prod scripts | 2026-06-24 | 2026-06-24 (`9822e9a`) |

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

Producción: Laura tiene el sprint entero operativo. C1+C2+C3 desde el
2026-06-24, y C4+C5 con los despliegues que vinieron detrás —comprobado en el
contenedor el 12/08/2026—. Este párrafo decía que faltaba «un último deploy» y
se quedó escrito así hasta hoy.

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
