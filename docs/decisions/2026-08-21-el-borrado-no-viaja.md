# El borrado no viaja

**21/08/2026** · Toca a: `scripts/backup-db.sh`, `scripts/deploy/crm-backup.service` ·
Ficha resumida en [`../blindaje-datos-2026-08.md`](../blindaje-datos-2026-08.md), sección 1.

## Qué pasaba

Desde el 07/08/2026 la copia de la noche sale también del servidor si hay un
`DESTINO_REMOTO` configurado. Se subía con `rclone sync` (o `rsync --delete`),
que es un **espejo**: el destino quedaba igual que la carpeta local, y la
carpeta local guarda 14 días.

O sea que el destino externo no protegía de lo que más asusta. Si algo vaciaba
`/opt/crm-salamandra/backups` —un disco que se va, un script mal apuntado, una
persona limpiando espacio—, a las 03:15 de la noche siguiente ese borrado
**viajaba**, y las copias de fuera desaparecían con las de dentro.

Una copia de seguridad que se puede borrar desde la máquina que protege no es
una copia de seguridad.

## Qué se decidió

**La copia externa solo SUMA.** `rclone copy` y rsync sin `--delete`. Lo que ya
llegó allí no lo borra este script pase lo que pase aquí. Como efecto lateral,
tampoco hace falta que el proveedor tenga versionado ni papelera activados: eso
era una tirita para un problema que ahora no existe.

**A cambio, el destino tiene su propia caducidad, más larga que la de casa**:
14 días en el servidor (`RETENCION_DIAS`), 90 fuera
(`RETENCION_REMOTA_DIAS`). Los 14 cubren el susto que se ve el mismo día —un
borrado, una migración que sale mal—; los 90 cubren el que **no** se ve
enseguida: una corrupción que aparece cuando alguien busca una factura de hace
dos meses. Entre que una copia desaparece del servidor y desaparece de fuera hay
76 noches de margen para darse cuenta. El precio no decide el plazo (~143 MB por
noche × 90 ≈ 13 GB, céntimos al mes en B2): lo decide cuánto tardamos en
enterarnos de que algo faltaba.

**Esa caducidad está escrita para que en la duda NO borre.** Cinco frenos,
cualquiera de ellos la para en seco, y los tres últimos mandan correo:

1. algún ajuste que no sea un número entero;
2. la subida de esa noche falló (no se tira lo viejo si no ha entrado nada nuevo);
3. el destino no contesta, o contesta que está vacío;
4. el borrado dejaría menos de `MINIMO_REMOTO` (4) ficheros;
5. se llevaría de una noche más del `MAXIMO_BORRADO_PCT` (50 %) de lo que hay allí.

Solo mira `auto-*.sql.gz` y `uploads-*.tar.gz` de la **raíz** del destino: nunca
las copias manuales `pre-deploy-*`, nunca lo que otro haya dejado ahí.

**En la rama rsync no se caduca nada.** Este script no manda órdenes de borrado
a otra máquina. Que el otro servidor tenga su propia limpieza, o su disco se
llenará; el parte semanal lo dice con esas palabras.

## Lo que se midió, y por qué hay dos frenos y no uno

El freno del **mínimo**, solo, es casi inalcanzable: si se caduca a R días y hay
una copia por noche, siempre sobreviven 2·R ficheros, así que un mínimo de 4
únicamente salta con R = 0 o R = 1.

En el ensayo se vio lo que eso significa. Con `sync`, un destino que tenía 11
ficheros se quedaba en 2 —incluida una copia manual de hace 300 días—; con
`copy`, ninguno. Y con 90 noches fuera (180 ficheros) y un
`RETENCION_REMOTA_DIAS` puesto a 3 por un dedo gordo, se borraban **176 de 180**
sin una queja, y el registro decía «OK copia externa».

De ahí el freno por **proporción**. En régimen normal caen 2 de ~180 cada noche
(~1 %); si de golpe se fuera más de la mitad, no es la caducidad trabajando: es
un ajuste mal puesto, un reloj loco o el destino equivocado. Se para y se
pregunta.

Bajar `RETENCION_REMOTA_DIAS` a propósito choca con ese freno, y es intencionado:
la nota de `crm-backup.service` explica cómo hacerlo a sabiendas (subir
`MAXIMO_BORRADO_PCT=100` una noche, dejar que corra y volver a quitarlo).
