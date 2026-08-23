# Sincronizar siempre antes de commitear, y preguntar si algo se solapa

**Fecha:** 13/08/2026 · **Quién:** Jorge · **Módulos:** transversal (flujo
de trabajo) · **Lo que quedó en `CLAUDE.md`:** el bloque de la regla #11.

## Qué pasó

Aquí trabajan DOS personas empujando a `master` sin PRs que avisen (desde el
19/07/2026 el flujo es commits directos a `master`, sin PRs ni ruleset). El
13/08, en una sola hora, entraron `25c7771` y `94a6d3f` mientras había trabajo
a medias en local.

## Qué se decidió

Antes de commitear nada:

```bash
git fetch origin && git diff --name-only HEAD origin/master
```

Si ninguno de esos ficheros es tuyo, `git pull --ff-only` y adelante. **Si
alguno coincide, PARA Y PREGUNTA** qué hacer — no lo resuelvas por tu cuenta
aunque el conflicto parezca trivial. Lo que se ve en un diff es el texto, no la
intención: dos cambios pueden fusionar limpiamente y ser incompatibles igual, y
quien puede saberlo es quien escribió el otro. Enseña las dos versiones y
espera.

## El solape más probable

`docs/backlog.md` y `docs/resuelto.md`: son los dos ficheros donde escriben las
dos personas y las dos skills (`backlog`, `incidencias-buzon`). Un `pull
--rebase` a ciegas los fusionaría en silencio, y que dos tareas no den conflicto
de texto no significa que sean compatibles: puede que el otro esté sellando
como resuelta justo la que tú vas a apuntar.
