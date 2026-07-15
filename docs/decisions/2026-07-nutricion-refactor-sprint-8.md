# Plan de Refactor — Módulo Nutrición (Sprint 8)

- **Fecha:** 2026-07-15
- **Estado:** Planificación (decisiones D1–D4, D6 abiertas — bloquean 8.2)
- **Riesgo:** 🔴 Alto. Laura (`nutri_laura`) usa Nutrición en **producción**; cualquier bug la afecta directamente.
- **Origen:** diagnóstico read-only del módulo (modelo-BD + endpoints verificados sobre código; UI verificada parcialmente — el inventario fino de labels se cierra al ejecutar 8.1).
- **Aviso de datos:** la BD **local solo tiene `crm_demo`/`crm_sandbox`**; `nutri_laura` no existe en local. Todo lo marcado *a confirmar* exige inspección del schema `crm_nutri_laura` en producción.

> Este sprint es demasiado grande y arriesgado para un solo prompt. Se divide en
> **8.1 (rename UI)**, **8.2 (restructure BD)** y **8.3 (PDF+email)**. Cada uno se
> planifica y valida por separado. Este documento es la referencia de arranque.

---

## 1. Estado actual del módulo

- **Modelo de datos (5 tablas, solo en `crm_nutri_laura`):** `foods` (catálogo) →
  `plans` → `plan_meals` → `plan_meal_options` → `plan_meal_option_foods`. Los 5
  modelos se registran en `lib/db/tenantDb.js` (líneas ~129-134, asociaciones
  ~426-447) para **todos** los tenants, pero las tablas físicas solo existen en
  `crm_nutri_laura`.
- **`foods` = INGREDIENTE atómico, no receta:** macros por 100g
  (`protein/carbs/fat/fiber_per_100`), `default_unit` (g|ml|unidad),
  `household_measures` JSONB, `source` (custom|openfoodfacts), soft-delete por
  `archived_at`. **Sin kcal** (decisión C0), sin ingredientes hijos, sin pasos,
  sin raciones, sin foto.
- **Jerarquía del "menú" = 4 niveles:** `plans` (N comidas) → `plan_meals` →
  `plan_meal_options` (X alternativas intercambiables, `is_default`) →
  `plan_meal_option_foods` (Y **alimentos sueltos** con `amount` + `unit`
  g|household|free). **Hoy la "opción" ES la alternativa y contiene ingredientes
  sueltos, no recetas.**
- **`plans.type` = ENUM(template|assigned):** CHECK `plans_type_client_chk` liga
  `type` ↔ `client_id`/`assigned_at` (template ⇒ ambos NULL; assigned ⇒ ambos NOT
  NULL). `template_id` self-FK (ON DELETE SET NULL); `client_id` FK **lógica**
  (validada en `/assign`, sin FK física).
- **Endpoints (15 bajo `app/api/nutricion/**` + 1 externo
  `app/api/clients/[id]/plans`):** todos con `withTenant` + guard
  `hasModule('nutricion')`. `GET /plans` **exige** `?type=template|assigned`;
  `withSummary=true` añade summary sin N+1.
- **template→assigned:** `assign` hace **deep-copy** del árbol
  (`deepCopyPlanTree`) en transacción; 409 si ya hay asignado activo para
  (template, client). `duplicate` y `reapply-template` reutilizan el deep-copy.
  Un plan asignado es una **copia estructural independiente** del template.
- **⚠️ Acoplamiento clave:** el deep-copy independiza la **estructura**, pero
  `plan_meal_option_foods.food_id` es una **REFERENCIA** al catálogo. Solo
  `household_label`/`household_grams` se snapshotean; **las macros se leen en vivo
  del `Food`** → editar las macros de un alimento altera las macros calculadas de
  planes YA asignados. (Esta es la raíz de la decisión **D1**.)
- **Integridad que un restructure rompe:** CHECK `plan_meal_option_foods_unit_chk`
  (g|household|free ↔ amount/household_*), CHECK `plans_type_client_chk`, y **4
  enums** cuyo nombre Sequelize deriva del `tableName` (`enum_foods_*`,
  `enum_plans_type`, `enum_plan_meal_option_foods_unit`). **Doble espejo en
  código** del CHECK unit: `sanitizeFoodLine` (`lib/nutricion/plans.js`) +
  re-validación inline en el PATCH de `foods/[foodId]`.
