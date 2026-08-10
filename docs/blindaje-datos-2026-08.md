# Blindaje de los datos de producción — qué se hizo

**Fecha**: 2026-08-07 · Sale de [`auditoria-datos-2026-08.md`](auditoria-datos-2026-08.md).
**Sin commitear**: Jorge revisa el working tree.

---

## 1. Las copias ahora incluyen los ficheros y pueden salir del servidor

`scripts/backup-db.sh`

| Antes | Ahora |
| --- | --- |
| Solo `pg_dump` de la base | Base **+ `uploads/`** en un `tar.gz` con la misma marca de tiempo |
| Todo en el mismo disco | Copia a destino externo si se define `DESTINO_REMOTO` (detecta solo si es rclone o rsync) |
| Un fallo dejaba una línea en un log que nadie lee | `trap ... ERR` que escribe **«LA COPIA HA FALLADO»** y avisa de que los datos de hoy no están respaldados |
| Instrucciones de restauración que fallan en silencio | `-v ON_ERROR_STOP=1` obligatorio, y el paso de restaurar ficheros |
| Rotación solo de `auto-*.sql.gz` | Rota también `uploads-*.tar.gz` |

Los 134 MB de `uploads/` son contratos **firmados**, informes clínicos y
adjuntos. No se regeneran: restaurar solo la base deja las fichas apuntando a
papeles que no existen.

Un fallo de la copia externa **no aborta** el script: la local ya está hecha y
perderla por un problema de red sería peor.

## 2. Las copias ya no las puede borrar git

`.gitignore` — en el VPS, `backups/` cuelga **dentro** del checkout, así que
git las veía como ficheros sueltos. Comprobado el mismo día: `git status` en
producción listaba `?? backups/` con 159 MB dentro.

- `git clean -fd` antes de un despliegue se las llevaba todas.
- `git add -A` metía en el historial la base entera — datos de salud de 1.083
  familias — de forma prácticamente irreversible.

Ahora se ignoran `backups/`, `*.sql.gz`, `uploads-*.tar.gz`, `pre-*.sql`,
`backup-pre-*.sql` y `uploads/`. Verificado contra los cinco nombres de fichero
reales del servidor.

## 3. El timer de copias ya se puede reinstalar desde el código

`scripts/deploy/crm-backup.service` y `.timer` — funcionaban en el servidor
pero **no estaban versionados**, al contrario que `crm-poda`,
`crm-recordatorios` y `crm-retenciones`. Si hubiera que reconstruir el VPS, la
única tarea cuyo trabajo es que no se pierdan datos era la única que no se
podía reaprovisionar.

Comparados con los instalados: idénticos salvo las descripciones y el bloque
comentado de `DESTINO_REMOTO`.

## 4. Los scripts que borran ya no se pueden lanzar contra un cliente real

`scripts/_guard-datos-reales.js` (nuevo).

**Enumera los tenants de PRUEBA, no los reales**: `demo`, `demo_golden`,
`sandbox`, `test`. Todo lo demás se considera cliente real. Así, el cliente que
se dé de alta mañana queda protegido hoy, sin tocar nada — el mismo criterio de
«una ausencia nunca abre una puerta» que ya usa `middleware.js` con
`ADMIN_HOST`.

Para saltárselo hay que teclear entera la bandera
`--si-quiero-tocar-un-cliente-real`, y el script avisa igualmente.

> **Por qué no vale mirar la `DATABASE_URL`**, que es lo que hacía
> `seed-sandbox.js`: en producción los scripts corren **dentro** del
> contenedor, donde la URL apunta al host `db` de Docker y no dice «prod» por
> ningún lado.

### Scripts frenados (9)

| Script | Qué destruía |
| --- | --- |
| `seed-clinica-demo.js` | Pacientes, sesiones, informes, coordinaciones y métricas. **Su cabecera enseñaba `docker exec … seed-clinica-demo.js aumenta`** — línea eliminada |
| `clear-aumenta-leads.js` | `truncate` de los leads de Aumenta |
| `clear-quality-leads.js` | Los leads de Quality Energy, que son su **único** módulo |
| `clear-abarcaia-leads.js` | Leads y referidos de AbarcaIA, que solo existe en producción |
| `seed-aumenta.js` | Datos de ejemplo + `sync({alter:true})` |
| `expand-aumenta.js` | `sync({alter:true})` y **aborta después**, dejando clientes falsos a medias |
| `seed-spain-enzymes.js` | Siembra sobre un cliente en producción |
| `seed-quality-energy.js` | Siembra sobre su único módulo |
| `seed-abarcaia.js` | Siembra sobre un cliente solo-producción |
| `seed-cuestionarios-retorika.js` | Su cabecera decía «(LOCAL)» pero nada lo impedía |

El `sync({alter:true})` borra de la base **toda columna que el modelo ya no
declare**. `costs.amount` y `costs.month` están así a propósito
(`Cost.model.js:55-61`).

### Comprobado

| Prueba | Resultado |
| --- | --- |
| Sintaxis de los 11 ficheros | ✅ |
| Los 9 scripts abortan con código 1 | ✅ |
| `seed-clinica-demo.js demo` **no** se frena | ✅ |
| La bandera explícita deja pasar, avisando | ✅ |
| `bash -n scripts/backup-db.sh` | ✅ |
| Detección rclone / rsync / formato inválido | ✅ 3 de 3 |
| Patrones de `.gitignore` contra los 5 ficheros reales del VPS | ✅ |
| `npm run build` | ✅ en verde |

---

## Lo que falta, y necesita a Jorge

1. **Elegir dónde van las copias externas.** Backblaze B2, S3, u otro VPS. Es
   lo único que protege de perder el servidor entero, y es la única tarea que
   no se puede hacer desde el repo. Una vez elegido:
   `rclone config` en el VPS, descomentar la línea `Environment=` de
   `crm-backup.service` y `systemctl daemon-reload`.
2. **Desplegar**, para que los frenos lleguen al servidor. Hasta entonces, los
   scripts peligrosos siguen sin freno **en producción**, que es donde importa.
3. **Reinstalar la unidad de systemd** tras el despliegue:
   `cp scripts/deploy/crm-backup.* /etc/systemd/system/ && systemctl daemon-reload`
4. **Probar una restauración** en local. Una copia nunca restaurada es una
   hipótesis.

## Lo que NO se tocó, a propósito

- **El guard de rol en `app/api/clients/[id]/route.js:172`** (punto 8 de la
  auditoría). Es una línea, pero **cambia el comportamiento de la aplicación**:
  si algún tenant tiene hoy usuarios no-admin que borran clientes de forma
  legítima, se les rompe el flujo sin avisar. Hoy no es explotable —los 13
  logins de Aumenta no tienen `clients` en su `moduleAccess`—, así que no
  corría prisa. **Decisión de Jorge.**
- Los 20 endpoints DELETE que no auditan, y los 29 que no comprueban rol. Mismo
  motivo: son cambios de comportamiento, no de seguridad de los datos en disco.
- El refactor base/override sigue **parado y sin una sola línea de código
  tocada**.
