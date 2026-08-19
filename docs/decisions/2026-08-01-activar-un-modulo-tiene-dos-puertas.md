# Activar un módulo tiene dos puertas

**Fecha:** 01/08/2026 (después de tropezar dos veces) · **Quién:** Jorge ·
**Módulos:** team (accesos), y cualquier módulo que se active — los casos
fueron `analytics` y `documents` · **Lo que quedó en `CLAUDE.md`:** la regla
del caso 1 de la escalera (#16) y `enable-module.js` / `db:check-access`.

## Qué pasó

No basta con `master.tenant_modules`: si el usuario tiene una lista explícita
en `users.module_access`, el sidebar le oculta el módulo y la API le responde
403 aunque el cliente lo tenga contratado. Pasó con `analytics` en
`spain_enzymes` (31/07/2026) y con `documents` en `nutri_laura` (01/08/2026);
**las dos veces lo detectó el cliente, no nosotros**.

## Qué se decidió

- `scripts/enable-module.js <slug> <moduleKey>` abre las DOS puertas: da de alta
  la fila de `tenant_modules` y da acceso a los **admin** automáticamente
  (`--sin-admins` para evitarlo). Avisa de los usuarios normales, que se dan
  con `--grant-users`. Siembra además lo que el módulo traiga de fábrica (p. ej.
  las nueve tablas y los 497 alimentos de `nutricion`).
- `npm run db:check-access` (solo lectura) lista quién no ve qué en TODOS los
  clientes. Se lanza tras activar módulos y en cada despliegue que los toque.

## Cómo se aplica hoy

Es el **caso 1 de la regla #16**: un cliente pide un módulo que ya tenemos → no
se toca código. `/admin/modulos` para ver qué tiene, `enable-module.js` para
encenderlo, `db:check-access` para comprobar que lo ve. Minutos, sin
despliegue. Si el caso 1 lleva a abrir un fichero de código, algo va mal.

Detalle de las tres puertas (módulo del tenant, acceso del usuario, gate del
endpoint) en `docs/base/module-access.md`.
