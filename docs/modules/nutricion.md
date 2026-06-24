# Módulo Nutrición — Recetario para nutri-laura

Estado: **C1+C2+C3 en producción (C3 deployed 2026-06-24). C4 implementado en local, pendiente despliegue. C5 pendiente.**

Tenant activo: `nutri_laura` (solo). El módulo `nutricion` se materializa
en `master.tenant_modules` y todo el código está pensado para escalar a
otros tenants futuros sin reescribir el backend.

---

## 1. Visión global del sprint

Mini-Harbiz dentro del CRM: la nutricionista define plantillas de plan
nutricional, las asigna a sus pacientes, y todo el cálculo de macros
se basa en un catálogo de alimentos local + búsqueda externa contra
OpenFoodFacts (OFF).

Sprint dividido en 5 checkpoints, ~10-11 días:

| Checkpoint | Alcance                                                                                          | Estado    |
| ---------- | ------------------------------------------------------------------------------------------------ | --------- |
| **C1**     | Catálogo de alimentos local + búsqueda online (OFF) + import a catálogo                          | **HECHO + prod** |
| **C2**     | Backend planes: tablas plans/meals/options/foods + endpoints CRUD + duplicate + assign + helper macros | **HECHO** |
| **C3**     | UI constructor de planes (modal Harbiz-like) + listados de plantillas y asignados + accent-insensitive search | **HECHO + prod** |
| **C4**     | UX asignación (modal 2 pasos desde /asignados) + tab Plan en ficha paciente + re-aplicar plantilla origen | **HECHO (local, pendiente prod)** |
| C5         | Smoke completo + revisión cross-checkpoint + cierre del sprint                                   | Pendiente |

**Sin kcal**: se trabaja solo con proteínas / carbohidratos / grasas /
fibra (g por 100 g del alimento). Las kcal se calcularían sumando
macros ponderadas, pero la nutricionista no quiere mostrar ese número
en el plan (decisión de C0).

---

## 2. Activación del módulo

El proyecto no tiene una tabla maestra `master.modules` (los módulos se
registran implícitamente al insertar filas en `master.tenant_modules`).
Por eso "registrar el módulo" en C1 = ejecutar la migración:

```powershell
npm run db:add-nutricion-nutri-laura          # local
npm run db:add-nutricion-nutri-laura:prod     # VPS (no usado en C1)
```

Lo que hace `scripts/add-nutricion-module-nutri-laura.js`:

1. Crea los enums `enum_foods_default_unit` y `enum_foods_source` y la
   tabla `foods` en `crm_nutri_laura` (idempotente).
2. Crea la fila `master.tenant_modules` para `(nutri_laura, nutricion)`
   con:
   - `enabled = true`
   - `uiOverride = 'nutri-laura/NutricionFoodsModule'`
   - `featureFlags.externalSearchEnabled = true`
3. Añade `"nutricion"` al `moduleAccess` del admin
   (`admin@nutri-laura.es`).

**No se crea la tabla `foods` en otros schemas tenant** — el catálogo
es específico de nutri-laura. Si otro tenant quiere usarlo, basta con
re-ejecutar la migración cambiando el slug y registrar la fila en
`tenant_modules` por su lado.

---

## 3. Modelo de datos — tabla `foods`

Schema `crm_nutri_laura`, tabla `foods`:

| Columna              | Tipo                            | Notas                                                          |
| -------------------- | ------------------------------- | -------------------------------------------------------------- |
| `id`                 | UUID PK                         | `gen_random_uuid()`                                            |
| `name`               | VARCHAR(255) NOT NULL           | Indexado                                                       |
| `slug`               | VARCHAR(255)                    | Indexado, auto-generado desde `name`                           |
| `default_unit`       | ENUM `g\|ml\|unidad`            | Default `g`                                                    |
| `protein_per_100`    | NUMERIC(8,2) NULL               | Gramos de proteína por 100 g                                   |
| `carbs_per_100`      | NUMERIC(8,2) NULL               | Gramos de carbs por 100 g                                      |
| `fat_per_100`        | NUMERIC(8,2) NULL               | Gramos de grasa por 100 g                                      |
| `fiber_per_100`      | NUMERIC(8,2) NULL               | Gramos de fibra por 100 g                                      |
| `household_measures` | JSONB NOT NULL DEFAULT `[]`     | Array de `{ label, grams }`                                    |
| `source`             | ENUM `openfoodfacts\|custom`    | Default `custom`                                               |
| `external_id`        | VARCHAR(255)                    | Code/barcode de OFF si `source='openfoodfacts'`                |
| `barcode`            | VARCHAR(255)                    | Código de barras del producto, si lo tiene                     |
| `tags`               | TEXT[] NOT NULL DEFAULT `{}`    | Tags libres                                                    |
| `archived_at`        | TIMESTAMPTZ NULL                | Soft delete                                                    |
| `created_at`         | TIMESTAMPTZ NOT NULL DEFAULT `now()` |                                                          |
| `updated_at`         | TIMESTAMPTZ NOT NULL DEFAULT `now()` |                                                          |

Índices: `name`, `slug`, `external_id`, `barcode` (todos no únicos).

Modelo Sequelize: `models/tenant/Food.model.js`. Las columnas se
exponen con camelCase: `defaultUnit`, `proteinPer100`, `householdMeasures`,
`externalId`, `archivedAt`, …

### Seed de medidas caseras

Cuando se crea un alimento (manual o importado) sin household_measures,
la API inicializa el array con esta lista — **exactamente igual** que
la spec de C1:

```js
[
  { label: "1 cucharada",       grams: 15  },
  { label: "1 cucharadita",     grams: 5   },
  { label: "1 unidad pequeña",  grams: 50  },
  { label: "1 unidad mediana",  grams: 80  },
  { label: "1 unidad grande",   grams: 120 },
  { label: "1 puñado",          grams: 30  },
  { label: "1 taza",            grams: 240 },
  { label: "1 vaso",            grams: 250 },
  { label: "1 lata",            grams: 120 },
]
```

Fuente de verdad: `lib/nutricion/foods.js → HOUSEHOLD_MEASURES_SEED`.

---

## 4. Endpoints REST (C1)

Base: `/api/nutricion/foods`. Todos requieren JWT válido + tenant con
módulo `nutricion` activado. Sin auth → **401** (middleware). Con auth
pero sin el módulo → **403** (handler).

### GET `/api/nutricion/foods`

Lista paginada (filtra `archived_at IS NULL`).

Query params:

| Param  | Default | Notas                                |
| ------ | ------- | ------------------------------------ |
| `q`    | —       | búsqueda iLike en `name`             |
| `tag`  | —       | filtra por tag exacto (Op.contains)  |
| `source` | —     | `openfoodfacts` o `custom`           |
| `limit`  | 50    | máx. 100                             |
| `page`   | 1     | paginación 1-based                   |

Response:

```json
{
  "ok": true,
  "items": [ { "id": "…", "name": "…", "defaultUnit": "g", … } ],
  "total": 42,
  "page": 1,
  "limit": 50
}
```

### GET `/api/nutricion/foods/[id]`

Devuelve el alimento. `404` si `archived_at` o no existe.

### POST `/api/nutricion/foods`

Crea un alimento manual.

Body mínimo: `{ "name": "Aceite de oliva" }`.

Body opcional:

```jsonc
{
  "name": "Aceite de oliva",
  "defaultUnit": "ml",
  "proteinPer100": 0,
  "carbsPer100": 0,
  "fatPer100": 100,
  "fiberPer100": 0,
  "tags": ["grasas-buenas"],
  "householdMeasures": [{ "label": "1 cucharada", "grams": 15 }]
}
```

`source` se fuerza a `"custom"`. `slug` se autogenera con
`slugifyName(name)`. Si `householdMeasures` viene vacío o no se manda,
se aplica el seed por defecto.

Response: `{ ok: true, data: { …food creado… } }` (200 → wrapper `created()`
devuelve 201).

Audit: `nutricion.food.created`.

### PATCH `/api/nutricion/foods/[id]`

Body parcial. Campos editables: `name`, `defaultUnit`, las 4 macros,
`tags`, `householdMeasures`, `barcode`. Validaciones equivalentes al
POST.

