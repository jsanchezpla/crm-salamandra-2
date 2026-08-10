# Despliegue

> Verificado contra `deploy.sh`, `Dockerfile` y CLAUDE.md el 2026-08-07.

---

## 1. Dos entornos, datos independientes

| | Local | Producción |
| --- | --- | --- |
| SO | Windows 10 / PowerShell | VPS Linux / bash |
| Ejecución | `npm run dev` | Docker Compose |
| Config | `.env.local` (gitignored) | `.env.production` en el VPS (gitignored) |
| URL | `http://localhost:3000` | nginx **nativo** → `127.0.0.1:3000` |

**Los schemas coinciden porque vienen del código. Los datos no se sincronizan
nunca.**

⚠️ La lista de tenants **no es la misma** en los dos entornos, y **un mismo
tenant puede tener módulos distintos en cada uno**. Verificar siempre con
`scripts/inspect-tenant-modules.js <slug>` contra el entorno que toque.

## 2. Contenedores

| Container | Imagen | Puerto |
| --- | --- | --- |
| `crm-salamandra-app-1` | `crm-salamandra-app` | `127.0.0.1:3000->3000` |
| `crm-salamandra-db-1` | `postgres:16-alpine` | 5432 (interno) |
| `n8n` | `n8nio/n8n:latest` | `127.0.0.1:5678->5678` |
| `n8n-postgres` | `postgres:15-alpine` | 5432 (interno) |

## 3. `deploy.sh` — se ejecuta EN el VPS

1. `git pull`
2. Detecta si cambiaron `package.json` / `package-lock.json`
3. **Sin cambios de deps**: `npm run build` en el host →
   `docker compose up -d --build --no-deps app`
4. **Con cambios (o `--full`)**: `npm ci` → `npm run build` →
   `docker compose down` → `docker compose up -d --build`

El build se hace **en el host del VPS, no dentro de Docker**, porque necesita
devDependencies (Tailwind). El Dockerfile solo copia los artefactos `.next/`
ya compilados más las deps de producción.

## 4. Dockerfile

- Base `node:22-alpine` con python3/make/g++ (los necesita bcrypt).
- Copia solo `.next/`, `public/`, `lib/`, `models/`, `scripts/`,
  `next.config.mjs`.
- Corre como usuario `nextjs`, sin privilegios.
- `npm ci --omit=dev`.

## 5. Scripts en producción — siempre por Docker

```bash
docker exec crm-salamandra-app-1 node scripts/mi-script.js
```

⚠️ **Dos errores que cuestan tiempo:**

- **No usar `--env-file` dentro del contenedor.** Las envs ya vienen
  inyectadas por `env_file` de Compose. Pasarlo hace que Node busque un
  fichero que ahí no existe.
- **No usar `npm run *:prod` en el host del VPS.** Esos scripts apuntan a
  `.env.production`, pero en el host no está la red de Docker: la conexión a
  la BD falla o, peor, va a otro sitio.

## 6. Checklist de despliegue

**Antes:**

- [ ] `npm run build` en verde **en local** — ya no hay CI que lo pare.
- [ ] Ni `.env*` ni secretos en el commit.
- [ ] Si hay migración: probada en local y **idempotente**.
- [ ] Si toca módulos: saber a qué tenants afecta **en producción**
      (`inspect-tenant-modules.js`), que no es lo mismo que en local.

**Después:**

- [ ] Migraciones con `docker exec`.
- [ ] `npm run db:check-access` — la puerta de `module_access` es la que se
      olvida, y las dos últimas veces lo detectó el cliente.
- [ ] `npm run db:check-links` si el sprint tocó FKs cliente/equipo.
- [ ] Comprobar la pantalla afectada en un tenant real.

## 7. Secrets

- `.env.production` vive **solo en el VPS**. `.env.production.example` sí está
  en el repo.
- Al rotar un secret: generarlo en local, ponerlo por SSH en el VPS y
  comunicarlo por canal cifrado.
- **Nunca por chats con LLMs.** Un secret visto en un chat se considera
  comprometido y se rota.

## 8. Variables que cambian el comportamiento

| Variable | Efecto |
| --- | --- |
| `JWT_SECRET` | Firma de los access tokens. |
| `ADMIN_HOST` | Host del back-office. **Sin ella el panel no se sirve en ningún sitio** (falla en cerrado). |
| `WIDGET_FRAME_ANCESTORS` | JSON `{slug: "https://dominio"}`. Quién puede incrustar el widget. Un tenant sin entrada queda en `*`. |
| `SMOKE_BASE_URL` | URL base de los smoke tests (por defecto `http://localhost:3000`). |

`WIDGET_FRAME_ANCESTORS` va en el entorno y no en la BD porque el middleware
corre antes que Sequelize y no puede consultar PostgreSQL.
