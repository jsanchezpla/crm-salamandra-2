# `cuestionarios` deja de ser un módulo: es una pantalla de Formación

**Fecha:** 10/08/2026 · **Quién:** Jorge · **Módulos:** training · **Lo que
quedó en `CLAUDE.md`:** la fila tachada en la tabla de módulos.

## Qué se decidió

`cuestionarios` nunca fue un módulo del todo: la puerta de sus siete endpoints
era `training || cuestionarios`, así que quien compraba Formación ya lo tenía.
Ahora es una pantalla de Formación (`/formacion/cuestionarios`) y solo se pide
`training`.

## Qué NO se tocó

Ni el código de los cuestionarios ni la tabla `quiz_attempts` — Retorika tiene
ahí 526 intentos reales (comprobado en producción el 19/08/2026: siguen siendo
526). Las filas `cuestionarios` de `master.tenant_modules` que quedaban (aumenta,
demo) están **apagadas** y no molestan.

## Cómo se aplica hoy

Con «formación abierta» encendida (`featureFlags.formacionAbierta` de
`training`, desde el 18/08/2026), la pantalla de Cuestionarios y la de Empresas
se esconden del menú: es la portada que usa Aumenta. Detalle en
`docs/modules/training.md`.