**Protección de source**: si el cliente envía `source` distinto al actual,
422. Los datos nutricionales SÍ son editables siempre (la nutricionista
puede corregir valores que OFF tenga incompletos).

Audit: `nutricion.food.updated`.

### DELETE `/api/nutricion/foods/[id]`

Soft delete (`archivedAt = now()`). Response: 204 sin body.

**TODO C2**: verificar que el alimento no esté en uso en
`plan_meal_option_foods` antes de archivar. Por ahora se permite
siempre.

Audit: `nutricion.food.archived`.

### GET `/api/nutricion/foods/search-external?q=…`

Proxy a OpenFoodFacts. Llama a:

```
https://world.openfoodfacts.org/cgi/search.pl
  ?search_terms=Q
  &search_simple=1
  &action=process
  &json=1
  &page_size=20
  &fields=code,product_name_es,product_name,brands,nutriments
```

Timeout 8s (AbortController). Si OFF falla o el feature flag
`externalSearchEnabled` está apagado, responde **200** con
`{ ok: true, items: [], external_error: true }` — no rompe la UI.

Response normalizada:

```json
{
  "ok": true,
  "items": [
    {
      "external_id": "3017620422003",
      "name": "Nutella",
      "brand": "Ferrero",
      "protein_per_100": 6.3,
      "carbs_per_100": 57.5,
      "fat_per_100": 30.9,
      "fiber_per_100": null,
      "source": "openfoodfacts"
    }
  ]
}
```

### POST `/api/nutricion/foods/import-external`

Body: `{ "external_id": "3017620422003" }`.

Flujo:

1. Si ya hay un `food` local activo con ese `external_id` → devuelve el
   existente (idempotente; no duplica).
2. Si no, busca el producto en OFF vía
   `https://world.openfoodfacts.org/api/v2/product/{code}.json`.
3. Si OFF cae → **502** `OpenFoodFacts no disponible`.
4. Si OFF no lo conoce → **404** `Alimento no encontrado en OpenFoodFacts`.
5. Si lo encuentra → crea fila con `source='openfoodfacts'`, copia macros,
   `barcode = external_id`, `householdMeasures = HOUSEHOLD_MEASURES_SEED`.

Audit: `nutricion.food.imported_from_off`.

---

## 5. Frontend — patrón de override

Carpeta: `modules/overrides/nutri-laura/`.

| Archivo                           | Rol                                                                  |
| --------------------------------- | -------------------------------------------------------------------- |
| `NutricionFoodsModule.jsx`        | Página principal: tabla paginada, buscador, botones, edit inline     |
| `FoodEditModal.jsx`               | Modal lateral (drawer) crear/editar alimento + medidas caseras + tags |
| `FoodSearchExternalModal.jsx`     | Modal lateral búsqueda OpenFoodFacts + botón "Añadir a mi catálogo"  |

Página wrapper: `app/(dashboard)/nutricion/alimentos/page.jsx` con un
mapa `UI_OVERRIDES = { nutri_laura: NutricionFoodsModule }`. Si el tenant
no es nutri_laura (no aplicable en C1 porque el módulo solo está activado
ahí), igualmente cae al componente nutri-laura (no hay default por ahora).

Detalles UI:

- Edit inline en las 4 macros (`EditableMacro`): click → input number,
  blur o Enter persiste con PATCH, Esc revierte. Toast "Guardado" /
  "Error al guardar".
- Pagination 20 por página, controles "Anterior" / "Siguiente".
- Modal de búsqueda hace auto-search 500 ms después de teclear (≥ 2 chars).
- Estética terracota: usa `var(--color-primary)` y `var(--color-accent)`
  del brand de nutri_laura (`#A97873` / `#F7F1EB`).
