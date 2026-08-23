# Las migraciones no filtran por `status`: el estado decide quién puede entrar, no qué forma tiene su schema

**Fecha:** 12/08/2026 · **Quién:** Jorge · **Módulos:** transversal
(scripts de migración, provisioning) · **Lo que quedó en `CLAUDE.md`:** la
regla #12 y su excepción para seeds y backfills.

## Qué pasó

Filtrar por `status = 'active'` deja a los clientes suspendidos congelados en
el schema del día que se apagaron, y en silencio —como suspender los apaga de
verdad, nadie choca con nada hasta que se reactivan—. Se descubrió en
producción con `quality_energy` (22 columnas de retraso en 7 tablas) y
`abarcaia` (20 en 6), mientras los siete activos estaban al día.

Es el incidente del 2026-07-21 con otro disfraz: **elegir schemas por una
condición de NEGOCIO en vez de por lo que hay en la base de datos**.

## Qué cambió

- `scripts/_schema-targets.js` (lo usaban 43 de las 103 migraciones) ya no
  mira el estado, ni en `byTable` ni en `byModule`.
- Las otras 30, que llevaban su propio `WHERE status = 'active'` copiado a
  mano, se barrieron el mismo día. `fetchActiveSlugs` pasó a llamarse
  `fetchTargetSlugs` donde existía: el nombre habría empezado a mentir.
- Reactivar un cliente pone además su schema al día solo
  (`lib/provisioning/cicloVida.js`), que es el momento en que el retraso pasa
  de inofensivo a 500 en pantalla.

## Cómo se aplica hoy

- Una migración nueva usa el helper `_schema-targets.js`. Si por lo que sea no
  puede, que su consulta no mire `status`. Y nunca hardcodea slugs: la lista
  difiere entre local y producción.
- **Esto vale para la ESTRUCTURA, no para los datos.** Un seed o un backfill
  (`seed-foods-base-catalog.js`, `backfill-nutricion-assignments.js`,
  `reset-aumenta-real-data.js`) sí debe seguir mirando `status`: sembrar datos
  en un cliente apagado no arregla nada y puede ensuciar lo que había.
