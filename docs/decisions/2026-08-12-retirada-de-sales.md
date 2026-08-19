# Retirada del `moduleKey` `sales`: la única clave del área comercial es `leads`

**Fecha:** 12/08/2026 · **Quién:** Jorge · **Módulos:** leads · **Lo que
quedó en `CLAUDE.md`:** una línea en la tabla de módulos.

## Qué había

Dos `moduleKey` para el área comercial, y el código aceptaba los dos:
`hasModule("leads") || hasModule("sales")` en dieciséis guardas.

## Qué se decidió y cómo se comprobó

`sales` se retiró. **No era limpieza, era un cambio de AUTORIZACIÓN**, así que
primero se comprobó contra producción que no dejaba a nadie fuera: de las ocho
filas comerciales de `master.tenant_modules`, siete eran `leads` y estaban
activas, y la única `sales` era la de la demo y estaba **apagada**; ningún
usuario tenía `sales` en su `module_access`.

Esa fila apagada sigue ahí y no molesta (comprobado el 19/08/2026: `demo ·
sales · OFF`) — la sembró `scripts/db-sync.js`, que tenía `sales` y no tenía
`leads` en su lista de módulos, y que se arregló en el mismo cambio.

## Cómo se aplica hoy

Un cambio que toque qué módulo abre qué puerta se comprueba **antes** contra
`master.tenant_modules` y `users.module_access` de producción, no solo contra
el código. Es la misma lección que
[2026-08-01-activar-un-modulo-tiene-dos-puertas.md](2026-08-01-activar-un-modulo-tiene-dos-puertas.md).
