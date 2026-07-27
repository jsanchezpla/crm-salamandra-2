# Cómo trabajar en este proyecto

CRM SaaS multi-tenant (Next.js 16 + PostgreSQL + Sequelize, JavaScript sin TypeScript).
Esta guía es el flujo de trabajo con git para colaborar sin romper producción.

> ⚠️ **`master` es PRODUCCIÓN.** El VPS despliega haciendo `git pull` de `master`.
> Desde 2026-07-19 se trabaja con **commits directos a `master`** (sin PRs ni
> ruleset — decisión de Jorge para agilizar el despliegue). Eso traslada la
> responsabilidad al que pushea: **`npm run build` en verde ANTES de cada push**,
> porque ya no hay CI que te pare.

---

## 1. Puesta a punto (una sola vez)

### 1.1 Código y dependencias

```bash
git clone https://github.com/jsanchezpla/crm-salamandra-2.git
cd crm-salamandra-2
npm install
```

### 1.2 PostgreSQL local

Necesitas un PostgreSQL corriendo en tu máquina (v15/16). Crea **solo la base de
datos vacía** y un usuario (con `psql` o pgAdmin):

```sql
CREATE USER crm_user WITH PASSWORD 'pon_aqui_tu_password_local';
CREATE DATABASE salamandra OWNER crm_user;
```

> Los **schemas** (`master`, `crm_demo`, …) NO se crean a mano: los genera el
> script `db:sync` del paso 1.4. Tú solo dejas creada la base `salamandra` vacía.

### 1.3 Variables de entorno (`.env.local`)

Para **local generas tus PROPIOS secretos** — no necesitas los de nadie. Copia la
plantilla y rellénala:

```bash
cp .env.local.example .env.local
```

- `DATABASE_URL` → apunta a tu Postgres local (usuario/contraseña del paso 1.2, `@localhost`).
- `JWT_SECRET` y `SETTINGS_ENCRYPTION_KEY` → genera valores aleatorios:
  ```bash
  node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"    # -> JWT_SECRET
  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" # -> SETTINGS_ENCRYPTION_KEY
  ```

`.env.local` está en `.gitignore`: nunca se sube. Solo pide un secreto a Jorge
**por canal cifrado** si vas a probar una integración con clave compartida (las
claves de IA de Claude/Whisper son por-tenant y se pegan dentro de la app, no aquí).

### 1.4 Crear schemas + datos de demo

```bash
npm run db:sync     # crea schemas master + crm_demo, tablas, tenant "demo" y su admin
npm run db:seed     # (opcional) datos realistas: clientes, facturas, empleados, costes…
```

`db:sync` es idempotente (puedes repetirlo sin romper nada) y al terminar imprime
las credenciales. Hay más seeds opcionales en `package.json` (`db:seed:projects-demo`,
`db:seed:billing-demo`, etc.) si quieres poblar módulos concretos.

### 1.5 Arrancar

```bash
npm run dev         # http://localhost:3000
```

Login del tenant demo: **admin@demo.salamandra** / **Admin1234!**

---

## 2. El flujo de cada tarea (commits directos a master)

**Commits pequeños, build en verde, push a `master`.**

```bash
# 1) Partir de lo último de master
git checkout master
git pull origin master

# 2) Trabajar: editar, y confirmar en commits pequeños (Conventional Commits)
git add .          # revisa que NO entren .env* ni secretos
git commit -m "feat(modulo): descripción corta"

# 3) OBLIGATORIO antes de subir: build en verde
npm run build

# 4) Subir a master
git push origin master
```

Para cambios grandes o arriesgados sigue valiendo trabajar en una rama local
(`git checkout -b feat/lo-que-sea`) y fusionarla a `master` en local cuando esté
lista (`git checkout master && git merge feat/lo-que-sea`) — pero el push va
directo a `master`, sin PR.

> Si algo sale mal en master: NO reescribas la historia (`push --force`
> prohibido). Se arregla hacia delante con un commit nuevo o `git revert`.

---

## 3. Trabajando los dos a la vez

Somos dos empujando a la MISMA rama (`master`) y esa rama ES producción. Los
conflictos de texto (dos tocando las mismas líneas) son el problema **pequeño**:
git se para, avisa y no pierde nada. Los tres que sí duelen:

1. **Push rechazado** — el otro subió mientras tú acumulabas commits en local.
   No se pierde nada, pero se pierde el rato.
2. **Choque silencioso** — tocáis ficheros distintos, git fusiona sin quejarse y
   la combinación revienta. Ejemplo real: uno mueve una página a `/equipo/*` y el
   otro deja un enlace a la ruta vieja en otro fichero → 404 en producción sin
   que git haya dicho nada.
3. **Desplegar el trabajo a medias del otro** — el deploy sube TODO lo que haya
   en `master`, no solo lo tuyo. Y ahí abajo hay clientes reales (Aumenta con su
   equipo, `nutri_laura` con pacientes de verdad).

### El protocolo (4 reglas)

1. **Bajar lo del otro al empezar Y otra vez justo antes de subir:**
   ```bash
   git pull --rebase origin master
   ```
2. **Commits pequeños y subir el mismo día.** Sentarse encima de 10 commits
   durante horas es lo que fabrica los choques. Subiendo cada 30-60 min casi
   nunca hay nada que fusionar.
3. **Avisar por chat antes de tocar los ficheros calientes** (los que más se
   pisan, por historial): `package.json`, `lib/db/tenantDb.js`,
   `components/layout/Sidebar.jsx`, `scripts/_module-migrations.js` y `CLAUDE.md`.
4. **Avisar antes de desplegar.** Quien lanza `deploy.sh` se lleva a producción
   lo que haya en `master`, sea suyo o no: el otro confirma que no tiene nada a
   medias subido.

