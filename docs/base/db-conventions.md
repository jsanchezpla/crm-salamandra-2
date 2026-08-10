# Convenciones de base de datos

> Verificado contra código el 2026-08-07 (commit `030a35e`).

---

## 1. Slugs: underscore en BD, guión en carpetas

| Sitio | Formato | Ejemplo |
| --- | --- | --- |
| `master.tenants.slug` | **underscore** | `nutri_laura` |
| Schema PostgreSQL | **underscore** | `crm_nutri_laura` |
| Cabecera `x-tenant` | **underscore** | `nutri_laura` |
| Clave de `UI_OVERRIDES` | **underscore** | `nutri_laura:` |
| `modules/overrides/` | **guión** | `nutri-laura/` |
| `scripts/seed-*.js` | **guión** | `seed-nutri-laura.js` |

La regex de `lib/db/tenantDb.js` solo acepta `[a-z0-9_]`. En documentación
nueva se escriben los slugs **como están en BD**.

## 2. Nombres de columna

Sequelize mapea `camelCase` en el modelo a **`snake_case`** en PostgreSQL:

```js
tenantId   → tenant_id
moduleKey  → module_key
uiOverride → ui_override
```

⚠️ **Los índices llevan el nombre REAL de la columna**, no el del atributo.
Hay un bug abierto por esto en `BoardColumn`: usar el nombre de atributo en
`fields` rompe `sync({alter:true})` en tenants nuevos.

## 3. FKs cliente ↔ equipo

Principio: **todo registro tiene un CLIENTE (externo, para quién es) y un
miembro del EQUIPO (interno, quién lo hace)**. Los módulos nacieron
independientes y varios cruzaban por texto o email, lo que dejaba registros
huérfanos en silencio — las citas de Aumenta estuvieron meses sin cliente
porque el cruce ficha↔cita era por email.

Todas UUID nullable, `ON DELETE SET NULL`:

| Tabla | Columna | Enlace |
| --- | --- | --- |
| `bookings` | `client_id` | cita → ficha |
| `documents` | `client_id` | documento → cliente |
| `clinic_sessions` | `client_id` | sesión → cliente |
| `clinical_reports` | `client_id` | informe → cliente |
| `coordinations` | `client_id` | coordinación → cliente |
| `plans` | `team_member_id` | plan → nutricionista |
| `interactions` | `team_member_id` | interacción → autor |
| `client_notes` | `team_member_id` | nota → autor |
| `form_submissions` | `handled_by_team_id` | solicitud → quién la atendió |

Los registros clínicos toman `client_id` **del paciente al crearse** (foto, no
se resincroniza) para no depender del salto paciente→cliente, que es frágil:
`patients.client_id` es nullable y a menudo va vacío.

**Chequeo**: `npm run db:check-links` (solo lectura) cuenta registros sueltos
por tabla. Lanzarlo tras cada sprint que toque estos módulos.

## 4. Migraciones

1. **Leer los schemas de `master.tenants` en tiempo de ejecución.** Nunca
   hardcodear slugs: la lista difiere entre local y producción, y un mismo
   tenant puede tener módulos distintos en cada entorno.
2. **Idempotentes**: se relanzan sin romper nada.
3. Filtrar por módulo con un JOIN a `tenant_modules.enabled = true` cuando la
   migración solo aplica a quien tenga ese módulo.
4. Las destructivas van en **dry-run por defecto**, con `--confirm` explícito
   y un `.rollback.sql` con las filas exactas que tocaron.
5. Orden verificable con `npm run db:check-migration-order`.

En producción **siempre por Docker**:

```bash
docker exec crm-salamandra-app-1 node scripts/mi-migracion.js
```

Dentro del contenedor las envs ya vienen inyectadas por `env_file`: **no**
usar `--env-file`, y **no** usar `npm run *:prod` en el host del VPS.

## 5. Campos que hay que tratar con cuidado

- **`Client.address` es JSONB, no texto.** Un campo «Dirección» de texto metió
  el `{}` por defecto como hijo de React y tumbó la pantalla entera:
  compilaba, el servidor devolvía 200, y solo se veía abriendo la ficha dos
  veces.
- **`CashClose.difference` se guarda calculado**, no se recalcula al leer: un
  cierre de caja es la FOTO de lo que se contó ese día.
- **`Cost` no tiene `amount`, `date` ni `method` en el modelo** — son legacy
  en BD, fuera del modelo a propósito. Leerlos devuelve `undefined` en
  silencio.

## 6. Auditoría

Helper genérico `lib/utils/auditoria.js` (o el del módulo, si ya existe).

1. Se llama **después** de la mutación y **fuera** de la transacción: la
   auditoría escribe en master con otra conexión, y dentro dejaría rastro de
   un cambio que un rollback deshiciera.
2. Se guarda un **resumen** de la fila, nunca la fila entera: en clientes,
   tickets y pacientes hay datos personales y de salud que no deben
   duplicarse en `master`, que comparten todos los clientes.
3. ⚠️ **Los campos del resumen tienen que existir EN ESE modelo.** Sequelize
   solo hace SELECT de los atributos definidos: leer un campo que el modelo no
   expone devuelve `undefined` y la auditoría sale muda o con `before` y
   `after` idénticos. En el repaso del 2026-07-28 fallaban **11 de 15 sitios**
   (borrar un gasto de 12.000 € no dejaba rastro del importe).
4. Cada acción nueva necesita su frase en `lib/actividad/etiquetas.js`.
5. **Auditar siempre lo destructivo y lo que mueve dinero.**
6. Deliberadamente sin auditar: la edición granular de un menú de nutrición
   (cientos de filas sin valor; el plan ya audita created/updated).

Los logs de auditoría no se borran ni modifican, salvo la retención por
antigüedad de `scripts/podar-audit-logs.js` (demo 7 días, clientes reales
3 años con suelo de 1).
