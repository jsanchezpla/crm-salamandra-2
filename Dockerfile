# ── Imagen de producción — build se hace en el VPS host ──────────────────────
# Flujo de deploy:
#   Fast:  npm run build (en VPS) → docker compose up -d --build --no-deps app
#   Full:  npm ci (en VPS) → npm run build (en VPS) → docker compose up -d --build

FROM node:22-alpine
WORKDIR /app

# bcrypt y Sequelize necesitan herramientas nativas en runtime
RUN apk add --no-cache python3 make g++

# Usuario sin privilegios
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# Solo dependencias de producción (devDeps no son necesarias en runtime)
COPY package*.json ./
RUN npm ci --omit=dev

# Artefactos del build (generados en el VPS con npm run build)
COPY --chown=nextjs:nodejs .next ./.next
COPY --chown=nextjs:nodejs public ./public
COPY next.config.mjs ./

# Runtime de Sequelize — necesarios en ejecución, no en build
COPY --chown=nextjs:nodejs lib ./lib
COPY --chown=nextjs:nodejs models ./models
COPY --chown=nextjs:nodejs scripts ./scripts

# `docs/` NO viaja: es documentación interna que no pinta nada en la aplicación.
# Hasta el 19/08/2026 se copiaban `docs/backlog.md` y `docs/resuelto.md` para el
# tablero del back-office; desde entonces el Registro vive en
# `master.tablero_documentos` y se publica con `scripts/tablero-doc.js`, sin
# pasar por la imagen (ver docs/como-apuntar-en-el-tablero.md).

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

USER nextjs
EXPOSE 3000

CMD ["node_modules/.bin/next", "start"]
