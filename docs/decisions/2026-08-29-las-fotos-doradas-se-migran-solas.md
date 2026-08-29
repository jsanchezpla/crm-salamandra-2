# Las fotos doradas se migran solas (29/08/2026)

## Qué pasaba

Tres veces en dos días (26/08 mañana, 26/08 noche y el arreglo del 27/08):
una migración añadía columnas a los schemas vivos de las demos, las fotos
doradas (`crm_{slug}_golden`) se quedaban sin ellas, el aviso del final de
`deploy.sh` saltaba y alguien tenía que rehacerlas a mano. Era por
construcción: la foto es una copia (`CREATE TABLE AS TABLE`) y ninguna
migración la tocaba — `_schema-targets.js` la dejaba fuera a propósito
(«no es un tenant de `master`»).

El remedio manual tenía además su propio riesgo, documentado en el mismo
`deploy.sh`: rehacer la foto congela lo que haya en la demo EN ESE MOMENTO,
incluido lo que acabe de ensuciar un visitante cinco minutos antes.

## Qué se decidió

Rodrigo, 29/08/2026: rehacer las fotos debe entrar en el ritual de toda
migración de tenant. De las dos variantes que había sobre la mesa (re-foto
automática o migrar las fotos), se implementó la segunda, porque no congela
suciedad y no depende de que nadie se acuerde:

**`byTable` y `byModule` (scripts/_schema-targets.js) incluyen los schemas
dorados de las demos.** La migración les añade las mismas columnas —y los
mismos backfills— que al schema vivo, en la misma pasada. La foto no se queda
atrás nunca, y el dato backfilleado queda EN la foto (mejor que la re-foto:
el restore de cada recarga lo propaga al vivo en lugar de borrarlo).

Detalles de la mecánica:

- `byTable`: el dorado entra si TIENE la tabla (si no la tiene, no hay nada
  que blindar; la deriva de tablas la sigue cantando el deploy).
- `byModule`: el dorado entra si la demo tiene el módulo y el schema existe.
- `ONLY_SCHEMAS` sigue siendo exclusivo: tampoco añade dorados.
- Migraciones que derivan el slug del nombre del schema: usar el nuevo
  `slugDeSchema()` del helper (`crm_demo_golden` → `demo`), no
  `replace(/^crm_/, "")`, que saca «demo_golden». Las seis migraciones viejas
  con ese patrón ya corrieron y no re-corren; si alguna se relanza, que sea
  con `ONLY_SCHEMAS`.

## Qué queda manual (y está bien que lo esté)

Rehacer la foto (`demo-golden-snapshot.js`) queda SOLO para cuando cambian
los DATOS a propósito: seeds nuevos, rebuild del escaparate. El aviso del
deploy sigue en su sitio como red — si salta a partir de ahora, lo raro es la
migración (¿usa `_schema-targets`?, ¿fue con `ONLY_SCHEMAS`?) o es deriva de
datos.

## Cómo se comprueba

- `scripts/_smoke-fotos-doradas-migran.mjs` (ligera, BD de mentira) fija que
  los dos modos devuelven los dorados y que `slugDeSchema` los entiende.
- En producción: la deriva viva del 29/08 (`team_members.collegiate_number` y
  `qualification`, que `migrate-team-colegiada.js` dejó solo en los vivos) se
  cierra relanzando esa migración con el helper nuevo; después,
  `demo-golden-snapshot.js --comprobar` en verde SIN pasada manual.
