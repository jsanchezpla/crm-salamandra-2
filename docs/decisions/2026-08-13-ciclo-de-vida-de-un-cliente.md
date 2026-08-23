# El ciclo de vida de un cliente, en un sitio: la baja aparta, no destruye

**Fecha:** 13/08/2026 · **Quién:** Jorge · **Módulos:** provisioning
(back-office de `salamandra_solutions`) · **Lo que quedó en `CLAUDE.md`:**
las cuatro piezas de `lib/provisioning/` y la regla «destruir es SSH».

## Las cuatro piezas

`lib/provisioning/` tiene cuatro piezas y conviene saber cuál es cuál antes de
tocar ninguna:

| Fichero | Qué hace |
| --- | --- |
| `altaTenant.js` | Lo crea: schema, tablas, módulos con dependencias, admin, marca y datos fiscales. |
| `cicloVida.js` | Lo edita, suspende y reactiva (reactivar pone además su schema al día). |
| `credencialesCliente.js` | Le pone las claves. **Solo escribir**: nada de esto las LEE nunca. |
| `bajaTenant.js` | Lo cierra. |

Debajo de las cuatro hay una quinta que no es una fase del ciclo sino **la
puerta**: `dependencias.js` («dime qué selección de módulos tienes y te digo si
se sostiene»). La usan las tres entradas del alta y la edición.

> **`validarSeleccion()` y `completarSeleccion()` tratan como selección VACÍA
> cualquier cosa que no sea un array** (21/08/2026). Antes reventaban con
> `TypeError` y el alta contestaba **500** en vez del **422** «Elige al menos un
> módulo» que ya existe justo debajo, porque el route de
> `POST /api/provisioning/clientes` pasa `body.modulos` sin mirarlo. Se arregló
> en la puerta y no en el llamador: `cicloVida.js` ya comprobaba `Array.isArray`
> y `paquetes.js` normaliza por su cuenta, así que arreglarlo arriba habría
> dejado a los otros dos esperando su turno. Una selección que no es una lista no
> sostiene nada, y no cambia ni un resultado de los que ya funcionaban.

## Por qué la baja aparta y no destruye

La baja renombra el schema a `zzz_baja_<slug>_<fecha>` y mueve sus ficheros a
`uploads/_bajas/<slug>_<fecha>/`, dejando un `.rollback.sql` que lo devuelve
todo. Es reversible, y **por eso puede ser un botón** del back-office.

**Destruir de verdad sigue siendo SSH** y no tiene endpoint:
`scripts/borrar-tenant.js <slug> --purgar`. El motivo no es solo prudencia —
las facturas tienen obligación legal de conservarse años y los registros de
auditoría no se borran nunca; apartar convive con las dos cosas y purgar no.

## La red de rescate caduca

Lleva los `password_hash` de sus usuarios sobre disco, así que caduca:
`scripts/podar-bajas.js` (90 días por defecto), y la purga se lleva la del
cliente que purga.

## Contexto

Se construyó el día después de purgar tres clientes a mano
([2026-08-12-bajas-abarcaia-quality-healim.md](2026-08-12-bajas-abarcaia-quality-healim.md)).
