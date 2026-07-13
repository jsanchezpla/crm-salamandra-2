# Cómo trabajar en este proyecto

CRM SaaS multi-tenant (Next.js 16 + PostgreSQL + Sequelize, JavaScript sin TypeScript).
Esta guía es el flujo de trabajo con git para colaborar sin romper producción.

> ⚠️ **`master` es PRODUCCIÓN.** El VPS despliega haciendo `git pull` de `master`.
> Todo lo que se mergea a `master` puede acabar desplegado. Por eso **nadie hace
> `git push` directo a `master`**: todo entra por Pull Request revisado.

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

## 2. El flujo de cada tarea (GitHub Flow)

**1 tarea = 1 rama = 1 Pull Request.** Ramas cortas y mergeadas rápido.

```bash
# 1) Partir de lo último de master
git checkout master
git pull origin master

# 2) Crear tu rama (nombre descriptivo: feat/, fix/, chore/, docs/…)
git checkout -b feat/lo-que-sea

# 3) Trabajar: editar, y confirmar en commits pequeños
git add .
git commit -m "feat(modulo): descripción corta"

# 4) Subir TU rama (no master)
git push -u origin feat/lo-que-sea
```

Luego, en GitHub, abre un **Pull Request** de tu rama hacia `master`
(o por terminal: `gh pr create --fill`). El CI corre solo (build + lint de lo
que cambiaste). Rellena la plantilla del PR.

**Jorge revisa** (diff + a veces prueba en local) y:
- pide cambios → tú haces más commits y `git push` (el PR se actualiza), o
- aprueba → **Squash and merge** (deja 1 commit limpio en master) y borra la rama.

Después de mergear, para empezar otra tarea vuelve al paso 1.

---

## 3. Convención de commits

Seguimos **Conventional Commits** (como el historial):

```
tipo(ámbito): descripción en minúscula

Cuerpo opcional explicando el qué y el porqué.
```

Tipos: `feat` (funcionalidad), `fix` (bug), `chore` (mantenimiento/infra),
`docs`, `refactor`, `test`. Ámbito = módulo (`documents`, `billing`, `outreach`…).

---

## 4. Reglas de oro (no las saltes)

- **`master` = producción.** Nunca fuerces un merge sin que el CI (build) esté verde.
- **Secretos:** nunca subas `.env*`, claves, tokens ni passwords. Están en
  `.gitignore` por algo. Se comparten por canal cifrado.
- **Migraciones de BD:** si añades una tabla/columna, escribe una **migración
  idempotente** en `scripts/migrate-*.js` que lea los tenants de `master.tenants`
  en runtime (nunca hardcodees slugs) y que se pueda re-ejecutar sin romper.
  Indica en el PR si hay que correrla tras el deploy.
- **Multi-tenant:** toda query va por `getTenantContext`/`withTenant` + `hasModule`.
  Nunca conectes directo a PostgreSQL desde una ruta.
- **JavaScript puro** (sin TypeScript). `app/` en la raíz (sin `src/`).
- Antes de abrir el PR: `npm run build` en local y revisa que el lint de **tus**
  ficheros está limpio (`npx eslint <tus-ficheros>`).

---

## 5. Resolver un conflicto (cuando dos tocáis lo mismo)

Tocar el mismo **fichero** no da conflicto; solo tocar las **mismas líneas**.
Si al abrir el PR GitHub dice *"This branch has conflicts"*, resuélvelo en tu rama:

```bash
git checkout feat/tu-rama
git pull origin master        # trae master → aquí saltan los conflictos
```

Git marca el trozo en conflicto en el fichero:

```
<<<<<<< HEAD
(la versión de master)
=======
(tu versión)
>>>>>>> feat/tu-rama
```

Edita el fichero dejándolo como debe quedar (elige una versión o combina),
**borra las 3 marcas** `<<<<`, `====`, `>>>>`, guarda y:

```bash
git add <fichero-resuelto>
git commit          # cierra la fusión
git push
```

Git **nunca** descarta cambios en silencio: si hay duda, para y te pregunta.

---

## 6. Comandos útiles

```bash
git status                       # qué has cambiado
git switch master                # volver a master
git branch                       # ver tus ramas
git pull origin master           # actualizar master
gh pr create --fill              # abrir PR desde terminal
gh pr checkout <número>          # bajarte la rama de un PR para probarla
```

---

## 7. Despliegue (lo hace Jorge)

Cuando un PR está mergeado y validado, en el VPS:
`git pull` → `./deploy.sh` (con `--full` si cambiaron dependencias). Si el PR
traía una migración, se ejecuta dentro del contenedor tras el deploy.
