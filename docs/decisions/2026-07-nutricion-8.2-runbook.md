# Runbook — Deploy Sprint 8.2 (Recetario Nutrición)

- **Fecha:** 2026-07-15
- **Riesgo:** 🔴 Alto (nutri_laura en producción). La migración es **puramente
  aditiva** (4 tablas nuevas, no toca las existentes). Orden: **deploy primero,
  migrar inmediatamente después** (el script solo existe en la imagen nueva; el
  guard 42P01 de `attachRecipesToTree` protege los flujos existentes en la
  ventana). Ver Fase 2.
- **Ejecutor:** Jorge, por SSH en el VPS. Claude no tiene acceso al VPS.

> Decisiones y diseño del sprint: [`2026-07-nutricion-refactor-sprint-8.md`](2026-07-nutricion-refactor-sprint-8.md).
> Backfill: **NO hay** (coexistencia Z — las tablas nuevas nacen vacías; Laura
> crea recetas a su ritmo; la estructura antigua `plan_meal_option_foods` sigue
> funcionando). La migración solo crea estructura.

Ajusta usuario/DB (`<USER>`, `salamandra`) y nombres de contenedor a tu entorno
(`crm-salamandra-db-1`, `crm-salamandra-app-1`).

---

## Fase 0 — Backup (innegociable)

```bash
# Dump del schema de producción de Laura (fuera del VPS a ser posible).
docker exec crm-salamandra-db-1 pg_dump -U <USER> -d salamandra \
  -n crm_nutri_laura --no-owner --no-privileges > nutri_laura_$(date +%F).sql
# Copiar el .sql a un sitio seguro fuera del VPS.
```

---

## Fase 1 — Ensayo en staging (copia real de prod)

### 1.1 Crear `crm_nutri_staging` como copia de `crm_nutri_laura`

```bash
# Reutiliza el dump del backup (mismo contenido). Reescribe el nombre de schema.
sed 's/crm_nutri_laura/crm_nutri_staging/g' nutri_laura_$(date +%F).sql > nutri_staging.sql
docker exec crm-salamandra-db-1 psql -U <USER> -d salamandra \
  -c 'DROP SCHEMA IF EXISTS crm_nutri_staging CASCADE;'
docker exec -i crm-salamandra-db-1 psql -U <USER> -d salamandra < nutri_staging.sql
```

> ⚠️ El `sed` reemplaza el string en TODO el dump. El nombre de schema no debería
> aparecer en los datos de nutrición, pero verifica el recuento tras restaurar
> (abajo). Si algún dato contuviera literalmente `crm_nutri_laura`, usa un método
> de copia por-tabla en su lugar.

### 1.2 Verificar que la copia es fiel (antes de migrar)

```bash
docker exec crm-salamandra-db-1 psql -U <USER> -d salamandra -c "
  SELECT 'foods' t, count(*) FROM crm_nutri_staging.foods
  UNION ALL SELECT 'plans', count(*) FROM crm_nutri_staging.plans
  UNION ALL SELECT 'plan_meals', count(*) FROM crm_nutri_staging.plan_meals
  UNION ALL SELECT 'plan_meal_options', count(*) FROM crm_nutri_staging.plan_meal_options
  UNION ALL SELECT 'plan_meal_option_foods', count(*) FROM crm_nutri_staging.plan_meal_option_foods;"
# Compara con los mismos counts en crm_nutri_laura → deben coincidir.
```

### 1.3 Correr la migración SOLO contra staging

Usa **`ONLY_SCHEMAS`** (modo exclusivo — ignora la lista de tenants). **NO uses
`EXTRA_SCHEMAS`** aquí: ese modo es aditivo y migraría también `crm_nutri_laura`
(prod), rompiendo el aislamiento del ensayo.

El script vive en la imagen (Dockerfile copia `scripts/`), así que hay que
ejecutarlo **dentro de un contenedor que ya tenga el código nuevo**. Como en
Fase 1 aún no has desplegado, hazlo con un contenedor efímero de la imagen nueva:

```bash
git pull   # trae el código del PR mergeado (o la rama)
docker compose build app   # construye la imagen con el script nuevo
docker compose run --rm -e ONLY_SCHEMAS=crm_nutri_staging app \
  node scripts/migrate-nutricion-recipes.js
```

> Alternativa si prefieres no construir aún: `docker cp scripts/migrate-nutricion-recipes.js
> crm-salamandra-app-1:/app/scripts/` y luego `docker exec -e ONLY_SCHEMAS=crm_nutri_staging
> crm-salamandra-app-1 node scripts/migrate-nutricion-recipes.js`.

Debe crear en `crm_nutri_staging`: `recipes`, `recipe_foods`,
`plan_meal_option_recipes`, `plan_meal_option_recipe_foods` (4 "tabla creada").
**No debe tocar** foods/plans/etc. (repite el recuento de 1.2 → idéntico).

