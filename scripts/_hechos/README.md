# scripts/_hechos/ — lo que ya se ejecutó y no volverá

Aquí viven los scripts que **ya hicieron su trabajo y nadie va a volver a
lanzar**: importaciones iniciales de un cliente, arreglos de datos de un día
concreto, activaciones de módulo anteriores a `enable-module.js`, cambios de
marca que hoy se hacen desde el panel, semillas y parches de clientes que ya no
existen, migraciones superadas, smokes manuales de sprints cerrados. Se
**mueven**, no se borran: la historia sigue aquí y en git, y un `grep` los
encuentra igual.

**No hay índice a mano** (mentiría en una semana): la lista es `ls` de esta
carpeta, y cada fichero explica en su cabecera para qué nació.

## El criterio, y quién lo mide

«Ya se ejecutó en producción» **no** es el criterio. Una migración aplicada
sigue **viva** si un alta de cliente o un `enable-module` la necesita (las corre
`scripts/_module-migrations.js`); una semilla de demo sigue viva si la
reconstrucción de las demos la usa; una herramienta de inspección sigue viva
aunque lleve un mes sin lanzarse; una migración de `master` sigue viva porque
un entorno nuevo la necesita. El criterio es:

> **Ningún flujo vivo lo llama, y no vale ni para un alta ni para un entorno
> nuevo ni para repetirse con otro cliente.**

Quién lo mide: `node scripts/_inventario-scripts.mjs` cruza cada script con el
mapa de migraciones, las importaciones reales en `lib/`, `app/` y otros
scripts, los temporizadores del VPS versionados en `scripts/deploy/*.service`,
el Dockerfile, `deploy.sh`, las skills y el manual del Registro, y da un
veredicto (VIVO / CANDIDATO / DUDA). Lo que no es VIVO se **lee** antes de
moverlo; el traslado del 19/08/2026 lo leyó un agente por lote y otro intentó
refutar cada «hecho». Ante duda real, gana vivo: mover de más cuesta más que
mover de menos.

## Lo que cambia al mover un script aquí

- **Sus imports relativos** a otros scripts (`./_schema-targets.js`) pasan a
  `../`: siguen siendo ejecutables desde aquí si algún día hace falta releer qué
  hicieron (`node --env-file=.env.local scripts/_hechos/x.js`). Lo que importan
  de `lib/` ya iba por `../lib/` y pasa a `../../lib/`.
- **Sus alias de `package.json`** se quitan: eran restos de cuando las
  migraciones se lanzaban a mano.
- **Las entradas de `ONE_OFF`** en `_module-migrations.js` que los nombraban se
  quitan: el mapa habla de lo que hay en `scripts/`.
- **La prosa que los cita** (Mapas de `docs/modules/`, CLAUDE.md) pasa a decir
  `scripts/_hechos/x.js`.
- **No viajan a la imagen** de Docker (`.dockerignore`).

## Si algo de aquí hace falta otra vez

Se lanza desde aquí, o se mueve de vuelta con `git mv`; si se mueve, se
deshacen los cuatro retoques de arriba. Y si el motivo es que hacía falta para
un alta o un entorno nuevo, la entrada correcta es el mapa de migraciones o
`enable-module.js`, no esta carpeta.
