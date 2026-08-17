---
name: deploy
description: Lleva un cambio de local a producción entero: sincroniza con master avisando de solapes, inspecciona si algo del despliegue toca DATOS de producción, commitea con el build en verde, empuja, corre las migraciones de estructura que hagan falta en el orden correcto, lanza deploy.sh en el VPS y lo comprueba dentro del contenedor. Si algo cambia datos —directa o indirectamente— PARA, lo mide y pide permiso antes de tocarlo. Se lanza a mano con /deploy.
---

# Desplegar

Coge lo que hay hecho en local y lo pone en producción, con las comprobaciones
en el orden que importa.

**Lo lanza una persona, siempre**, y eso vale como permiso explícito para
commitear y empujar a `master` (la regla 11 de `CLAUDE.md` prohíbe hacerlo por
iniciativa propia, no cuando lo piden).

**Lo que ese permiso NO cubre es tocar datos.** Ahí está la regla de abajo, y no
la levanta ni haber lanzado la skill, ni que el cambio parezca inofensivo, ni que
lo mismo se aprobara ayer.

---

## La regla que manda

> **Nada que cambie datos de producción se ejecuta sin permiso explícito para
> ESE cambio, dicho en esta conversación, después de haberlo medido.**

Producción tiene datos de salud de más de mil familias, doce mil citas y facturas
con obligación legal de conservarse. Un despliegue de código se deshace con otro
despliegue; una fila reescrita no se deshace con nada.

**Cambiar datos incluye lo indirecto**, que es lo que se cuela:

| | Qué es | Qué se hace |
| --- | --- | --- |
| **Estructura** | `CREATE TABLE/INDEX IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS` sin valor por defecto. Aditivo e idempotente: en un schema que ya lo tiene, no hace nada. | Se ejecuta. Es lo que hace falta para que el código nuevo no dé 42703. |
| **Puede fallar** | `CREATE UNIQUE INDEX`, `SET NOT NULL`, una FK nueva. No cambian ninguna fila, pero **fallan** si los datos no cumplen. | Se ejecuta. Si falla, se para ahí y se cuenta — nunca se «arregla» borrando o deduplicando por iniciativa propia. |
| **Datos** | `UPDATE`, `INSERT`, `DELETE`, `TRUNCATE`, `DROP`, renombrar una columna, `ADD COLUMN NOT NULL DEFAULT` (escribe en todas las filas), y cualquier `create`/`update`/`destroy`/`bulkCreate` de Sequelize. Los rellenos (`backfill-*`), las siembras (`seed-*`), los reseteos (`reset-*`, `clear-*`) y las podas (`podar-*`). | **PARA.** Se mide, se enseña con números, se espera. |
| **Datos, indirecto** | Código que al desplegarse hace que algo escriba, borre o congele solo: el umbral de una poda con temporizador detrás, la foto dorada de las demos (congela lo que haya en ese momento), la reactivación de un cliente (le corre las migraciones), activar un módulo (siembra sus datos base), la autolimpieza de las demos. | **PARA igual.** Nadie va a ejecutar nada: pasa por desplegarlo. |

La última fila es la importante, porque no salta a la vista y porque nadie la
pide: sale de leer el diff.

---

## Los pasos

### 1. Sincronizar, y **parar si algo se solapa**

Aquí empujan dos personas a `master` sin PRs que avisen. El 13/08/2026, en una
sola hora, entraron dos commits del socio mientras había trabajo a medias.

```bash
git fetch origin && git diff --name-only HEAD origin/master
```

- Si la lista está **vacía** o **ningún fichero es de los tuyos**: `git pull --ff-only` y sigue.
- Si **algún fichero coincide** con los que vas a tocar: **PARA Y PREGUNTA**. No lo
  resuelvas por tu cuenta ni aunque el conflicto parezca trivial. Lo que se ve en
  un diff es el texto, no la intención: dos cambios pueden fusionar limpiamente y
  ser incompatibles igual, y quien puede saberlo es quien escribió el otro. Enseña
  las dos versiones y espera.

### 2. Inspeccionar qué va a entrar

```bash
node scripts/_deploy-inspeccion.mjs
```

Sin argumentos mira **lo que hay sin commitear**, que es cuando se hace la
pregunta: antes de commitear ya hace falta saber si viene una migración y en qué
orden va. Si el árbol está limpio, pasa solo a `origin/master..HEAD` — útil para
inspeccionar algo ya commiteado y aún sin desplegar. Se le puede dar un rango
(`... 246a778 547a872`) o forzar el árbol (`... --trabajo`).

Clasifica cada script por el **SQL que lleva dentro, no por su nombre** —hay
migraciones que se llaman `migrate-` y llevan un relleno dentro— y avisa del
orden. **Sale con código 2 si algo toca datos**, y ese 2 es una puerta cerrada, no
un aviso que se pueda leer por encima.

Tres cosas que el inspector NO puede hacer, y hay que hacerlas a mano:

- **Su lista de caminos indirectos no es completa** y no puede serlo. Que no diga
  nada no demuestra que no haya otro. Lee el diff pensando en «¿esto hace que
  algo escriba solo?».
- **No sabe si la migración ya está aplicada.** Aquí no hay tabla de migraciones:
  son idempotentes y se apoyan en `IF NOT EXISTS`. Para saber si falta, se
  pregunta al schema de producción en **solo lectura**.
- **Lee texto, así que se equivoca por exceso**: un comentario que mencione
  `UPDATE` lo hace saltar. Es el lado bueno del error — un falso positivo cuesta
  una pregunta, un falso negativo cuesta datos. Cuando salte, lee la línea que
  te enseña antes de decidir; si es prosa, dilo y sigue.

### 3. Si algo toca datos: medir, enseñar, esperar

En este orden, sin saltarse ninguno:

1. **Medir en seco.** Casi todos los scripts de datos traen dry-run por defecto y
   solo escriben con `--confirm`. Lánzalo en seco y quédate con los números.
   Si no tiene dry-run, mídelo con un `SELECT` de solo lectura: cuántas filas
   entran en su `WHERE`, de qué clientes, y qué valor tienen ahora.
2. **Enseñarlo con números**, no con adjetivos. «Toca 1.083 fichas de Aumenta y
   les pone la etiqueta de paciente de nutrición» es una pregunta que se puede
   contestar; «hay un backfill pendiente» no.
3. **Decir qué se pierde si sale mal**, y si hay vuelta atrás.
4. **Esperar.** Mientras no haya un sí para ESE script, se despliega el resto y se
   deja eso fuera, diciéndolo.

Cuando llegue el sí:

- **Copia de seguridad antes**, siempre, de lo que se va a tocar:
  ```bash
  ssh crm-vps 'mkdir -p /root/backups && docker exec crm-salamandra-db-1 pg_dump -U crm_user -d salamandra -t master.buzon_avisos --data-only > /root/backups/antes-de-X-$(date +%Y%m%d).sql'
  ```
  Ojo con las comillas: **la redirección va DENTRO**, o el volcado acaba en la
  máquina de quien lanza el comando en vez de en el VPS. Ajusta las tablas a lo
  que toque (`-t esquema.tabla`, repetible); si son tablas de varios tenants,
  dilo y volca las de todos. Y comprueba después que el fichero no está vacío.
- **Ejecutar dentro del contenedor, nunca en el host del VPS**:
  ```bash
  ssh crm-vps 'docker exec crm-salamandra-app-1 node scripts/X.js --confirm'
  ```
  `npm run X:prod` en el host coge el `.env.production` equivocado o no encuentra
  las dependencias. Siempre `docker exec`.
- **Contar lo que salió** de verdad: cuántas filas, y comprobar después que el
  número casa con lo que se dijo antes.

### 4. El build, en verde, ANTES de empujar

```bash
npm run build
```

Ya no hay CI que lo pare. Si no compila, no se empuja: el `deploy.sh` haría el
build en el VPS y lo dejaría a medias.

### 5. Commitear

- Revisa qué entra y que **no haya ningún `.env*` ni ningún secreto**:
  ```bash
  git status --porcelain && git diff --cached --name-only
  ```
- **Un commit por asunto.** Si el trabajo son dos cosas distintas —un arreglo y
  un cambio de documentación— son dos commits, aunque se desplieguen juntos.
- Conventional Commits, en español, y el cuerpo explica **por qué**, no qué
  ficheros. Trailer obligatorio:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  ```
- Si el despliegue **cierra una tarea del Registro**, la tarea sale de
  `docs/backlog.md` y entra en `docs/resuelto.md` **en el mismo commit**
  (`docs/como-apuntar-en-el-tablero.md`).

### 6. Empujar

```bash
git push origin master
```

**Prohibido reescribir historia**: nada de `push --force` ni `reset --hard` sobre
lo ya subido. Un error se arregla con otro commit o con `git revert`.

### 7. El orden: ¿migración antes o después del despliegue?

Lo decide **qué haría reventar a la app que está corriendo ahora**:

- **Columna NUEVA que el código va a leer → la migración VA ANTES.** Sequelize
  hace `SELECT` de todos los atributos del modelo, así que el código nuevo por
  delante de la columna da 42703 en cada lectura. Una columna que todavía no lee
  nadie es invisible para la app desplegada: correrla antes no rompe nada.
- **Columna que deja de leerse, o que se va → el DESPLIEGUE VA ANTES**, y la
  migración después, cuando ya nadie la mira.
- **Ni una cosa ni la otra → despliega y listo.**

**Si la migración va antes, el script todavía no está dentro de la imagen.** Dos
formas, y la segunda es la fiable:

```bash
# Si el script no importa nada de scripts/ (autocontenido):
ssh crm-vps 'docker exec -i crm-salamandra-app-1 node --input-type=module' < scripts/migrate-X.js