- **Deudas conocidas:** `visible_to_client` es columna **muerta** post-C4 pero
  sigue escribible/copiada; DELETE de food es soft-delete **sin guard de uso**;
  `reorder` transaccional **solo existe para comidas**; los CRUD anidados **no
  escriben AuditLog** (salvo `reorder`); heurística frágil `name.split(' - ')[1]`
  en `reapply-template`.
- **UI (override `nutri-laura/`):** `uiOverride='nutri-laura/NutricionFoodsModule'`.
  Componentes: `NutricionFoodsModule`, `NutricionPlantillasModule`,
  `NutricionAsignadosModule` + modales `FoodEditModal`,
  `FoodSearchExternalModal`, `PlanEditorModal`, `AssignPlanModal`,
  `ClientPlansPanel`. Sidebar: entrada "Nutrición" plegable con 3 sub-rutas.
- **8.3 no existe:** cero endpoints de PDF/email/export.

---

## 2. Sub-Sprint 8.1 — Rename UI (🟢 bajo riesgo)

**Objetivo:** Alimentos→**Recetas**, Plantillas→**Menús**, Asignados→**Pacientes
Nutrición**. **Sin tocar BD.**

**Decisión de alcance (D0):** recomendado **labels-only** (Opción A):

| Opción | Qué toca | Riesgo |
|---|---|---|
| **A · Solo labels visibles** ✅ | Textos en override components + `Sidebar.jsx` + strings de error ES | Cero BD/rutas/`uiOverride` |
| B · Labels + rutas + archivos | Además renombra rutas `nutricion/alimentos→/recetas`, etc., archivos de componente, y **obliga a migrar `master.tenant_modules.uiOverride` en prod** + `UI_OVERRIDE` en el seed | Medio (fila en prod + sidebar auto-expand + enlaces) |

El backend NO obliga a renombrar rutas: "Plantillas"/"Asignados" no tienen ruta
propia de API — son el query param `?type=template|assigned`. Renombrar el
segmento anidado `.../options/[optionId]/foods` sería **contraproducente** (ese
`/foods` son las *líneas de la opción*, no el catálogo).

**Alcance exacto (Opción A):** labels en `components/layout/Sidebar.jsx` (patrón:
el override "Leads"→"Interesados" ya existente) + textos en los override
components de `modules/overrides/nutri-laura/` + strings de error ES (opcional).

**NO incluye:** `moduleKey`/`hasModule('nutricion')`, enums/CHECKs/tablas,
`AuditLog` (`entity='Food'/'Plan'`, actions `nutricion.*` se conservan). Una
"Receta" en 8.1 sigue siendo un ingrediente plano por dentro — **rename léxico**.

**"Asignados→Pacientes Nutrición":** en 8.1 es **solo el label** (la página sigue
plan-céntrica). Convertirla en **paciente-céntrica** (agrupar por paciente, menú
activo + histórico) es rework de UI → va como **8.2-UI**, no en 8.1 (**D7**).

**Riesgo:** mínimo. Desplegable sin ventana ni migración. Debe salir primero.

---

## 3. Sub-Sprint 8.2 — Restructure (🔴 datos vivos en prod)

**El cambio real:** hoy `plan_meal_option_foods` apunta a `Food` = ingrediente
plano. 8.2 quiere que la unidad reutilizable sea una **RECETA con estructura
propia** (ingredientes, y *a confirmar* pasos/raciones/tiempo/foto), y que el
menú sea **N comidas × X recetas × opciones alternativas**.

### 3.1 Modelo nuevo recomendado (catálogo de recetas + tablas nuevas)

```
foods (SE MANTIENE como catálogo de ingredientes, macros/100g)   ← sin cambios
recipes            (NUEVA)  id, name, servings?, prep_time?, steps?, photo?, tags, archived_at
recipe_ingredients (NUEVA)  recipe_id → recipes, food_id → foods, amount, unit(g|household|free), household_*
                             (= la "línea de alimento" de hoy, movida un nivel abajo)
plan_meal_options → plan_meal_option_recipes (recipe_id, servings/amount, order)  ← reemplaza plan_meal_option_foods
```

**Por qué `recipes` nueva y NO mutar `foods`→`recipes`:** preserva el catálogo de
ingredientes + macros/100g que Laura ya usa; las macros de una receta = agregado
de `recipe_ingredients` (reescritura acotada de `lib/nutricion/macros.js`); evita
renombrar `foods` (y recrear `enum_foods_*` + recablear FK `food_id RESTRICT`).
Alternativa (mutar `foods`→`recipes`) **no recomendada** salvo que Laura quiera
que "alimento" y "receta" sean la misma entidad (**D2**).