- Drawer respeta la barra móvil del dashboard: `top-14 lg:top-0 ... bottom-0`
  (regla #13 de CLAUDE.md).

Sidebar: la entrada "Nutrición" en `components/layout/Sidebar.jsx`
apunta a `/nutricion/alimentos`. Solo aparece para tenants con el módulo
`nutricion` activado (lógica existente: filtrado por `enabledModules`).

---

## 6. Por qué OpenFoodFacts

OFF es una base de datos abierta y gratuita de productos alimentarios
con millones de entradas. Ventajas para nutri_laura:

- API REST pública y gratuita.
- Datos nutricionales por 100 g ya normalizados (`nutriments['proteins_100g']`
  etc.).
- Buscable en español (`product_name_es` cuando existe).
- Sin API key — solo conviene mandar User-Agent identificativo.

Lo que hacemos:

- Búsqueda en `/cgi/search.pl` para la UI de "Buscar online".
- Detalle por código en `/api/v2/product/{code}.json` para importar al
  catálogo local.

Política ante caída de OFF:

- Endpoints CRM siguen funcionando (catálogo local intacto).
- `search-external` responde 200 con `external_error: true`. La UI
  muestra un banner amarillo: "No hemos podido conectar con
  OpenFoodFacts…".
- `import-external` responde 502 si no puede contactar con OFF (es un
  fallo de operación, no un input inválido).

User-Agent enviado: `Salamandra-CRM/1.0 (nutricion module)` — útil si
OFF necesita rate-limit selectivo.

---

## 7. Smoke test

Script: `scripts/smoke-nutri-laura-recetario-c1.mjs`.

Ejecuta 12 casos cubriendo CRUD, search-external, import idempotente,
OFF caído (mock in-process), permisos y cleanup. Estructura idéntica a
`smoke-nutri-laura-c4.mjs`:

- Sin `SMOKE_PASSWORD` cae a Sequelize directo para todo lo que requiere
  admin del CRM.
- El test "OFF caído" se ejecuta in-process llamando a
  `searchOpenFoodFacts()` con `globalThis.fetch` monkey-patched.
  El endpoint HTTP no se puede mockear desde el smoke porque corre en el
  proceso del dev server; documentado como decisión consciente.
- El test "Permisos" verifica el bounce de middleware (401 sin cookie).
  Forzar el path `hasModule → 403` requiere autenticar contra otro
  tenant — documentado como pendiente cuando exista un tenant adicional
  con admin testeable.

Lanzar:

```powershell
# Dev server en otra terminal
npm run dev

# Smoke (sin auth HTTP completa)
node --env-file=.env.local scripts/smoke-nutri-laura-recetario-c1.mjs

# Smoke con auth HTTP (admin nutri_laura)
$env:SMOKE_PASSWORD = "<password>"
node --env-file=.env.local scripts/smoke-nutri-laura-recetario-c1.mjs
```

---

## 8. Decisiones tomadas durante C1

1. **`master.modules` no existe** → el módulo se "registra" insertando
   en `tenant_modules` para nutri_laura. Si en el futuro montamos un
   catálogo global de módulos, este punto se actualizará.
2. **Source protegido en PATCH**: no permitimos cambiar de
   `openfoodfacts` ↔ `custom` desde la UI/API. La nutricionista sí
   puede editar libremente los valores nutricionales aunque el alimento
   venga importado (corrección de datos imprecisos).
3. **`barcode` se rellena con `external_id`** al importar de OFF, porque
   el `code` que devuelve OFF ES el código de barras EAN/UPC. Para
   alimentos manuales el campo queda libre, editable desde el modal.
4. **Soft delete vía `archived_at`** + las queries de listado filtran
   por `archived_at IS NULL`. No verificamos referencias en
   `plan_meal_option_foods` (no existe esa tabla en C1); TODO comentado
   en el handler DELETE.
5. **Feature flag `externalSearchEnabled`** en `tenant_modules`. Activado
   en C1. Si Laura quiere apagar la búsqueda online (p. ej. mientras OFF
   está degradado), basta con flipear el flag en `master.tenant_modules`
   sin desplegar.
6. **Smoke caso 11 (tenant sin módulo → 403)**: cubierto vía 401 del
   middleware sin cookie, no exigiendo un segundo tenant. Cuando exista
   otro tenant donde queramos validar el 403, el smoke se extiende.
7. **Smoke caso 10 (OFF caído)**: testeado in-process con `fetch`
   monkey-patched sobre el lib helper. El endpoint HTTP no es testable
   sin un MSW/mock-server cross-process, fuera del alcance de C1.
8. **Slug auto-generado** en `name` (POST + PATCH). Sin restricción de
   unicidad — Laura puede tener "Aceite de oliva" y "Aceite de oliva
   virgen extra" sin conflicto.
9. **Sin rate limit propio sobre OFF**: confiamos en el timeout de 8 s
   y en que la búsqueda es por interacción manual. Si OFF nos baja por
   abuso, lo cambiaremos cuando suceda (revisión cuando C3 esté listo).
10. **Sidebar entry**: una sola subsección visible en C1 ("Alimentos");
    Plantillas y Asignados se añadirán en C3.

---

## 9. Backlog / mejoras detectadas para C2+

- Subir tabla `plan_templates` + tablas hijo (`plan_template_days`,
  `plan_template_meals`, `plan_template_meal_options`,
  `plan_template_meal_option_foods`).
- Modal grande "Constructor de plantilla" estilo Harbiz (días con tabs,
  drag&drop de comidas — autorizado en C3).
- En el DELETE de food, validar referencias contra
  `plan_template_meal_option_foods` (y `assigned_plan_*` cuando exista
  en C3/C4).
- Endpoint `GET /api/nutricion/foods` con flag `includeArchived=true`
  para una futura "papelera" (no necesario en C1).
- Verificar y forzar HTTP cache-control en `search-external` para no
  saturar OFF si la UI hace queries rápidas en sucesión.
- Hoy `householdMeasures` se devuelve también para alimentos en la
  lista; cuando el catálogo crezca podríamos no devolverlo en list y
  solo en detail.
- En el modal "Buscar online", capturar más campos de OFF (categorías,
  imagen del producto) cuando los necesitemos en C3.
- Tests de regresión automatizados (más allá del smoke) para los
  validators de macros y `sanitizeMeasures`/`sanitizeTags`.

---

## C2 — Planes (plantillas + asignados)

Estado: **HECHO en local** (2026-06-23). Aún sin UI; la UI es C3.

### 10. Modelo de datos C2

Schema `crm_nutri_laura`, 4 tablas nuevas:

#### `plans` — plantilla o plan asignado

| Columna             | Tipo                          | Notas                                                       |
| ------------------- | ----------------------------- | ----------------------------------------------------------- |
| `id`                | UUID PK                       |                                                             |
| `name`              | VARCHAR(255) NOT NULL         |                                                             |
| `description`       | TEXT                          | "Comentarios" estilo Harbiz                                 |
| `type`              | ENUM `template\|assigned`      | NOT NULL                                                    |
| `template_id`       | UUID → `plans.id` ON DELETE SET NULL | NULL para plantillas; FK al template origen si asignado |
| `client_id`         | UUID                          | NULL para plantillas; sin FK física (igual que Booking)     |
| `visible_to_client` | BOOLEAN NOT NULL DEFAULT FALSE| "Visible para el paciente" (uso en C4 portal)               |
| `assigned_at`       | TIMESTAMPTZ                   | Cuándo se asignó (NULL si template)                         |
| `archived_at`       | TIMESTAMPTZ                   | Soft delete                                                 |
| `created_at`        | TIMESTAMPTZ NOT NULL          |                                                             |
| `updated_at`        | TIMESTAMPTZ NOT NULL          |                                                             |

**CHECK `plans_type_client_chk`:**

```sql
(type = 'template' AND client_id IS NULL  AND assigned_at IS NULL)
OR
(type = 'assigned' AND client_id IS NOT NULL AND assigned_at IS NOT NULL)
```

Índices: `plans_type_idx` (type), `plans_client_id_idx` (parcial), `plans_template_id_idx` (parcial), `plans_archived_at_idx` (parcial).

#### `plan_meals` — comidas dentro del plan

| Columna       | Tipo                                                    | Notas                                  |
| ------------- | ------------------------------------------------------- | -------------------------------------- |
| `id`          | UUID PK                                                 |                                        |
| `plan_id`     | UUID NOT NULL → `plans.id` ON DELETE CASCADE            |                                        |
| `name`        | VARCHAR(255) NOT NULL                                   | Texto libre ("Desayuno", "Snack"…)     |
| `description` | TEXT                                                    | "DESAYUNO + BEBIDA + FRUTA"            |
| `order`       | INTEGER NOT NULL                                        |                                        |
| timestamps    |                                                         |                                        |

Índice: `plan_meals_plan_id_idx`.

#### `plan_meal_options` — opciones de una comida (alternativas)

| Columna     | Tipo                                                    | Notas                                  |
| ----------- | ------------------------------------------------------- | -------------------------------------- |
| `id`        | UUID PK                                                 |                                        |
| `meal_id`   | UUID NOT NULL → `plan_meals.id` ON DELETE CASCADE       |                                        |
| `name`      | VARCHAR(255) NOT NULL DEFAULT 'Opción 1'                |                                        |
| `order`     | INTEGER NOT NULL                                        |                                        |
| `is_default`| BOOLEAN NOT NULL DEFAULT FALSE                          | Solo una true por meal (validado en API)|

Índice: `plan_meal_options_meal_id_idx`.

#### `plan_meal_option_foods` — alimento concreto dentro de una opción

| Columna           | Tipo                                                       | Notas                                                                 |
| ----------------- | ---------------------------------------------------------- | --------------------------------------------------------------------- |
| `id`              | UUID PK                                                    |                                                                       |
| `option_id`       | UUID NOT NULL → `plan_meal_options.id` ON DELETE CASCADE   |                                                                       |
| `food_id`         | UUID NOT NULL → `foods.id` **ON DELETE RESTRICT**          | No se puede archivar un food si está en uso aquí (RESTRICT)           |
| `amount`          | NUMERIC(10,2) NULL                                         | gramos directos (`g`) o número de medidas caseras (`household`)       |
| `unit`            | ENUM `g\|household\|free` NOT NULL                          |                                                                       |
| `household_label` | VARCHAR(255) NULL                                          | "1 cucharada", "1 lata"… SOLO si unit='household'                     |
| `household_grams` | NUMERIC(10,2) NULL                                         | gramos asociados al label, copiados del catálogo al insertar          |
| `notes`           | TEXT                                                       |                                                                       |
| `order`           | INTEGER NOT NULL                                           |                                                                       |
| timestamps        |                                                            |                                                                       |

**CHECK `plan_meal_option_foods_unit_chk`:**

```sql
(unit = 'g'         AND amount IS NOT NULL AND household_label IS NULL     AND household_grams IS NULL)
OR
(unit = 'household' AND amount IS NOT NULL AND household_label IS NOT NULL AND household_grams IS NOT NULL)
OR
(unit = 'free'      AND amount IS NULL     AND household_label IS NULL     AND household_grams IS NULL)
```

Índices: `plan_meal_option_foods_option_id_idx`, `plan_meal_option_foods_food_id_idx`.

### 11. Decisión arquitectónica: plantillas mutables, asignados independientes

Validada por Jorge en C0:

- **Plantillas son editables** después de tener asignaciones. El backend no
  bloquea PATCH si el template tiene asignaciones vivas.
- **Asignados son deep-copy** del template en el momento del `POST /assign`.
  Después viven completamente independientes: editar la plantilla NO toca
  al paciente.
- **No hay propagación automática**: cuando Laura quiera "re-aplicar" los
  cambios de la plantilla a un paciente, lo hará manualmente. El botón
  "Re-aplicar plantilla origen" se añadirá en C4 sobre la ficha paciente.
- **Aviso en frontend**: el `PATCH /plans/[id]` devuelve
  `{ ok: true, hadAssignments: <count>, plan }`. El frontend, en C3,
  muestra modal de advertencia tipo:

  > Esta plantilla está asignada a {hadAssignments} pacientes. Tus cambios
  > NO se aplicarán automáticamente a sus planes existentes. ¿Continuar?

Razones para esta política:
- Evita sobreescrituras silenciosas que cambien la dieta de un paciente sin
  el consentimiento de Laura.
- Mantiene la auditoría limpia: cada cambio en un asignado tiene su propio
  AuditLog, no se confunde con un cambio del template.

### 12. Decisión arquitectónica: tabla `plans` única (no dos tablas)

Confirmado el diseño recomendado por el spec:

- Una sola tabla `plans` con `type='template' | 'assigned'` y `template_id`
  self-FK.
- Estructura idéntica para meals/options/foods en ambos modos.
- Deep-copy = INSERT del plan row + INSERT en cascada de meals/options/foods
  cambiando solo el `plan_id`.

Ventajas frente a 2 tablas:
- Mismas FKs (`PlanMeal.planId` referencia a una sola tabla).
- Queries comunes: `WHERE type='assigned' AND client_id=X`,
  `WHERE type='template'`.
- Helper `deepCopyPlanTree` se reutiliza para `/duplicate` (template→template)
  y para `/assign` (template→assigned).

Pequeño coste: índice `plans_type_idx` evidencia la cardinalidad esperada.

### 13. Endpoints REST C2

Base: `/api/nutricion/plans`. Mismo `withTenant` + `hasModule('nutricion')`
de C1. Sin auth → **401**. Con auth pero sin módulo → **403**.

#### Listado y detalle

| Método | Path                            | Notas |
| ------ | ------------------------------- | ----- |
| GET    | `/api/nutricion/plans`          | Query: `type` (req: `template\|assigned`), `q`, `clientId`, `includeArchived`, `page`, `limit`. Solo metadata (sin árbol). Response: `{ ok, items, total, page, limit }`. |
| GET    | `/api/nutricion/plans/[id]`     | Detalle con árbol completo meals→options→foods. Cada `food` anidado lleva el snapshot del catálogo (`food.food.name`, macros…). Orden por `order` ASC en los 3 niveles. |

#### Plantillas

| Método | Path                                  | Notas |
| ------ | ------------------------------------- | ----- |
| POST   | `/api/nutricion/plans`                | Crea plantilla vacía. Body: `{ name, description? }`. `type` forzado a `template`. Audit: `nutricion.plan.created`. |
| PATCH  | `/api/nutricion/plans/[id]`           | Edita `name`, `description`, `visibleToClient`. Bloquea cambio de `type`, `templateId`, `clientId`. Response: `{ ok, hadAssignments, plan }`. Audit: `nutricion.plan.updated`. |
| DELETE | `/api/nutricion/plans/[id]`           | Soft delete (`archivedAt = now()`). Devuelve 204. Audit: `nutricion.plan.archived`. |
| POST   | `/api/nutricion/plans/[id]/duplicate` | Solo plantillas. Body opcional `{ name }` (default `"{name} - Copia"`). Deep-copy en transacción. Audit: `nutricion.plan.duplicated`. |
| POST   | `/api/nutricion/plans/[id]/assign`    | Solo plantillas. Body: `{ clientId, nameOverride? }`. Valida `Client.findByPk`; 409 si ya hay asignación activa de esa plantilla a ese cliente. Audit: `nutricion.plan.assigned`. |

#### Comidas (meals)

| Método | Path                                                | Notas |
| ------ | --------------------------------------------------- | ----- |
| POST   | `/api/nutricion/plans/[id]/meals`               | Body: `{ name, description?, order? }`. Si `order` ausente, max+1. |
| PATCH  | `/api/nutricion/plans/[id]/meals/[mealId]`      | Parcial. Verifica que `mealId` pertenece a `planId`. |
| DELETE | `/api/nutricion/plans/[id]/meals/[mealId]`      | Hard delete (CASCADE elimina options + foods). |

#### Opciones de comida

| Método | Path                                                                       | Notas |
| ------ | -------------------------------------------------------------------------- | ----- |
| POST   | `/api/nutricion/plans/[id]/meals/[mealId]/options`                     | Body: `{ name?, order?, isDefault? }`. Default name=`"Opción N+1"`. Si `isDefault=true`, transacción que pone `false` en las demás opciones de la misma comida. |
| PATCH  | `/api/nutricion/plans/[id]/meals/[mealId]/options/[optionId]`          | Parcial. `isDefault=true` aplica la misma regla de unicidad en transacción. |
| DELETE | `/api/nutricion/plans/[id]/meals/[mealId]/options/[optionId]`          | Hard delete (CASCADE foods). |

#### Alimentos dentro de una opción

| Método | Path                                                                                       | Notas |
| ------ | ------------------------------------------------------------------------------------------ | ----- |
| POST   | `…/options/[optionId]/foods`                                                               | Body: `{ foodId, unit, amount?, householdLabel?, householdGrams?, notes?, order? }`. Reglas CHECK validadas en API; si fuese eludido el CHECK de BD reciclamos 400 con mensaje. |
| PATCH  | `…/options/[optionId]/foods/[foodId]`                                                      | Parcial. `foodId` del path es el id de la fila, NO del food del catálogo. No se permite cambiar `food_id` (borrar + crear). |
| DELETE | `…/options/[optionId]/foods/[foodId]`                                                      | Hard delete. |

Valides en cascada (`assertMealBelongsToPlan` → `assertOptionBelongsToMeal` →
`assertFoodLineBelongsToOption`) en cada endpoint anidado para que un
admin no pueda tocar entidades de OTRO plan vía path manipulado.

### 14. Helper de macros — `lib/nutricion/macros.js`

Sin kcal nunca. Operación sobre la representación serializada del plan
(plain objects, las que devuelve `loadPlanTree`).

| Helper                       | Devuelve                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------- |
| `computeFoodMacros(line)`    | `{ protein, carbs, fat, fiber }` (g absolutos) de una línea PlanMealOptionFood.                  |
| `computeOptionMacros(opt)`   | Suma de macros de los foods de la opción. null si TODAS las líneas reportan null para ese macro.  |
| `computeMealMacros(meal)`    | Macros de la opción `is_default=true` (o, en su defecto, la de menor `order`).                    |
| `computePlanMacros(plan)`    | Suma de las comidas (sus defaults).                                                               |

Conversión por modo:

- `unit='g'`         → `amount × macro/100`.
- `unit='household'` → `householdGrams × macro/100`.
- `unit='free'`      → `{ null, null, null, null }` (texto libre, no calculable).

Resultados redondeados a 2 decimales en cada nivel; el frontend hace el
redondeo final de visualización.

### 15. Smoke C2

Script: `scripts/smoke-nutri-laura-recetario-c2.mjs`. 19 casos / ~40 asserts.

Casos:
1. Health + tablas + food del catálogo.
2. Pre-cleanup.
3. POST plantilla vacía.
4. PATCH metadata → `hadAssignments=0`.
5. POST meal "Desayuno".
6. POST option `is_default=true`.
7. POST food `unit='g'` amount=80.
8. POST food `unit='household'` con label/grams.
9. POST food `unit='free'` (amount=null).
10. POST food `unit='g'` + amount=null → 400 (CHECK).
11. GET árbol completo (3 foods anidados con `food` del catálogo).
12. POST `/duplicate` → árbol clonado + IDs distintos.
13. POST `/assign` con clientId → plan asignado + árbol completo.
14. POST `/assign` mismo clientId → 409 (antiduplicado).
15. PATCH plantilla con 1 asignación → `hadAssignments=1`.
16. DELETE plan asignado → `archived_at` set; plantilla intacta.
17. DELETE plantilla con asignaciones → `archived_at` set en plantilla;
    asignaciones VIVAS siguen activas con sus foods.
18. Permisos: GET sin cookie → 401.
19. Cleanup post-run.

Auth: mismo patrón que C1 (SMOKE_PASSWORD o firma JWT directa).

### 16. Decisiones tomadas durante C2

1. **`clientId` sin FK física a `clients`** (igual que `Booking.client_id`
   en nutri_laura). La integridad la valida el endpoint `/assign` con
   `Client.findByPk` antes de crear el plan. Razón: ya existe el precedente
   y mantiene consistencia con el resto del schema.
2. **`PlanMealOptionFood.food_id` SÍ tiene FK física con ON DELETE RESTRICT.**
   Esto bloquea el `archivedAt` lógico del food a nivel de aplicación si la
   nutricionista intenta archivar un alimento en uso. En C2 el endpoint
   DELETE de food (de C1) NO comprueba referencias (sigue siendo soft delete
   sin chequeo); en C3 se añadirá la validación previa para mostrar mensaje
   amigable.
3. **`isDefault` unicidad NO se enforce a nivel BD** (no hay UNIQUE INDEX
   parcial). Se enforce en la API dentro de transacciones (POST/PATCH option).
   Razón: simplicidad de migración, y si en futuro queremos permitir 0 o
   varios defaults para experimentar, no hay que migrar.
4. **PATCH plantilla NO bloquea aunque haya asignaciones.** Devuelve
   `hadAssignments` para que el frontend pueda mostrar advertencia. Si
   queremos política más estricta, lo cambiamos en C3 sin migración.
5. **`/duplicate` siempre crea otra `template`**, nunca un asignado. Para
   crear un asignado se usa `/assign` con `clientId`.
6. **Borrar food del catálogo cuando está en uso → restringido a nivel BD**.
   El endpoint DELETE de C1 (soft delete) sigue funcionando porque el food
   no se elimina físicamente; solo se setea `archivedAt`. Como la FK es
   `food_id` y la fila sigue existiendo, no rompe nada. En C3 se mostrará
   un aviso "este food está en uso en N planes" si Laura intenta archivarlo.
7. **Soft delete en cascada NO**: archivar una plantilla NO archiva las
   asignaciones (la independencia es el punto clave). El smoke 17 lo
   verifica explícitamente.
8. **El `Food` de `PlanMealOptionFood.food` viene eager-loaded con sus
   macros**. Eso permite calcular macros en el frontend sin queries extra.
   Si el food fue archivado, viene igualmente (la FK no filtra por
   `archivedAt`); el frontend puede mostrar "alimento archivado" en C3.
9. **`/api/nutricion/plans/[id]/meals/[mealId]/options/[optionId]/foods/[foodId]`**
   es un path largo pero refleja la jerarquía real. Cuando llegue C3 con
   drag&drop entre opciones, posiblemente añadiremos un endpoint
   `POST /reorder` aparte. Por ahora, mantener este patrón.
10. **Sin `kcal`**: helper macros no expone kcal en ningún nivel. Si
    alguna vez Laura quiere mostrar kcal, calcularlo en el frontend con la
    fórmula estándar (4p + 4c + 9f) — no añadirlo en BD.

### 17. Backlog detectado en C2

- Endpoint `POST /api/nutricion/plans/[id]/meals/reorder` con array
  de `{ id, order }` para mover comidas en una transacción (preferible a
  N PATCH).
- Igual para options dentro de una comida y foods dentro de una opción.
- Endpoint `GET /api/nutricion/plans/[id]?includeMacros=true` que devuelva
  el árbol + macros calculados por nivel, usando `lib/nutricion/macros.js`.
- Validación al archivar un food (C1 DELETE) consultando
  `PlanMealOptionFood.count({ where: { foodId } })` y devolviendo 409
  con el número de planes que lo usan.
- Cuando llegue C3 + C4: portal del paciente (`visibleToClient=true`) con
  ruta `/portal/nutricion/mi-plan` para que el paciente vea su plan
  activo.
- Test unit del helper macros con casos de borde (null en una macro pero
  no en otras, mix de free + g, etc.). En C2 está cubierto solo
  indirectamente vía smoke (el endpoint de detalle hidrata las macros).
- En `PATCH .../foods/[foodId]`, si `body.foodId !== line.foodId`, hoy
  devuelve 422. Mejor: aceptar ese cambio en transacción si el food
  destino existe (cambio de alimento manteniendo amount/unit). C3 puede
  implementarlo cuando el modal Harbiz lo necesite.

---

## C3 — UI Constructor de planes (modal + listados)

Estado: **HECHO en local** (2026-06-24). Pendiente de despliegue a prod.

### 18. Rutas frontend (3 sub-secciones)

| Ruta                          | Componente                                                  | Propósito                                                  |
| ----------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------- |
| `/nutricion/alimentos`        | `NutricionFoodsModule.jsx` (sin cambios C3)                 | Catálogo (C1)                                              |
| `/nutricion/plantillas`       | `NutricionPlantillasModule.jsx`                             | Grid de cards de plantillas; CRUD + duplicar + abrir modal |
| `/nutricion/asignados`        | `NutricionAsignadosModule.jsx`                              | Tabla (lg+) / cards (<lg) de planes asignados              |
| Modal (no ruta)               | `PlanEditorModal.jsx`                                       | Editor grande tipo Harbiz reutilizable en ambas vistas     |

Las 3 sub-rutas se enlazan en `components/layout/Sidebar.jsx` como
sub-entradas plegables debajo de "Nutrición" — solo visibles cuando el
usuario navega a `/nutricion/*`.

### 19. Mejora retroactiva — búsqueda case+accent insensitive (C1)

`GET /api/nutricion/foods?q=…` ahora usa
`unaccent(LOWER(name)) LIKE unaccent(LOWER('%q%'))` en Postgres cuando
la extensión `unaccent` está disponible en la BD. Detectamos su
presencia una vez por instancia Sequelize (`hasUnaccentSupport` en
`lib/nutricion/foods.js`) y cacheamos el resultado.

Instalación de la extensión (idempotente):

```powershell
# Local (requiere superuser o rol con permiso CREATE EXTENSION)
npm run db:install-unaccent

# Producción
docker exec -it crm-salamandra-app-1 node scripts/install-unaccent-extension.js
```

Si la extensión NO se ha instalado, el endpoint hace fallback a
`ILIKE` plano (case-insensitive solamente, sin tildes). Las filas
recuperadas se post-filtran en JS contra `normalizeForSearch(q)` para
recortar resultados espurios — pero la paginación puede quedar
sub-óptima (count no se recalcula). Backlog: cargar todo el catálogo y
paginar en JS cuando el fallback esté activo.

La búsqueda externa (OpenFoodFacts) ya era case-insensitive por
defecto. No tocamos ese endpoint.

El autocomplete de alimentos del modal C3 usa el mismo endpoint, por lo
que hereda la insensibilidad accent+case.

### 20. Endpoint `GET /api/nutricion/plans?withSummary=true`

Nuevo query param sobre el endpoint del C2. Cuando se activa:

- Para cualquier `type`: añade `mealsSummary: [{ id, name, optionCount }]`
  y `mealCount` a cada plan del listado, en una sola query (include +
  agregado en JS).
- Para `type=template`: añade `activeAssignmentsCount` (cuenta
  agrupada de planes `type='assigned'` activos cuyo `templateId` es
  ese — se hace en una segunda query agregada, NO N+1).
- Para `type=assigned`: añade `clientName` (de `Client`) y
  `templateName` (de `Plan` self-FK) eager-loaded.

Las tarjetas de plantillas y la tabla de asignados consumen este
formato. Sin el flag, el endpoint sigue devolviendo lo mismo que en C2.

### 21. Bugfix retroactivo — `computeFoodMacros` con `unit='household'`

En C2 el helper ignoraba `amount` cuando la unit era `household`,
devolviendo siempre los macros de UNA medida. Eso solo era visible si
el frontend permitía `amount > 1` — cosa que llega en C3. Corregido:

```js
// antes (C2)
grams = num(line.householdGrams);
// ahora (C3)
grams = num(line.amount) * num(line.householdGrams);
```

`amount=2, householdGrams=15` ahora → 30g totales, que es lo que se
muestra en pantalla y lo que la usuaria entiende cuando teclea "2
cucharadas". El smoke C3 PARTE A cubre este caso (caso #6 y caso #2).

### 22. Modal `PlanEditorModal` — wireframe ASCII

```
┌─────────────────────────────────────────────────────────────────────┐
│ PLANTILLA / PLAN ASIGNADO                                         × │
│ [Nombre del plan_______________________]   [Plantillas ▾] [☑ Visible]│
├─────────────────────────────────────────────────────┬───────────────┤
│ Comentarios                                         │  PACIENTE      │
│ ┌─────────────────────────────────────────────────┐ │ ────────────── │
│ │ Notas generales del plan…                       │ │ Belén Iglesias │
│ └─────────────────────────────────────────────────┘ │ Edad:  32 años │
│                                                     │ Sexo:  —       │
│ Planificación de comidas      [+ Añadir comida]     │ Altura:  —     │
│ ╔══ ▾ Desayuno (3 op.)  ……………………………………… [≡] ══╗   │ Peso:  —       │
│ ║ Descripción: DESAYUNO + BEBIDA + FRUTA          ║   │ Motivo: pérdida│
│ ║ [Opción 1 ⭐]  [Opción 2]  [Opción 3]  [+ op]   ║   │                │
│ ║ ┌────┬──────────┬──────────┬────┬────┬────┬───┐ ║   │  TOTAL DEL PLAN│
│ ║ │Cnt │ Unidad   │ Alimento │P   │ C  │ G  │ F │ ║   │ ────────────── │
│ ║ │ 80 │ gramos   │ Avena    │ 13 │ 47 │  5 │11 │ ║   │ Prot 124 (25%) │
│ ║ │  1 │ medida ▾ │ Aceite   │  0 │  0 │ 15 │ 0 │ ║   │ Carb 200 (41%) │
│ ║ │  — │ libre    │ Café     │  — │  — │  — │ — │ ║   │ Gras  76 (35%) │
│ ║ │+   Añadir alimento: [buscar…]      [🔍 OFF]   │ ║   │ Fibra 20       │
│ ║ │ Total opción: P 13 · C 47 · G 20 · F 11      │ ║   │                │
│ ╚══════════════════════════════════════════════════╝   │                │
│ ╠══ ▸ Comida (2 op.) ……………………………………… [≡] ══╣   │                │
│ ╠══ ▸ Cena (1 op.) ………………………………………… [≡] ══╣   │                │
│                                                     │                │
│                            [Cancelar] [Guardar plan]│                │
└─────────────────────────────────────────────────────┴───────────────┘
```

- Header sticky con nombre + dropdown plantillas + toggle visibilidad.
- Acordeón de comidas (primera expandida por defecto). Click chevron
  para expandir/colapsar; menú [≡] con Renombrar / Subir / Bajar /
  Eliminar.
- Pills horizontales de opciones (estrella ⭐ marca la default). Click
  para activar; chevron ▾ abre menú Renombrar / Marcar por defecto /
  Eliminar.
- Tabla de la opción activa. Cantidad/Unidad/Alimento editables inline
  (commit on blur). Para `unit='household'`, un segundo select muestra
  las medidas caseras del catálogo + "+ Añadir medida nueva…" que
  persiste vía `PATCH /api/nutricion/foods/[id]`.
- Fila final con autocomplete: tipea, dropdown de coincidencias del
  catálogo + opción "+ Buscar en línea" que abre `FoodSearchExternalModal`.
- Panel lateral derecho: paciente (si type='assigned') o info plantilla;
  abajo, resumen de macros con barras de % sobre P+C+G.

### 23. Persistencia: estructural vs. metadata

- **Estructural** (añadir / quitar comida, opción, alimento; cambiar
  unit, amount, isDefault…): se persisten **inmediatamente** con
  llamadas individuales a las rutas `/api/nutricion/plans/*` del C2.
  En blur o Enter para inputs de texto/número; en click para botones
  y selectores.
- **Metadata** (name, description, visibleToClient): el botón
  **"Guardar plan"** del footer hace UN solo `PATCH /plans/[id]` y
  cierra el modal. Si la plantilla tiene asignaciones activas, muestra
  el modal de aviso con `hadAssignments` antes de cerrar.

Esta separación es un compromiso pragmático sobre la decisión "no
auto-save" del C0:

- No queremos perder los datos de la usuaria si cierra el modal por
  error → estructura persiste sola.
- Los cambios de texto cortos (nombre del plan, comentarios) sí van al
  botón final, que es lo que el modal Harbiz hace para esos campos.

Si en el futuro queremos un "guardado 100% manual con diff", entra como
sprint propio: hay que rastrear un árbol "borrador" + uno "limpio" en
React state, y traducir las diferencias a operaciones REST en el
submit. No es necesario para el flujo actual de Laura.

### 24. Cargar plantilla en plan ya existente

Botón "Plantillas ▾" en el header → dropdown con todas las plantillas
+ confirm "¿Cargar plantilla? Esto reemplazará TODO el contenido
actual." → al aceptar:

1. `DELETE` de todas las `plan_meals` del plan destino (CASCADE
   limpia options y foods).
2. `POST /meals` por cada comida del origen, seguido de `POST /options`
   por cada opción y `POST /foods` por cada food line.
3. `loadPlanTree` para refrescar la UI con los IDs nuevos.

No se usa el endpoint `/duplicate` porque ese crea un PLAN nuevo. Aquí
sobrescribimos el contenido del plan abierto manteniendo su id, type,
client_id…

### 25. Smoke C3

Script: `scripts/smoke-nutri-laura-recetario-c3.mjs`. **Dos partes**:

**PARTE A** (sin red, sin servidor): unit tests del helper
`lib/nutricion/macros.js`. 14 asserts cubriendo:

- `unit='g'` con factor de proporción (2×100g).
- `unit='household'` con amount > 1 (verifica el bugfix C3).
- `unit='free'` → todos null.
- Falta de `line.food` → null.
- `amount=0` / `amount<0` → null.
- Opción mixta (g + household + free), un macro `null` se ignora.
- Opción vacía → todos null.
- Meal usa `isDefault`; sin default usa menor `order`.
- Plan suma defaults.

Ejecutar:

```powershell
node scripts/smoke-nutri-laura-recetario-c3.mjs --only-unit
```

**PARTE B** (requiere dev server + .env.local): integración HTTP/BD.

- Setup: crea un food con tilde (`smoke-c3-Cebáda Integral`) y un
  cliente smoke.
- B.1 — Búsqueda accent-insensitive: `GET /foods?q=cebada`,
  `?q=CEBÁDA`, `?q=Integ` deben devolver la misma fila.
- B.2 — `GET /plans?type=template&withSummary=true` devuelve
  `mealsSummary[].optionCount` y `activeAssignmentsCount=0` antes de
  asignar.
- B.3 — Tras `/assign`, la plantilla muestra
  `activeAssignmentsCount=1`; el listado `type=assigned&withSummary`
  trae `clientName` y `templateName` populados.
- B.4 — Tras `PATCH amount=200` sobre un food line, el árbol refleja el
  cambio y `computeOptionMacros` recalcula proporcional (200g de
  Cebáda Integral → 20p, 130c).

Ejecutar:

```powershell
# Dev server en otra terminal
npm run dev

# Sin login HTTP (firma JWT con JWT_SECRET)
node --env-file=.env.local scripts/smoke-nutri-laura-recetario-c3.mjs

# Con login HTTP completo
$env:SMOKE_PASSWORD = "<password admin nutri_laura>"
node --env-file=.env.local scripts/smoke-nutri-laura-recetario-c3.mjs
```

### 26. Decisiones tomadas durante C3

1. **`withSummary=true` en el listado de planes** (no un endpoint
   nuevo): para no romper la API actual de C2 y mantener un único
   listado paginado. Es opt-in y solo se calcula cuando se pide.
2. **Persistencia mixta** (estructural inmediato + metadata diferido):
   pragmático sobre la decisión "no auto-save" del C0. Documentado en
   §23. Un futuro sprint puede mover todo a "diff + apply" si la
   experiencia lo necesita.
3. **Buscador accent+case insensitive con extensión `unaccent`**:
   estándar Postgres, instalable con un script idempotente. Fallback
   JS lossy si la extensión falta. Backlog: implementar fallback 100%
   JS (carga toda la tabla y pagina en JS).
4. **Bugfix C2 en helper macros para `unit='household'`**: el
   helper ahora multiplica `amount × householdGrams`. Documentado en
   §21 + cubierto por el smoke C3 caso #2/#6.
5. **Cargar plantilla en plan existente reusa endpoints CRUD**
   (no endpoint nuevo). Tiene el coste de N+1 requests pero la
   alternativa sería un endpoint `/import-from-template` que ahora no
   se justifica.
6. **Panel paciente muestra campos limitados** (edad / motivo del
   `customFields`). Peso, altura, sexo y alergias quedan como
   "—" hasta C4, cuando habrá perfil nutricional en la ficha cliente.
7. **El catálogo de medidas caseras se edita inline** desde la fila
   de alimento del modal (no solo desde el catálogo). Cuando el
   usuario elige "+ Añadir medida nueva…", hacemos `PATCH /foods/[id]`
   con `householdMeasures` actualizado y refrescamos la línea actual.
8. **Sidebar plegable con sub-entradas**: el item "Nutrición" ahora
   tiene `children` con las 3 sub-rutas. La carpeta de sub-entradas se
   auto-expande cuando `pathname.startsWith("/nutricion/")`.
9. **Tarjeta de plantilla muestra sólo nombre + meals resumen +
   asignaciones**. No incluye los foods. La preview completa solo se
   ve al abrir el modal — diseño consciente para que el grid no se
   sature.
10. **No drag&drop** (decisión C0). Reordenar comidas/opciones se hace
    desde el menú [≡] con "Subir" / "Bajar". Para 5-10 comidas por
    plan, suficiente. Si la usabilidad pide más en el futuro, entra
    como sprint propio.

### 27. Backlog detectado en C3

- Endpoint dedicado `POST /api/nutricion/plans/[id]/replace-with-template`
  que haga la sobrescritura del contenido en una sola transacción
  (hoy hacemos N+1 desde el frontend en §24).
- Endpoint `POST /api/nutricion/plans/[id]/meals/reorder` con
  array `[{ id, order }]` para reordenar en una transacción (hoy hacemos
  swap con 2 PATCH consecutivos).
- Cuando la extensión `unaccent` no esté disponible, fallback JS
  completo (cargar todo el catálogo, normalizar, paginar in-memory).
- Diff-and-apply real para "Guardar plan": permitiría modo borrador
  100% antes de persistir, alineado con la palabra "manual" del C0.
- Capacidad de cambiar el food de una línea sin borrar+recrear
  (eligiendo del autocomplete con la fila ya existente abierta).
- Drag&drop para reordenar comidas y opciones — UX nice-to-have.
- Perfil nutricional del paciente (peso, altura, sexo, alergias,
  objetivo) → C4.
- "Re-aplicar plantilla origen" desde la ficha paciente → C4.
- Tarjeta de plantilla con preview de macros del plan completo
  (calculado en el endpoint con `?withSummary=true&withMacros=true`).
- Búsqueda por tag en `/nutricion/alimentos` (ya soportada en backend,
  falta UI).

---

## C4 — UX asignación + tab Plan en ficha paciente

Estado: **HECHO en local** (2026-06-24). Pendiente de despliegue a prod.

### 28. Alcance C4

Decisiones cerradas con Jorge antes de implementar:

1. La asignación de plantilla a paciente se inicia **SOLO desde
   `/nutricion/asignados`** (botón "+ Nueva asignación"). NO desde la
   ficha de paciente — la ficha solo muestra el plan ya asignado.
2. El wizard de asignación es **modal de 2 pasos secuenciales**:
   paciente → plantilla → confirmar.
3. La ficha de paciente tiene una **nueva tab "Plan"** (solo override
   nutri_laura): plan activo destacado + histórico colapsable. Acciones:
   "Editar plan" (abre PlanEditorModal de C3) y "Re-aplicar plantilla
   origen".
4. "Re-aplicar plantilla origen" archiva el plan asignado actual y
   crea uno nuevo deep-copy de la plantilla origen (en transacción).
5. Empty state sin plan activo: mensaje "Sin plan asignado. Asigna
   desde Nutrición > Asignados > + Nueva asignación." Sin botón.

### 29. Endpoint `POST /api/nutricion/plans/[id]/reapply-template`

Re-aplica la plantilla origen sobre un plan asignado en una sola
transacción atómica:

1. **Validaciones** (todos los rechazos con código HTTP claro):
   - Plan del path no existe / archivado → **404**.
   - Plan.type !== 'assigned' → **400** "Solo se puede re-aplicar
     sobre planes asignados".
   - Plan.templateId NULL → **400** "Este plan asignado no tiene
     plantilla origen registrada" (caso defensivo para datos legacy).
   - Plantilla origen no existe o `archivedAt !== null` → **409** "La
     plantilla origen está archivada o no existe". Elegimos 409 (no
     404) porque el conflicto es de **estado** del recurso, no de
     ausencia.
   - Plantilla origen tiene type distinto a 'template' → **409**
     (defensivo).