# Si importa helpers (_schema-targets.js y compañía) — lo normal:
ssh crm-vps 'cd /opt/crm-salamandra && git pull'
ssh crm-vps 'docker cp /opt/crm-salamandra/scripts/migrate-X.js crm-salamandra-app-1:/app/scripts/'
ssh crm-vps 'docker exec crm-salamandra-app-1 node scripts/migrate-X.js'
```

⚠️ **Si copias un script al contenedor, BÓRRALO después.** El siguiente
`deploy.sh` recrea el contenedor y se lo lleva, pero hasta entonces hay un
fichero de código en producción que no está en la imagen, y eso es exactamente lo
que nadie sabe explicar dentro de un mes:

```bash
ssh crm-vps 'docker exec crm-salamandra-app-1 rm -f /app/scripts/migrate-X.js'
```

### 8. Desplegar

```bash
ssh crm-vps 'cd /opt/crm-salamandra && ./deploy.sh'
```

- `--full` **no hace falta decidirlo**: el propio script detecta si cambiaron
  `package.json` o `package-lock.json` y toma la ruta larga (`npm ci`).
- ⚠️ **Si el despliegue toca `deploy.sh`, hay que lanzarlo DOS veces.** El
  `git pull` reemplaza el script mientras bash lo está ejecutando, así que la
  ejecución en curso sigue con el contenido viejo. Está avisado en su cabecera.

### 9. Comprobar DENTRO del contenedor

En el repositorio ya se sabe que está bien: eso no prueba nada. Lo que importa es
lo que viaja en la imagen.

```bash
ssh crm-vps 'cd /opt/crm-salamandra && git log --oneline -2'
ssh crm-vps 'docker exec crm-salamandra-app-1 sh -c "grep -rl UNA_CADENA_LITERAL .next | head -3"'
curl -s -o /dev/null -w "%{http_code}\n" https://crm.salamandrasolutions.com/login
```

⚠️ **La cadena que busques tiene que existir LITERALMENTE en el código.** Si en el
fuente se compone en tiempo de ejecución (`Vas a {accion}`), el grep no la
encuentra y parece que el despliegue ha fallado cuando lo que falla es el grep.
Busca un identificador (`id="algo-concreto"`) o una frase entera de una sola
pieza. Pasó el 17/08/2026.

Y si el despliegue cambió el Registro, con la tarea concreta:

```bash
ssh crm-vps 'docker exec crm-salamandra-app-1 grep -n "un trozo del título" docs/backlog.md docs/resuelto.md'
```

### 10. Los chequeos de después

Según lo que se haya tocado:

| Si el despliegue tocó… | Lanza |
| --- | --- |
| módulos o accesos | `docker exec crm-salamandra-app-1 node scripts/check-module-access.js` |
| enlaces cliente/equipo | `docker exec crm-salamandra-app-1 node scripts/check-links.js` |
| columnas nuevas en tablas de tenant | mira el aviso de las fotos doradas que saca `deploy.sh` al final |

⚠️ **La foto dorada de las demos NO se rehace por iniciativa propia**, aunque
`deploy.sh` avise de que está desfasada. Rehacerla **congela lo que haya en la
demo en ese momento**, incluido lo que dejara un visitante cinco minutos antes:
es un cambio de datos y va por la regla de arriba. Se avisa y se espera.

### 11. Contar qué se hizo

Al terminar, en pocas líneas: los commits, qué se ejecutó en producción y con qué
resultado, cómo se comprobó, y **qué se dejó sin hacer y por qué**. Si algo se
quedó esperando permiso, que sea lo último que se lee.

---

## Lo que esta skill no hace nunca

- **Ejecutar nada que escriba datos sin un sí explícito** para ese cambio.
- **Resolver un solape por su cuenta**, ni aunque parezca trivial.
- **Reescribir historia** en `master`.
- **`npm run *:prod` en el host del VPS.** Siempre `docker exec`.
- **Rehacer la foto dorada** de las demos.
- **Dar por bueno un despliegue mirando el repositorio** en vez del contenedor.
- **Meter un secreto en un commit, en un chat o en un log.** Si un secreto se ha
  visto en un chat, se considera comprometido y se rota (regla 15).
- **Purgar un cliente.** Eso no tiene endpoint ni despliegue: es SSH a mano.

---

## Chuleta

| Qué | Dónde |
| --- | --- |
| Repo en el VPS | `/opt/crm-salamandra` |
| Contenedor de la app | `crm-salamandra-app-1` |
| Contenedor de la BD | `crm-salamandra-db-1` |
| Alias de SSH | `crm-vps` |
| Inspector del despliegue | `node scripts/_deploy-inspeccion.mjs [base] [cabeza]` |
| Orden de las migraciones | `node scripts/check-migration-order.js` (solo lectura) |
| Qué migraciones lleva cada módulo | `scripts/_module-migrations.js` |
| Copias de seguridad en el VPS | `/root/backups/` |
