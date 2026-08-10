# Auditoría de riesgo para los datos de producción

**Fecha**: 2026-08-07 · **Commit**: `030a35e` · **Método**: 21 agentes en 5
líneas de investigación, con verificación adversarial de cada hallazgo grave.
**49 hallazgos · 47 confirmados · 2 refutados.** Todo verificado línea a línea
contra el repo; nada se pudo comprobar contra el VPS.

**Pregunta de partida (Jorge)**: *«lo único que quiero es que en producción no
se pierdan los datos que ya hay»* — los leads de Aumenta, los pacientes de
nutri_laura y sus citas.

> ## ⚠️ Corrección tras comprobar el VPS (2026-08-07, mismo día)
>
> Jorge ejecutó las comprobaciones en el servidor (`srv1545289`). La evidencia
> real **refuta un hallazgo, confirma cuatro y destapa dos nuevos**. Manda esto
> sobre lo que dice el resto del documento.
>
> **✅ REFUTADO — la copia diaria SÍ existe y SÍ funciona.**
> `crm-backup.timer` está activo: última ejecución `Fri 2026-08-07 03:15:06`,
> siguiente `Sat 2026-08-08 03:15`. El log muestra copias correctas del 3 al 7
> de agosto, todas «OK: 13-14M». **20 copias, 159M.** La auditoría solo pudo
> decir que no era demostrable *desde el repo*; lo era desde el servidor.
> Sigue en pie, pero degradado a menor, que **el timer no está versionado**:
> si hay que reconstruir el VPS, no se reaprovisiona desde el código.
>
> **✅ REFUTADO — la rotación funciona bien.** Sostuve en una primera lectura
> que no borraba nada, porque el log repite «0 copia(s) borradas» mientras el
> contador sube. **Error mío de aritmética**: di por hecho una copia diaria
> desde el 19-jul. La realidad es que la copia auto **más antigua es del 27-jul
> 20:28** (11 días), y hay varias al día. `find -mtime +14` devuelve
> literalmente **0**: no hay ninguna que borrar. El script
> (`backup-db.sh:67`) es correcto.
>
> **✅ REFUTADO — los backups pre-deploy no pararon.** Sostuve que el último era
> del 27-jul. Lo que pasó ese día es que **cambiaron de nombre**: el último
> `pre-deploy-*` es de las 19:28 y el primer `auto-*` de las 20:28 del mismo
> día. Las copias a horas irregulares (01:24, 09:55, 12:25, 13:27, 20:28) son
> justamente las de antes de desplegar. El sistema sigue haciéndolas.
>
> **✅ REFUTADO — el salto de tamaño de 10× es normal.** Comparé volcados
> comprimidos con volcados sin comprimir. Los `backup-pre-*` de julio son
> `.sql` planos de ~10M; los `auto` son `.sql.gz` de 13-14M. Crecimiento
> coherente con la entrada de Aumenta el 24-jul.
>
> **✅ Disco holgado**: 99G totales, 19G usados, **76G libres (20%)**. A ~13M
> al día no hay ningún problema de espacio a la vista.
>
> **🔴 SIGUE EN PIE — no hay copia fuera del VPS.** Los 159M están en
> `/opt/crm-salamandra/backups`, el mismo disco que la base. Es **el riesgo
> real número uno**.
>
> **🔴 SIGUE EN PIE — `uploads/` son 134M y no están en ninguna copia.**
> Medido en el servidor. Ahí viven los contratos firmados y los documentos
> clínicos. Es **el riesgo real número dos**, y el más barato de arreglar.
>
> **🟡 Menor — el timer no está versionado.** Funciona en el servidor
> (`crm-backup.timer`, última ejecución 07-ago 03:15), pero no está en
> `scripts/deploy/` como los otros tres: si hay que reconstruir el VPS, no se
> reaprovisiona desde el código.
>
> ### Resumen honesto de la corrección
>
> **El sistema de copias está bastante mejor de lo que dijo la auditoría.**
> Timer activo, copias diarias, copia antes de cada deploy, rotación correcta y
> disco holgado. De los hallazgos sobre backups solo sobreviven dos, y son los
> que la auditoría no podía comprobar desde el repo: **falta la copia externa y
> falta `uploads/`**. Los hallazgos sobre **scripts peligrosos sin guards** y
> **`.gitignore`** no dependen del servidor y siguen intactos.