2. **Transacción**:
   - `UPDATE plans SET archived_at = now() WHERE id = oldPlan.id`.
   - `INSERT INTO plans` con `type='assigned'`, mismo `client_id`,
     mismo `template_id`, nuevo `assigned_at = now()`, name
     compuesto del template + sufijo del nombre viejo (heurística para
     conservar el "— {paciente}").
   - `deepCopyPlanTree` desde la plantilla origen al nuevo plan.
3. Audit log: `action='nutricion.plan.reapplied'` con
   `{ oldPlanId, newPlanId, templateId, clientId }`.
4. Response **201** con el árbol completo del nuevo plan (mismo shape
   que `POST /assign`).

Anti-duplicado: **NO** se aplica aquí porque el plan viejo se archiva
en la misma transacción **antes** de insertar el nuevo, así que no hay
colisión con el `WHERE archivedAt IS NULL` del check de `/assign`.

### 30. Endpoint `GET /api/clients/[id]/plans`

Devuelve TODOS los planes (activos + archivados) del cliente,
ordenados por `createdAt DESC`. Cada item:

```json
{
  "id": "uuid",
  "name": "Mediterráneo 1500 — Belén",
  "description": "...",
  "visibleToClient": false,
  "assignedAt": "2026-06-24T...",
  "archivedAt": null,
  "createdAt": "...",
  "updatedAt": "...",
  "status": "active" | "archived",
  "mealCount": 4,
  "templateId": "uuid",
  "templateName": "Mediterráneo 1500",
  "templateArchived": false
}
```