Trabajo largo o arriesgado → rama local, y se fusiona a `master` cuando compile
(§2). Con dos personas y módulos distintos esto basta; volver a PRs sería más
ceremonia de la que necesitamos.

### Puesta a punto en cada máquina (una vez)

Que `git pull` rebase por defecto, en vez de generar merges basura, y que no
falle si tienes cambios sin guardar:

```bash
git config --local pull.rebase true
git config --local rebase.autoStash true
```

### Aviso automático al arrancar Claude Code

`.claude/hooks/git-sync-check.mjs` (registrado como hook `SessionStart` en
`.claude/settings.json`) hace `git fetch` al abrir la sesión y avisa **antes de
tocar una línea** si tu `master` va por detrás del de GitHub, si tienes commits
sin subir o cambios sin commitear. Solo mira, no modifica nada; si no hay red lo
dice y sigue.

---

## 4. Convención de commits

Seguimos **Conventional Commits** (como el historial):

```
tipo(ámbito): descripción en minúscula

Cuerpo opcional explicando el qué y el porqué.
```

Tipos: `feat` (funcionalidad), `fix` (bug), `chore` (mantenimiento/infra),
`docs`, `refactor`, `test`. Ámbito = módulo (`documents`, `billing`, `outreach`…).

---

## 5. Reglas de oro (no las saltes)

- **`master` = producción.** Sin CI de por medio, **`npm run build` en verde
  ANTES de cada push** no es negociable. Si el build falla, no se sube.
- **Nada de `push --force` ni reescribir historia en `master`.** Los errores se
  arreglan hacia delante (commit nuevo o `git revert`).
- **Secretos:** nunca subas `.env*`, claves, tokens ni passwords. Están en
  `.gitignore` por algo. Se comparten por canal cifrado.
- **Migraciones de BD:** si añades una tabla/columna, escribe una **migración
  idempotente** en `scripts/migrate-*.js` que lea los tenants de `master.tenants`
  en runtime (nunca hardcodees slugs) y que se pueda re-ejecutar sin romper.
  Indica en el mensaje del commit si hay que correrla y en qué orden respecto
  al deploy (algunas van ANTES: ver la cabecera del script).
- **Activar un módulo a un cliente:** usa **siempre**
  `npm run db:enable-module -- <slug> <moduleKey>` (en el VPS:
  `docker exec crm-salamandra-app-1 node scripts/enable-module.js <slug> <moduleKey>`).
  Activar un módulo es un cambio de **datos**, pero sus tablas y columnas son
  **estructura**: ese script hace las dos mitades y en el orden correcto. Si solo
  tocas `master.tenant_modules` a mano, el schema se queda atrás y la primera
  lectura revienta con 42703 — fue lo que tumbó las reservas de tunutrilaura.com.
  Para poner al día un tenant existente sin activar nada:
  `npm run db:ensure-schema -- <slug>`. Qué migraciones lleva cada módulo se
  declara en `scripts/_module-migrations.js`; si añades una migración de módulo,
  apúntala ahí o nadie la ejecutará nunca. **El orden en que se ejecutan NO se
  escribe a mano**: se deduce del SQL de cada una (quien crea una tabla va antes
  que quien la altera). Audítalo con `npm run db:check-migration-order`, que
  además avisa de migraciones huérfanas y de aquellas cuyo SQL no consigue leer.
- **Multi-tenant:** toda query va por `getTenantContext`/`withTenant` + `hasModule`.
  Nunca conectes directo a PostgreSQL desde una ruta.
- **JavaScript puro** (sin TypeScript). `app/` en la raíz (sin `src/`).
- Revisa que el lint de **tus** ficheros está limpio (`npx eslint <tus-ficheros>`).

---

## 6. Resolver un conflicto (cuando dos tocáis lo mismo)

Tocar el mismo **fichero** no da conflicto; solo tocar las **mismas líneas**.
El conflicto salta al bajar lo del otro, que es justo donde queremos que salte
(antes de subir, no después):

```bash
git pull --rebase origin master   # trae master → aquí saltan los conflictos
```

Git marca el trozo en conflicto en el fichero:

```
<<<<<<< HEAD
(lo que ya estaba en master)
=======
(tu versión)
>>>>>>> tu commit
```

Edita el fichero dejándolo como debe quedar (elige una versión o combina),
**borra las 3 marcas** `<<<<`, `====`, `>>>>`, guarda y:

```bash
git add <fichero-resuelto>
git rebase --continue   # sigue con el resto de tus commits
git push origin master
```

Si te lías a mitad y quieres volver al punto de partida:
`git rebase --abort` (deja todo como estaba, no pierdes nada).

Git **nunca** descarta cambios en silencio: si hay duda, para y te pregunta.

---

## 7. Comandos útiles

```bash
git status                       # qué has cambiado
git switch master                # volver a master
git branch                       # ver tus ramas
git pull --rebase origin master  # bajar lo que ha subido el otro
git log --oneline -10            # últimos commits
git revert <sha>                 # deshacer un commit malo con otro commit
```

---

## 8. Despliegue

> Avisa al otro antes de lanzarlo: el deploy sube a producción **todo** lo que
> haya en `master`, sea tuyo o no (§3).

Con `master` actualizado y el build en verde, en el VPS:
`git pull` → `./deploy.sh` (con `--full` si cambiaron dependencias). Si el
commit traía una migración, mira la **cabecera del script** en `scripts/`:
algunas se ejecutan tras el deploy y otras ANTES (vía `docker cp` del script al
contenedor + `docker exec`), porque las columnas nuevas deben existir antes de
que la app nueva las lea. Los seeds (`npm run db:seed-*:prod`) van siempre
después del deploy.