---

## 1. Respuesta

**El refactor base/override no es lo que amenaza tus datos.** Hoy está inerte:
0 iteraciones, 0 líneas de código, 0 commits, y `deploy.sh` no ejecuta
migraciones ni seeds. Lo que sí amenaza tus datos ya estaba en el repo antes:
**no hay ninguna copia fuera del VPS**, y hay scripts que borran tenants
reales de un solo comando, sin ningún seguro.

---

## 2. Lo que de verdad amenaza los datos

### 🔴 No hay copia fuera del servidor

Lo dice el propio script, `scripts/backup-db.sh:24-27`:

> «⚠️ Esto es copia LOCAL en el mismo servidor: protege de un borrado
> accidental o de una migración que salga mal, **NO de la pérdida del servidor
> entero**. El siguiente paso pendiente es sincronizar la carpeta a un destino
> externo (S3/Backblaze/otro VPS)».

- Las copias van a `/opt/crm-salamandra/backups` (`backup-db.sh:31-32`), el
  **mismo disco** que el volumen `pgdata` (`docker-compose.yml:8,36-37`).
- Grep de `rclone|rsync|s3cmd|aws s3|backblaze|restic|borg|offsite` en todo el
  repo: **cero coincidencias** salvo ese comentario de «pendiente».
- **No se puede demostrar desde el repo que la copia diaria esté instalada.**
  `backup-db.sh:12-16` manda instalarla con `crontab -e`, pero
  `docs/modules/analytics.md:220-222` dice que el servidor **no tiene cron**.
  Esa línea nombra un timer `crm-backup`, pero **no existe
  `crm-backup.service` ni `crm-backup.timer` en el repo** — sí están
  versionados los de `crm-poda`, `crm-recordatorios` y `crm-retenciones` en
  `scripts/deploy/`. La única tarea cuyo trabajo es que no se pierdan datos es
  la única que no se puede reaprovisionar desde el código.
- **`uploads/` no entra en ninguna copia**, ni siquiera local:
  `backup-db.sh:49` solo hace `pg_dump`. Ahí viven los contratos **firmados**
  (`lib/clients/signatureStorage.js:60`), documentos clínicos, adjuntos y
  tickets. Restaurar solo la BD deja miles de filas apuntando a ficheros que
  no existen: la app arranca sana y los documentos fallan uno a uno.
- **El script no avisa si falla**: ni mail ni webhook, solo `echo` a un log.
  Retención de 14 días (`:36`, `:67`): una corrupción detectada al día 15 ya
  no tiene copia buena.
- **El procedimiento de restauración documentado está mal.**
  `backup-db.sh:21-22` propone `gunzip | psql`, pero el volcado es `pg_dump`
  plano sin `--clean` (`:49`) y `psql` va sin `-v ON_ERROR_STOP=1`: sobre una
  base con datos choca cada `CREATE`, sigue adelante y **sale con código 0**.
  Una restauración fallida es indistinguible de una correcta.

### 🔴 Scripts que borran tenants reales sin seguro