Auth: `hasModule('nutricion')` + JWT válido. El endpoint vive en
`/api/clients/[id]/plans` (no en `/api/nutricion/...`) porque
conceptualmente pertenece a la ficha cliente y se consume desde el
panel `ClientPlansPanel`.

Cliente inexistente → **404** "Cliente no encontrado".
Sin auth → **401** (middleware).

### 31. Modal `AssignPlanModal` — wizard 2 pasos

Componente: `modules/overrides/nutri-laura/AssignPlanModal.jsx`. Se
abre desde el botón "+ Nueva asignación" en
`/nutricion/asignados`.

**Paso 1 — Selección de paciente**:
- Buscador con autocomplete contra `GET /api/clients?search=…`.
- Sin query escrita: muestra los últimos 20 pacientes activos
  (`GET /api/clients?limit=20`).
- Click en un paciente → estado interno `client = c` + avanza al paso 2.

**Paso 2 — Selección de plantilla**:
- Lista de plantillas (`GET /api/nutricion/plans?type=template&limit=200`).
- En paralelo cargamos `GET /api/clients/[clientId]/plans` y
  **filtramos** las plantillas que ya tienen una asignación activa al
  paciente seleccionado. Así evitamos el 409 antes de hacer el POST.
- Click en plantilla → `POST /api/nutricion/plans/[templateId]/assign`
  con `{ clientId }`.
