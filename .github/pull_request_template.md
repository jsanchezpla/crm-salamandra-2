## Qué hace este PR

<!-- Explica en 1-3 líneas el cambio y por qué. -->

## Checklist

- [ ] Probado en local (`npm run dev`) y funciona
- [ ] `npm run build` pasa; el lint de los ficheros que toco está limpio
- [ ] **¿Afecta a producción al hacer `git pull` en el VPS?** (deps nuevas → deploy con `--full`; migración a ejecutar; etc.)
- [ ] Si toca BD: hay **migración idempotente** que lee los tenants de `master.tenants` (no hardcodea slugs)
- [ ] No he tocado `.env*` ni subido secretos (los secrets van por canal cifrado, nunca al repo)
- [ ] Docs actualizadas si aplica (`docs/modules/*`, `CLAUDE.md`)

## Cómo probarlo

<!-- Pasos para que el revisor lo pruebe: rutas a abrir, comandos, datos de ejemplo. -->

## Notas para el deploy

<!-- ¿Hay que correr una migración tras el merge? ¿Variable de entorno nueva en el VPS? Si no, "ninguna". -->