### 1.4 Validar integridad en staging (SQL)

```bash
docker exec crm-salamandra-db-1 psql -U <USER> -d salamandra -c "
  SELECT to_regclass('crm_nutri_staging.recipes'),
         to_regclass('crm_nutri_staging.recipe_foods'),
         to_regclass('crm_nutri_staging.plan_meal_option_recipes'),
         to_regclass('crm_nutri_staging.plan_meal_option_recipe_foods');"
# Las 4 no-NULL. Los CHECK/FK se validan al insertar (ver tests locales del sprint).
```

**Validación funcional de la UI**: dos opciones —
- (a) **Recomendada, más simple**: ya está validada end-to-end en `demo`
  (local), que tiene el módulo nutrición con las tablas. El código es idéntico.
- (b) **Con datos reales de Laura**: crear temporalmente una fila tenant
  `nutri_staging` en `master.tenants` (+ `tenant_modules` con `nutricion`)
  apuntando al schema `crm_nutri_staging`, loguearse y probar el editor sobre
  los menús reales de Laura; **borrar la fila tenant al terminar**. (Más
  fiel pero más manipulación de master.)

### 1.5 Confirmación de Laura

Enseñar a Laura el flujo (crear receta → meterla en un menú → asignar a
paciente) sobre `demo` o el staging con tenant temporal. **Solo tras su OK** se
despliega a producción.

### 1.6 Limpieza de staging

```bash
docker exec crm-salamandra-db-1 psql -U <USER> -d salamandra \
  -c 'DROP SCHEMA IF EXISTS crm_nutri_staging CASCADE;'
# Y borra la fila tenant temporal si usaste la opción (b).
```

---

## Fase 2 — Deploy a producción

**Deploy primero, migrar INMEDIATAMENTE después.** No se puede migrar antes: el
script de migración es nuevo y solo existe en la imagen nueva (el `Dockerfile`
copia `scripts/` en build; el contenedor viejo NO lo tiene, y la DB no expone
puerto al host). Por eso el orden es: `deploy.sh` (construye+arranca la imagen
nueva, que ya trae el script) → migrar en ese contenedor nuevo, sin demora.

**La ventana entre "app nueva viva" y "migración corrida" es segura para lo
existente**: `attachRecipesToTree` tiene guard 42P01, así que el editor de
planes y las fichas de paciente de `nutri_laura` siguen funcionando (degradan a
"sin recetas") aunque las tablas aún no existan. Lo único que daría 500 en esa
ventana son las pantallas NUEVAS de Recetas (`/nutricion/recetas`), donde Laura
no estará. Corre el migrate acto seguido para cerrar la ventana en segundos.

```bash
# En el VPS, con el PR ya mergeado a master:
git pull
# 1) Desplegar la app nueva (deploy.sh construye la imagen con el script).
./deploy.sh
# 2) INMEDIATAMENTE, migrar prod en el contenedor NUEVO (ya tiene scripts/).
docker exec crm-salamandra-app-1 node scripts/migrate-nutricion-recipes.js
#    → procesa nutri_laura (y cualquier tenant con nutricion). "4 tabla creada".
```

### Verificación post-deploy (con cuidado, es prod)
- Login como Laura → `/nutricion/recetas` (nuevo) carga sin error.
- Abrir un **menú existente** en el editor → las comidas/opciones/alimentos de
  siempre siguen apareciendo (coexistencia). El editor NO debe romper.
- Abrir un **paciente asignado** existente → su plan sigue viéndose igual.
- Crear una receta de prueba, meterla en un menú de prueba, asignar. Borrar lo
  de prueba.

---

## Rollback

| Punto | Cómo revertir |
|---|---|
| Tras Fase 1 (staging con `ONLY_SCHEMAS`) | Nada en prod (el modo exclusivo NO tocó `crm_nutri_laura`). `DROP SCHEMA crm_nutri_staging`. |
| Tras `deploy.sh`, ANTES de migrar | Revertir el deploy (git a la release anterior + `deploy.sh`). Las tablas del recetario aún no existen; nada que limpiar. |
| Tras `deploy.sh` + migrar (app nueva + tablas creadas) | **Revertir el deploy de la app** (git a la release anterior + `deploy.sh`). Las 4 tablas quedan (vacías/inertes para el código viejo). Los datos existentes NO se tocaron en ningún momento. |
| Corrupción de datos existentes | No debería ocurrir (migración aditiva, no toca tablas existentes). Si pasara: restore del `pg_dump` de Fase 0. Punto de no retorno. |

**Clave de seguridad**: en ningún momento se modifican ni borran las tablas
existentes (`foods`, `plans`, `plan_meals`, `plan_meal_options`,
`plan_meal_option_foods`). La retirada de la estructura antigua es un sprint
futuro, tras confirmación de Laura de que ya no la necesita.