- Si la API igualmente devuelve **409** (race condition entre dos
  pestañas, por ejemplo), mostramos el error en el modal sin cerrarlo
  para permitir cambiar de plantilla.
- Si OK, el callback `onAssigned(newPlan)` cierra el modal y abre
  inmediatamente el `PlanEditorModal` con el plan recién asignado
  (UX one-shot: asigna y entra a editar gramos).

### 32. Tab "Plan" en ficha paciente — wireframe

Override `modules/overrides/nutri-laura/ClientDetailModule.jsx`:
añadida tab `{ key: 'plan', label: 'Plan' }` después de "Citas". El
contenido lo renderiza `ClientPlansPanel`.

```
┌──────────────────────────────────────────────────────────────────────┐
│  ← Belén Iglesias                                       [paciente]   │
│  Edad: 32 · belen@example.com · +34 600 000 000                      │
├──────────────────────────────────────────────────────────────────────┤
│ [Información] [Notas] [Adjuntos] [Citas] [Plan]                      │
├──────────────────────────────────────────────────────────────────────┤
│ ┌─ Plan activo ────────────────────────────────────────────────────┐ │
│ │ PLAN ACTIVO                                                       │ │
│ │ Mediterráneo 1500 — Belén Iglesias                                │ │
│ │                                                                   │ │
│ │ Plantilla origen: Mediterráneo 1500 (link a /plantillas)          │ │
│ │ Asignado el:     24 jun 2026                                      │ │
│ │ Última edición:  24 jun 2026                                      │ │
│ │ Comidas:         4 comidas                                        │ │
│ │                                                                   │ │
│ │              [Re-aplicar plantilla origen]  [Editar plan]        │ │
│ └───────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│ ▾ Histórico  (2 planes archivados)                                  │
│   • Pauta inicial — Belén · Asignado 1 may · Archivado 24 jun [Ver]│
│   • Pauta verano — Belén · Asignado 1 jun · Archivado 24 jun [Ver] │
└──────────────────────────────────────────────────────────────────────┘
```

