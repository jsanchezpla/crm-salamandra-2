# Los ficheros ya no caben en la copia (28/08/2026)

**Regla:** la copia diaria de `uploads/` es un **espejo** más **lo que cambió esa
noche**, no el archivo entero empaquetado. El `.tar.gz` completo sigue
haciéndose, pero una vez por semana.

---

## Lo que pasaba

Desde el 14/08 la copia nocturna incluía `uploads/` —contratos firmados,
informes clínicos, adjuntos— en un `tar.gz` con la misma marca de tiempo que el
volcado de la base. Con 127 MB era gratis y nadie lo pensó dos veces.

El **26/08 la migración del OneDrive de Aumenta metió 6,2 GB** de documentación
clínica en esa carpeta. El paquete diario pasó de 127 MB a **5,3 GB de una noche
a otra**, y el script siguió haciendo exactamente lo que le habían mandado.

Los números del 28/08, medidos en el VPS:

| | |
| --- | --- |
| `uploads-*.tar.gz` hasta el 26/08 | 127 MB cada uno |
| 27/08 y 28/08 | **5,3 GB cada uno** |
| Retención | 14 días |
| Ocupado en `backups/` | 13 GB |
| Libre en el disco | 44 GB de 99 |

Cada noche entraba una copia de 5,3 GB y salía una de 127 MB: **+5,2 GB netos
por noche**. Régimen estacionario: 14 × 5,3 = **74 GB donde había 44 libres**. El
disco se llenaba hacia el **6 de septiembre**, y con el disco lleno no escribe ni
PostgreSQL ni la subida de un documento.

**Y no había forma de enterarse.** El registro terminaba en «✅ Copia completada»
todas las mañanas, porque la copia salía bien: el problema no era que fallara,
era que cabía hoy y no mañana. El script no miraba el disco en ninguna parte.

Lo encontró una pasada por el Registro, no un aviso.

## Lo que se hace ahora

```
backups/uploads-espejo/                  el estado de HOY, una sola copia (6,2 GB)
backups/uploads-cambios/AAAAMMDD-HHMM/   solo lo que esa noche se pisó o se borró
backups/uploads-AAAAMMDD-HHMM.tar.gz     el paquete portátil, UNA VEZ POR SEMANA
```

El espejo se mantiene con `rclone sync … --backup-dir`: lo que el sync quitaría
o pisaría no se pierde, se aparta en el directorio de esa noche **con su ruta
original dentro**. Una noche cuesta lo que ocupa lo que cambió. En un archivo que
casi solo crece, eso son kilobytes — medido en el banco de pruebas: una noche con
un fichero borrado, uno modificado y uno nuevo costó **20 KB** donde antes
costaba una copia entera.

Régimen estacionario: **~17 GB** (6,2 de espejo + 2 paquetes semanales + los
volcados) frente a los 74 GB a los que iba.

### Por qué así y no de las otras dos formas

**No `tar --listed-incremental`** (que es lo que primero apetece, porque no toca
nada más): porque la rotación por antigüedad y las cadenas incrementales no se
llevan bien. A los 14 días se va el paquete completo y quedan quince parciales
que ya no se pueden aplicar a nada — una copia rota con toda la pinta de estar
bien, que es la peor clase de copia. Con directorios por noche, **borrar una
noche no estropea ninguna otra**: cada una se basta sola.

**No `rsync --link-dest`**, que es la forma canónica de hacer esto: **el VPS no
tiene rsync instalado**. Se intentó instalarlo y se paró: es su servidor y añadir
paquetes no es una decisión de un despliegue. `rclone` ya estaba —se instaló el
20/08 para la copia externa— y hace lo mismo. De paso queda apuntado que la rama
`rsync` de `DESTINO_REMOTO` **hoy no funcionaría** si se eligiera un destino de
ese tipo; la de `rclone`, sí.

## El fallo que casi se cuela

Al meter el espejo **dentro** de `backups/`, la rotación pasó a ser peligrosa
sin que se notara. Borraba así:

```bash
find "$DIR_BACKUPS" \( -name 'auto-*.sql.gz' -o -name 'uploads-*.tar.gz' \) -delete
```

Sin `-maxdepth`, ese `find` recorre ahora los **7.737 documentos de pacientes**
del espejo. Un contrato que alguien hubiera subido llamado `uploads-2019.tar.gz`
encaja en el patrón y **se borra de la copia de seguridad**, en silencio y para
siempre. Lleva `-maxdepth 1` y hay dos señuelos en el banco de pruebas que lo
comprueban.

## Lo que además se añadió

**Un aviso de disco.** Si quedan menos de `MINIMO_LIBRE_GB` (15 por defecto),
manda correo esa misma noche. No aborta: una copia con el disco justo sigue
siendo mejor que ninguna, y quien decide es una persona. Es la pieza que faltaba
—esto se vio a mano cuatro días tarde— y la que evita el siguiente susto, sea
cual sea su causa.

**El parte de los lunes** ahora dice el tamaño del espejo, cuántas noches de
cambios hay y **cuánto disco queda**.

## Cómo se recupera

El caso real es «se ha borrado un informe», no «se ha perdido el servidor»:

```bash
find backups/uploads-cambios -name '*loquesea*'
cp backups/uploads-cambios/AAAAMMDD-HHMM/<ruta> uploads/<ruta>
```

Todo el archivo a como estaba anoche, `rclone copy backups/uploads-espejo …`
(**`copy`, no `sync`**: añade y pisa, pero no borra lo que haya de más). Y desde
el paquete semanal, el `tar xzf` de siempre. El detalle, en la cabecera del
script.

## Qué NO sale del servidor, y por qué

El espejo y las noches de cambios **no** se suben al destino externo. Son 6,2 GB
que no caben en la capa gratuita de R2 ni de B2, y cuánto se paga por guardar el
archivo clínico fuera es una decisión de Jorge, no de este script. Fuera van los
volcados de la base y el paquete semanal — que además es una mejora sobre lo de
antes, donde habrían salido 5,3 GB cada noche.

Mientras tanto sigue en pie lo apuntado en el Registro: **no hay copia fuera del
servidor**, porque falta elegir destino y crear sus credenciales (regla 15, no
pasan por un chat). Con esto, el único otro sitio donde está el archivo clínico
de Aumenta sigue siendo el OneDrive del centro.

## Dónde

| Qué | Dónde |
| --- | --- |
| El script | `scripts/backup-db.sh` (cabecera «LOS FICHEROS NO CABEN») |
| Los frenos, con prueba | `scripts/_smoke-copia-ficheros.mjs` |
| El temporizador | `scripts/deploy/crm-backup.service` · 03:15 UTC |
| Lo anterior | [El borrado no viaja](2026-08-21-el-borrado-no-viaja.md) (21/08) y `docs/blindaje-datos-2026-08.md` |
