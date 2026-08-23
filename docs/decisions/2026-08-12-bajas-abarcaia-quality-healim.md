# Tres bajas el 12/08/2026: `abarcaia`, `quality_energy` y `healim`

**Fecha:** 12/08/2026 · **Quién:** Rodrigo · **Módulos:** transversal
(tenants, leads, citas, tablero) · **Lo que quedó en `CLAUDE.md`:** dos líneas
en la sección de tenants.

## Qué se hizo

Los tres se dieron de baja y **se purgaron sus schemas**: ya no existen ni en
`master.tenants` ni en PostgreSQL (comprobado el 19/08/2026: no hay ningún
schema `zzz_baja_*` en producción; la purga fue completa). Antes se sacó un
volcado de los tres a
`/root/backups/bajas-abarcaia-quality-healim-20260812.sql.gz` en el VPS (84
leads de Abarca, 129 de Quality, 5 citas pasadas de Healim). **Si algún día
hace falta algo de ahí, está en ese fichero y en ningún otro sitio.**

Con ellos se fueron sus overrides de leads, sus seeds y sus scripts de un solo
uso, y el módulo `referidos` (formulario público de Abarca), que solo tenía
sentido para ellos.

## Lo que se conserva a propósito

**Sus nombres siguen en `app/api/admin/tablero/route.js`**: el tablero lee
tareas históricas donde están escritos, y quitarlos de esa lista dejaría esas
tareas sin cliente.

## Contexto

Ese mismo día se dio de alta `somos` (21 módulos, sin datos todavía) y salió a
la luz que ni `somos` ni `healim` estaban en la tabla de tenants de
`CLAUDE.md`: otra lista a mano desviada (ver
[2026-08-10-las-listas-copiadas-a-mano-mienten.md](2026-08-10-las-listas-copiadas-a-mano-mienten.md)).
El mecanismo de baja «que aparta en vez de destruir» se construyó al día
siguiente:
[2026-08-13-ciclo-de-vida-de-un-cliente.md](2026-08-13-ciclo-de-vida-de-un-cliente.md).