Empty state (sin plan activo NI histórico): mensaje "Sin plan
asignado. Asigna desde Nutrición > Asignados > + Nueva asignación."
con link a la ruta.

Si hay histórico pero NO activo: una banda gris en lugar de la card
del plan activo ("Este paciente no tiene plan activo. Histórico
abajo.") + el acordeón de histórico se expande por defecto.

### 33. Re-aplicar plantilla origen (UX)

Flujo desde la card "Plan activo":

1. Click "Re-aplicar plantilla origen".
2. `window.confirm`: "Esto archivará el plan actual y creará uno nuevo
   desde la plantilla origen. ¿Continuar?".
3. `POST /reapply-template`.
4. Si OK → toast "Plantilla re-aplicada" + recarga del listado + abre
   el `PlanEditorModal` del nuevo plan para que Laura confirme/ajuste.
5. Si error (p. ej. plantilla origen archivada) → toast con el
   mensaje del backend; la card no se modifica.

El botón se deshabilita (gris) cuando:
- `plan.templateId` es null (plan asignado huérfano, no debería pasar
  en C4 pero es defensivo).
- `plan.templateArchived === true` (la plantilla origen fue archivada
  desde C3).

### 34. Smoke C4

Script: `scripts/smoke-nutri-laura-recetario-c4.mjs`. 43 asserts:

1-2. Health + cleanup pre-run.
3. POST /assign con árbol mínimo (1 comida × 1 opción × 1 food).
4. GET /clients/[id]/plans devuelve el plan asignado + templateName.
5. POST /reapply-template happy path (archive viejo + crea nuevo +
   deep-copy del árbol).
6. GET /clients/[id]/plans tras reapply: 2 planes ordenados DESC
   (activo primero, archivado segundo).
7. POST /reapply-template sobre plantilla (type='template') → 400.
8. POST /reapply-template con plantilla origen archivada → 409.
9. POST /reapply-template con planId UUID inexistente → 404.
10. Regresión C2: POST /assign mismo (template, client) activos → 409.
11. Permisos: GET /clients/[id]/plans sin cookie → 401.
12. Cleanup.

Ejecutar:

```powershell
npm run dev  # otra terminal

# Sin login HTTP (firma JWT)
node --env-file=.env.local scripts/smoke-nutri-laura-recetario-c4.mjs

# Con login HTTP completo
$env:SMOKE_PASSWORD = "<password admin nutri_laura>"
node --env-file=.env.local scripts/smoke-nutri-laura-recetario-c4.mjs
```

### 35. Decisiones tomadas durante C4

1. **Endpoint `/reapply-template` en `/api/nutricion/plans/[id]/`**, no
   en una ruta del cliente. Razón: la operación es sobre el plan, no
   sobre el cliente. El cliente se infiere del plan.
2. **Lista de planes del cliente en `/api/clients/[id]/plans`** (no en
   `/api/nutricion/plans?clientId=…`). Razón: la consume la ficha
   cliente; semánticamente es un sub-recurso del cliente. Filtrar por
   `clientId` en el endpoint genérico de planes también funciona pero
   no incluye automáticamente `templateName` y `mealCount`.
3. **Wizard 2 pasos (paciente → plantilla)**, no un solo selector con
   ambos campos. Razón: la lista de plantillas filtrable depende del
   paciente elegido (ocultamos las ya asignadas activas). Hacerlo en
   un solo paso requeriría re-fetch de la lista al cambiar paciente.
4. **Anti-duplicado del wizard en cliente Y servidor**: filtramos en
   UI las plantillas ya asignadas activas (UX), pero el backend sigue
   devolviendo 409 si por race condition se intenta duplicar. El modal
   lo maneja sin cerrarse.
5. **Apertura automática del `PlanEditorModal` tras asignar**: una vez
   asignada la plantilla, abrimos el editor del nuevo plan asignado.
   Laura lo más probable es que quiera ajustar gramos/opciones
   específicas del paciente; ahorra un click.
6. **No hay botón "Asignar nueva plantilla" en la tab Plan** (regla
   innegociable de Jorge). La ficha paciente es solo lectura/edición
   del plan ya asignado; la asignación inicial es siempre desde
   `/asignados`.
7. **Histórico editable como el activo**: el botón [Ver] de la fila
   de histórico abre el mismo `PlanEditorModal`, no una vista
   read-only. Razón pragmática: Laura puede querer consultar valores
   antiguos o copiar un plan archivado de vuelta a activo (si decide
   restaurar, lo haría manual borrando el activo + cambiando
   `archivedAt = null` en BD — fuera de C4).
8. **Status de la card "Plan activo" usa branding terracota**
   (`bg-[var(--color-primary)]/[0.05]` + borde `/25`). Para que destaque
   del histórico (que vive en card blanca normal).
9. **Banner "histórico" colapsable con auto-expand**: si NO hay activo
   pero SÍ hay histórico, expande automáticamente. Caso típico: Laura
   archivó el plan reciente y aún no asignó otro; el histórico es
   inmediatamente relevante.
10. **`templateArchived` viaja en la respuesta del listado** para que
    el botón "Re-aplicar" se pueda deshabilitar en frontend sin un
    segundo fetch. Si Laura archiva la plantilla origen desde C3, el
    botón de la ficha paciente se deshabilita correctamente.

### 36. Backlog detectado en C4

- **Resumen de macros en la card "Plan activo"**: hoy solo mostramos
  conteo de comidas. Útil añadir P/C/G/F del plan activo (requiere
  bien un nuevo flag `?withMacros=true` en `GET /clients/[id]/plans`,
  bien un fetch extra del árbol).
- **Notificación al paciente** cuando Laura re-aplica una plantilla:
  email/SMS opcional (C5+ o futura integración con n8n).
- **"Restaurar" un plan archivado** desde el histórico: hoy hay que
  hacerlo manualmente en BD. Sería un endpoint
  `POST /plans/[id]/restore` que verifica que no hay activo de la
  misma plantilla y vuelve a poner `archivedAt = null`.
- **Comparar dos planes** (activo vs anterior archivado): diff side
  by side de comidas/opciones/cantidades. Útil para que Laura vea qué
  cambió entre revisiones.
- **Bulk-reapply**: re-aplicar la plantilla origen a TODOS los
  pacientes que la tengan asignada cuando Laura edita una plantilla.
  Hoy es 1 a 1 desde la ficha paciente. Solo si Laura lo pide.
- **Modo read-only en el `PlanEditorModal`** para histórico: hoy
  permite edición. Si Laura confunde "ver" con "editar" un plan
  archivado, añadir un toggle del editor o un wrapper read-only.
- **Filtro de pacientes en `/asignados`** ya cubierto por C3 (buscador
  por nombre + filtro plantilla origen). Mantiene su forma — el botón
  "+ Nueva asignación" se integra sin cambiar el resto del header.
- **Validación de cliente "soft-deleted"** en /assign: hoy un cliente
  archivado (si existiera la convención) se aceptaría. Modelo `Client`
  no tiene `archivedAt`, así que no aplica por ahora.
- **Pre-fill del paciente en el wizard** cuando se llega desde un
  contexto específico (futuro: abrir desde una notificación o un link
  externo).