### 3.2 Migración de datos vivos — reversible, NUNCA rename in-place

Script idempotente nuevo (lee schemas de `master.tenants`, regla #12):

1. **Backup** `pg_dump --schema=crm_nutri_laura` (fuera del VPS). *Innegociable.*
2. **DDL aditivo:** crear `recipes`, `recipe_ingredients`,
   `plan_meal_option_recipes` + enums/CHECKs nuevos. **No borrar nada.**
   (Idempotente: `tableExists`/`enumTypeExists`/`constraintExists`, patrón C1/C2.)
3. **Backfill:** convertir cada `plan_meal_option` → receta(s) con sus
   `plan_meal_option_foods` como `recipe_ingredients`. **Migrar CADA árbol por
   separado (templates Y asignados** — los asignados son copias deep
   independientes; migrar el template NO los propaga). Regla exacta = **D3**.
4. **Compatibilidad (opcional):** vista/capa que exponga el árbol viejo mientras
   la UI migra, desacoplando deploy backend↔frontend.
5. **Swap:** apuntar endpoints + `deepCopyPlanTree`/`planTreeInclude`/
   `loadPlanTree`/`sortPlanTree` + `macros.js` al modelo nuevo.
6. **Retirada:** DROP de `plan_meal_option_foods` + limpieza `visible_to_client`
   **solo tras** verificar en prod. Conservar tablas viejas `_deprecated` una
   release antes de DROP (reversibilidad).

### 3.3 Orden de deploy

Backup → deploy DDL aditivo (sin efecto) → backfill en ventana + verificar
recuentos (nº recetas/ingredientes, macros agregadas ≈ viejas) → deploy backend
nuevo + UI nueva (incl. página paciente-céntrica) → observación en prod (días) →
deploy de limpieza (DROP `_deprecated` + `visible_to_client`).

### 3.4 Backup / rollback

- **Backup:** `pg_dump --schema=crm_nutri_laura` antes de tocar nada.
- **Rollback fase 2-3:** trivial (tablas nuevas, viejas intactas) → no hacer swap.
- **Rollback fase 5:** revertir deploy de app (git) mientras las viejas sigan
  pobladas → por eso la retirada (fase 6) se separa una release.
- **Rollback fase 6:** solo restore desde `pg_dump`. Punto de no retorno.

### 3.5 Cómo probar SIN datos locales de `nutri_laura` (**D6**)

- **(Recomendado) Staging con copia real:** `crm_nutri_staging` con
  `pg_dump`/restore de `crm_nutri_laura` **desde prod**; ensayar fases 2-6 ahí.
  Única forma de validar el backfill contra datos reales de Laura.
- **Local con seed sintético:** crear `crm_nutri_laura` en local (C1+C2+C3 + seed
  que reproduzca templates/asignados con líneas g/household/free). Valida el
  **código**, no los datos de Laura.
- Verificar en ambos: independencia de asignados, agregación de macros, CHECKs
  nuevos, y que `app/api/clients/[id]/plans` (tab Plan de la ficha) sigue
  resolviendo `templateName`/`mealCount` tras el swap.

### 3.6 Superficie de código a reescribir

`lib/nutricion/plans.js` (`deepCopyPlanTree`, `planTreeInclude`, `sortPlanTree`,
`loadPlanTree`, `sanitizeFoodLine`), `lib/nutricion/macros.js` (agregación por
receta), `lib/db/tenantDb.js` (nuevos `define*`/asociaciones — **registro
compartido por todos los tenants**, no romper el init del pool para tenants sin
las tablas), endpoints del árbol (`.../options/[optionId]/foods*` → recetas),
doble espejo del CHECK unit, `foods/[foodId]` PATCH, nuevo `reorder` para el
nivel receta, y la reescritura paciente-céntrica de `NutricionAsignadosModule`.

---

## 4. Sub-Sprint 8.3 — PDF + email del menú (🟡 al final)

- **Estado:** no existe nada. Backlog lo cita como "Export PDF Recetario para
  WhatsApp".
- **Dónde encaja:** el menú a exportar es un **plan asignado a un paciente** →
  `app/api/nutricion/plans/[id]/export` (reusa `loadPlanTree`); disparo desde la
  ficha del paciente (`app/api/clients/[id]/plans/...`). Ubicación = **D5**.
- **Dependencia de 8.2: fuerte.** El PDF renderiza la estructura nueva
  (comidas × recetas × opciones). Hacerlo antes obliga a rehacerlo → **8.3 va
  DESPUÉS de 8.2** (salvo un 8.3-provisional urgente sobre el modelo viejo).
- **Skills:** `pdf` (on-demand); `docx` solo si Laura quiere versión editable.
  Email por Resend/n8n (patrón Outreach, `docs/modules/emails.md`) — **envío de
  email = acción con permiso explícito**.
- **`visible_to_client`:** 8.3 es el candidato natural a darle uso real (gate de
  visibilidad en portal). Revisar antes de que 8.2 la limpie (coordinar D4).

---

## 5. Decisiones abiertas (cerrar ANTES de codificar)

> 🔴 = bloquea 8.2 · 🟡 = bloquea 8.1 · 🟢 = bloquea 8.3. D1–D4 son de **producto**
> (cómo quiere Laura que funcionen las recetas) → validar con Laura.

1. 🔴 **D1 — Snapshot vs referencia al asignar.** ¿Editar una receta se propaga a
   menús ya asignados (referencia, como hoy con macros) o cada asignación congela
   su contenido (snapshot)? *Cambia el comportamiento actual de Laura.*
2. 🔴 **D2 — Arquitectura de "Receta".** `recipes` tabla nueva (recomendado) vs
   mutar `foods`→`recipes`. Define si se tocan enums/FK de `foods`.
3. 🔴 **D3 — Jerarquía y unidad.** ¿La receta sustituye a la "opción" o es un
   nivel nuevo? ¿Cantidad en **raciones/porciones** o se mantiene g|household|free?
   Determina si se rehace `plan_meal_option_foods_unit_chk` + enum + `sanitizeFoodLine`.
4. 🔴 **D4 — Estructura de la receta.** ¿Solo ingredientes + cantidades, o también
   pasos, raciones, tiempo, foto? Determina columnas/tablas nuevas (y si se limpia
   `visible_to_client` en el mismo sprint).
5. 🟡 **D0 — Alcance de 8.1.** Labels-only (recomendado) vs rutas+archivos+`uiOverride`.
6. 🟢 **D5 — Ubicación/transporte de 8.3.** ¿PDF bajo `/api/nutricion/plans/[id]`
   o `/api/clients/[id]/plans`? ¿Email por Resend/n8n? ¿Reactiva `visible_to_client`?
7. 🔴 **D6 — Entorno de ensayo.** `crm_nutri_staging` con copia real de prod
   (recomendado) vs seed sintético local.
8. **D7 — Página "Pacientes Nutrición".** ¿Solo rename de label (8.1) o
   reescritura paciente-céntrica de `NutricionAsignadosModule` (8.2-UI)?

---

## 6. Secuencia recomendada y salvaguardas

**Secuencia:**
1. **8.1 (labels-only)** → sale ya, sin riesgo, valor inmediato. No bloquea nada.
2. **Cerrar D1–D4 + D6 con Laura/Jorge** (reunión de diseño, no código).
3. **8.2 en 6 fases** (DDL aditivo → backfill en staging → swap → observación →
   limpieza), ensayado antes en `crm_nutri_staging`.
4. **8.2-UI** (página paciente-céntrica) junto con el swap de backend.
5. **8.3 (PDF+email)** al final, sobre el modelo nuevo.

**Salvaguardas para no romper a Laura:**
- **Backup `pg_dump` del schema antes de cada fase con DDL/backfill.** Innegociable.
- **Nunca rename in-place**: aditivo + copia + swap; tablas viejas `_deprecated`
  una release antes de DROP.
- **Migración por árbol**: templates **y** asignados por separado.
- **Regla #12**: el script lee schemas de `master.tenants`, no hardcodea `nutri_laura`.
- **No tocar `moduleKey`/`hasModule('nutricion')`** en ningún sub-sprint.
- **Actualizar los DOS espejos del CHECK unit a la vez** (`sanitizeFoodLine` +
  PATCH inline).
- **Verificar tras el swap** que `app/api/clients/[id]/plans` sigue resolviendo
  `templateName`/`mealCount`.
- **Ensayar en staging con copia real de prod** antes de tocar `crm_nutri_laura`.
- **Deploy por fases separadas** (DDL / backend / limpieza) para que el rollback
  de app no dependa de un rollback de datos.

**Pendientes *a confirmar* (falta acceso a datos de prod `nutri_laura`):** volumen
real de recetas/menús/asignados, si hay líneas `unit='free'` que compliquen el
backfill, y el alcance exacto de D4/D7.