| Script | Qué hace | Seguro |
| --- | --- | --- |
| `scripts/seed-clinica-demo.js:90-95` | 5 × `destroy({where:{}})`: pacientes, sesiones, informes, coordinaciones, métricas. **Su cabecera (:9) enseña literalmente `docker exec … seed-clinica-demo.js aumenta`** | **Ninguno.** Cascada a `intervention_plans`, `taller_inscripciones`, `external_contacts`; `bookings`/`incidencias`/`documents` pierden el `patient_id` |
| `clear-aumenta-leads.js:26`, `clear-quality-leads.js:25`, `clear-abarcaia-leads.js:25` | `Lead.destroy({truncate:true})`. Cabecera: `docker compose exec app node …` | **Ninguno.** Contradice a `reset-aumenta-real-data.js:8-10`, que conserva los leads a propósito «porque son datos REALES». En quality_energy y abarcaia los leads **son** el CRM entero |
| 8 seeds con `sync({alter:true})`: `seed-aumenta.js:385`, `expand-aumenta.js:174`, `seed-demo.js:206`, `seed-spain-enzymes.js:43`, `seed-quality-energy.js:103`, `seed-abarcaia.js:42`, `db-seed.js:48`, `seed-cuestionarios-retorika.js:243` | Toda columna en BD sin atributo en el modelo recibe `removeColumn`. Víctimas concretas: `costs.amount` y `costs.month`, documentadas en `models/tenant/Cost.model.js:55-61` como «vivas en BD, no expuestas a propósito» | **Ninguno de los 8.** El único seed con guard es `seed-sandbox.js:82-85`. `expand-aumenta.js` es el peor: hace el ALTER en :174 y **revienta** en :346, tras haber insertado 10 clientes falsos sobre el tenant real |

Los scripts viajan a producción: `Dockerfile:28` copia `scripts/`.

**El contraste que lo dice todo**: los scripts escritos a partir de julio
(`reset-aumenta-real-data.js`, `import-aumenta-*`, `clear-spain-enzymes-data.js`,
`backfill-patients-client.js`) tienen dry-run, `--confirm`, transacción con
ROLLBACK y hasta `.rollback.sql`. Son ejemplares. **Los peligrosos son los
heredados**, escritos cuando ningún tenant tenía datos reales. De ~300
ficheros en `scripts/`, solo 28 mencionan `--confirm` o dry-run, y solo 2
miran `NODE_ENV`.

### 🟠 Borrado por interfaz

- **`app/api/clients/[id]/route.js:171-172` no comprueba rol**, solo
  `hasModule("clients")`. Compárese con `billing/invoices/[id]/route.js:103`,
  que sí exige `ADMIN_ROLES`. Hoy **no es explotable** (los 13 logins de
  Aumenta no tienen `clients` en su `moduleAccess`), pero es una puerta
  latente: se abre el día que alguien ejecute `enable-module.js <slug> clients
  --grant-users`.
- **29 de 59 endpoints DELETE no comprueban rol. 20 de 59 no auditan nada** —
  incluido `pacientes/[id]/documents/[docId]/route.js:16-33`, que borra un
  documento clínico de un menor sin dejar una fila en `master.audit_log`.
- **Sin soft delete en las entidades caras**: Client, Patient, ClinicSession,
  Document e Invoice se borran físicamente.
- **Las cascadas no están en los modelos**: `grep -rn onDelete models/` → cero.
  Viven en SQL crudo repartido por ~40 migraciones, así que nadie puede
  auditar el radio de explosión de un borrado leyendo `models/`.
- **Contradicción sin resolver**: `borrar-tipos-cita-ejemplo.js:17-21` afirma
  que `bookings_event_type_id_fkey` es **CASCADE** en la BD real, mientras las
  tres definiciones del repo la crean como **RESTRICT**. Si el script tiene
  razón, borrar un tipo de cita se lleva la agenda histórica. Hoy lo tapa el
  soft delete de `citas/event-types/[id]/route.js:259-277`. **No se puede
  resolver sin mirar la BD de producción.**

### 🟡 El deploy no hace copia previa

`deploy.sh` (57 líneas): `git pull` → `npm ci/build` → `docker compose up`. Ni
un `pg_dump`. Las migraciones se lanzan a mano con `docker exec`: si una
corrompe datos, el único rescate es la copia de las 03:15.

### ✅ Lo que está bien (no tocar)

- **El volumen `pgdata` es nombrado y no hay un solo `down -v` en el repo.**
  Los datos sobreviven a cada despliegue.
- **El aislamiento entre tenants es sólido.** `middleware.js:258-267`
  sobrescribe las cabeceras con el JWT verificado; no hay ningún
  `export const DELETE` bajo las rutas exentas de JWT. Un visitante de la demo
  **no puede tocar otro tenant**.
