# Módulo Nutrición — Recetario para nutri-laura

Estado: **C1 implementado en local — pendiente C2-C5.**

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
| **C1**     | Catálogo de alimentos local + búsqueda online (OFF) + import a catálogo                          | **HECHO** |
| C2         | Plantillas de plan: estructura (días, comidas, opciones de comida, foods por opción) + builder UI | Pendiente |
| C3         | Asignación de plantillas a pacientes + cálculo de macros agregados por día                       | Pendiente |
| C4         | Vista paciente (PDF/share link) + ajuste manual por paciente                                     | Pendiente |
| C5         | Reporting de adherencia + integración con el módulo Citas (refrescar plan al seguimiento)         | Pendiente |

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