- `deploy.sh` no ejecuta migraciones: un despliegue no altera el esquema solo.
- El bug del índice de `BoardColumn` **ya está arreglado**
  (`BoardColumn.model.js:54-56`). Lo obsoleto es la doc: `db-conventions.md:33`
  y la entrada de CLAUDE.md.
- El único incidente demostrado de riesgo real a los datos de Aumenta fue
  **una migración** (commit `8c491ce`), no un refactor.

---

## 3. Plan recomendado, por orden

**1. Comprobar por SSH si la copia existe. 30 segundos.** No se puede saber
desde el repo.

```bash
systemctl list-timers | grep -i backup
ls -lh /opt/crm-salamandra/backups
tail -20 /var/log/crm-backup.log
```

**2. Copia fuera del VPS.** Es lo único que responde a la pregunta literal.
`rclone sync` (o `rsync` a otro VPS) al final de `backup-db.sh`. Media hora;
evita la pérdida total e irreversible de siete tenants.

**3. Meter `uploads/` en la copia.** Una línea junto al `pg_dump` de la :49.
Ahí están los contratos firmados, que tienen valor legal y no se regeneran.

**4. Versionar `crm-backup.service` y `crm-backup.timer`** en `scripts/deploy/`,
como los otros tres. Y corregir `backup-db.sh:12-16`, que manda usar `crontab`
en un servidor sin cron.

**5. Añadir `backups/` y `*.sql.gz` a `.gitignore`.** Las copias caen dentro
del checkout de git y `.gitignore` no las excluye: un `git clean -fd` antes de
un deploy las borra todas, y un `git add -A` mete en el historial los datos de
salud de 1.083 familias.

**6. Blindar los scripts asesinos.** Copiar el guard de `seed-sandbox.js:82-85`
a `seed-clinica-demo.js`, los tres `clear-*-leads.js` y los 8 con
`sync({alter:true})`. Y borrar la línea 9 de `seed-clinica-demo.js`, que enseña
a lanzarlo contra `aumenta` en producción.

**7. Probar una restauración.** Una copia nunca restaurada es una hipótesis. De
paso, arreglar las instrucciones (`--clean --if-exists` en el dump,
`-v ON_ERROR_STOP=1` en psql).

**8. Guard de rol en `app/api/clients/[id]/route.js:172`.** Una línea.

**9. «Copia previa» en `deploy.sh` y en el checklist de `docs/base/deploy.md`.**
El procedimiento correcto ya está escrito en
`docs/deploy-notes-2026-07-23.md:27-35`; solo vive en el sitio equivocado.

---

## 4. Sobre el refactor

**Hacerlo después de los puntos 1-6.**

**a) Hoy no toca la BD por ninguna vía.** Como riesgo para los datos
existentes, es cero.

**b) El riesgo aparece solo si se clona `app/api`.** `checkpoint-01.md:103-105`
tiene la contradicción escrita: el runbook prohíbe tocar endpoints base, pero
la opción A no se cumple sin hacerlo. Si se clonan los 340 `route.js`, lo que
se multiplica por 4-8 son **los candados**: 310 `hasModule(`, 59 DELETE, 35
`auditar(`. Caso concreto de la primera iteración:
`app/api/clients/[id]/route.js` lleva dentro tres cosas que **no están en
`lib/`** — el candado fiscal de facturas (:186-201), el GC del directorio de
adjuntos (:223-229) y la llamada a `auditar()` (:231-246). Perder el primero
en una copia significa **borrar una ficha con facturas emitidas**.

**c) Antes de clonar nada, extraer esos candados a `lib/clients/`** (un
`puedeBorrarseCliente()` y un `borrarClienteCompleto()`). `lib/` no se clona,
según la regla 1 del runbook. Eso lleva el riesgo a cero sin renunciar a la
opción A, y el trabajo es pequeño: la cascada (`lib/clients/borrarRastro.js`) y
el guard de demo ya están en `lib/`.

**El argumento que zanja la prioridad**: el esfuerzo rinde diez veces más en
los puntos 1-6 que en cualquiera de las dos opciones del refactor.
