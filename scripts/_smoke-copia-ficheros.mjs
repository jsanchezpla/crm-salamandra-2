// @prueba ligera
/**
 * _smoke-copia-ficheros.mjs — los frenos de `scripts/backup-db.sh`.
 *
 * Esto es texto de verdad (un script de bash), así que aquí sí toca mirar el
 * fuente: no hay función que llamar. Lo que se vigila no es el estilo, son tres
 * invariantes que si alguien rompe sin darse cuenta destruyen copias, y que NO
 * se ven al leer el diff:
 *
 *   1. La rotación borra por patrón de nombre. Desde el 28/08/2026 el espejo de
 *      los ficheros de los clientes vive DENTRO de backups/, así que un `find`
 *      sin `-maxdepth 1` recorre 7.700 documentos de pacientes. Un contrato
 *      subido por alguien y llamado `uploads-2019.tar.gz` encaja en el patrón y
 *      se borra de la copia de seguridad, en silencio. Está probado en el banco
 *      de pruebas con dos señuelos, pero un `-maxdepth` se quita sin querer.
 *
 *   2. El espejo se hace con `--backup-dir`. Sin eso, `rclone sync` es un espejo
 *      a secas: un borrado en uploads/ se propaga esa misma noche y no queda de
 *      dónde sacarlo. La copia seguiría diciendo «✅ Copia completada».
 *
 *   3. La caducidad de las noches guarda un mínimo. Si el servidor ha estado
 *      parado, TODAS son viejas: sin mínimo, una sola pasada las borra todas.
 *
 * Y una cuarta, de coherencia: que la cabecera siga explicando cómo se
 * restaura un fichero suelto, que es para lo que se usa esto de verdad.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const RUTA = new URL("./backup-db.sh", import.meta.url);
const fuente = readFileSync(RUTA, "utf8");

/*
 * Las órdenes, UNA POR LÍNEA. En bash una orden larga se parte con `\` al final,
 * y mirar el fuente línea a línea es cómo se cuela un fallo: el `find` que borra
 * ocupa dos renglones y `-delete` cae en el segundo, así que una comprobación
 * ingenua lo daba por bueno sin `-maxdepth 1`. (Es el mismo error que se cometió
 * el 28/08/2026 buscando `UPDATE … SET` con grep en las migraciones.)
 */
const ordenes = fuente
  .replace(/\\\r?\n\s*/g, " ")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"));

/** Las órdenes con un `find` sobre el directorio de copias. */
function findsSobreBackups() {
  return ordenes.filter((l) => l.includes('find "$DIR_BACKUPS"'));
}

test("todo find sobre backups/ se queda en la raíz: dentro está el espejo", () => {
  const lineas = findsSobreBackups();
  assert.ok(lineas.length > 0, "no hay ningún find sobre $DIR_BACKUPS; ¿se renombró la variable?");
  for (const linea of lineas) {
    assert.ok(
      linea.includes("-maxdepth 1"),
      `este find recorrería los ficheros de los clientes:\n    ${linea}\n` +
        "  Añade -maxdepth 1: las copias están en la raíz, y dentro hay 7.700 documentos."
    );
  }
});

/*
 * Desde el 03/09/2026 la rotación local ya no borra con `find -delete` por
 * edad: hace una LISTA (`find … -printf '%f
'`) de cada clase de copia, se
 * queda con las que caben en $DIAS_EN_SERVIDOR y borra el resto con `rm -f`
 * una a una. El invariante es el mismo —lo que decide qué se borra no puede
 * bajar de la raíz de backups/— pero ahora vive en esa lista, y un
 * `find -delete` sobre backups/ que vuelva a aparecer sería justo la
 * regresión que había que evitar.
 */
test("la rotación que BORRA no puede bajar del primer nivel", () => {
  const listas = ordenes.filter((l) => l.startsWith("lista=$(find \"$DIR_BACKUPS\""));
  assert.equal(listas.length, 1, "se esperaba UNA lista de copias a rotar (`lista=$(find \"$DIR_BACKUPS\" …)`)");
  assert.ok(listas[0].includes("-maxdepth 1"), "la lista que alimenta el borrado no lleva -maxdepth 1");
  assert.ok(listas[0].includes("-type f"), "la lista tiene que ser de ficheros: un directorio con nombre de copia no se rota");
  assert.ok(
    ordenes.some((l) => l.includes('rm -f "$DIR_BACKUPS/$fichero"')),
    "el borrado tiene que ser por nombre de fichero de esa lista, en la raíz de backups/"
  );
  assert.equal(
    ordenes.filter((l) => l.includes('find "$DIR_BACKUPS"') && l.includes("-delete")).length,
    0,
    "no puede haber un `find -delete` sobre backups/: dentro está el espejo de los clientes"
  );
});

test("el espejo aparta lo que pisa: rclone sync SIEMPRE con --backup-dir", () => {
  const syncs = ordenes.filter((l) => l.includes("rclone sync"));
  assert.equal(syncs.length, 1, "se esperaba un único `rclone sync` (el espejo local)");
  assert.ok(
    syncs[0].includes("--backup-dir"),
    "sin --backup-dir un borrado en uploads/ se propaga al espejo y no hay de dónde sacarlo"
  );
});

test("la copia externa NUNCA usa sync, y no se lleva el espejo", () => {
  assert.ok(
    !/rclone sync[^\n]*DESTINO_REMOTO/.test(fuente),
    "la copia externa tiene que ser `copy`: `sync` borraría fuera lo que falte aquí"
  );
  const copia = ordenes.find((l) => l.includes("rclone copy"));
  assert.ok(copia, "no se encuentra el `rclone copy` de la copia externa");
  assert.ok(copia.includes("uploads-espejo/**"), "el espejo (6,2 GB) no debe salir del servidor sin decidirlo");
});

test("la caducidad de las noches guarda un mínimo", () => {
  assert.ok(
    fuente.includes("MINIMO_DIAS_CAMBIOS"),
    "sin mínimo, un servidor parado un mes pierde TODAS las noches de una pasada"
  );
  assert.ok(
    /n_noches" -le "\$MINIMO_DIAS_CAMBIOS/.test(fuente),
    "el mínimo tiene que cortar ANTES de calcular qué se borra"
  );
});

test("solo se caducan directorios que se llamen como una noche", () => {
  assert.ok(
    fuente.includes("patron='[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9]'"),
    "el patrón AAAAMMDD-HHMM protege lo que alguien deje a mano en uploads-cambios/"
  );
});

test("el paquete entero es semanal, no diario", () => {
  assert.ok(
    fuente.includes('[ "$(date +%u)" = "$DIA_TAR_ENTERO" ]'),
    "el tar diario de 5,3 GB es justo lo que llenaba el disco (26/08/2026)"
  );
  assert.ok(
    fuente.includes('"$hay_tar" -eq 0'),
    "un servidor recién instalado no puede quedarse hasta el domingo sin paquete"
  );
});

test("la cabecera explica cómo se recupera UN fichero, que es el caso real", () => {
  const cabecera = fuente.slice(0, fuente.indexOf("set -euo pipefail"));
  assert.ok(cabecera.includes("uploads-cambios"), "la cabecera no nombra dónde está lo borrado");
  assert.ok(cabecera.includes("uploads-espejo"), "la cabecera no nombra el espejo");
  assert.ok(
    cabecera.includes("rclone copy backups/uploads-espejo"),
    "restaurar desde el espejo tiene que ser `copy`, no `sync`: `sync` borraría lo que haya de más"
  );
});

test("el aviso de disco no puede matar la copia", () => {
  const fn = fuente.slice(
    fuente.indexOf("avisar_si_falta_disco() {"),
    fuente.indexOf("# El parte de los lunes")
  );
  assert.ok(fn.length > 0, "no se encuentra avisar_si_falta_disco()");
  assert.ok(
    fn.includes("case") && fn.includes("*[!0-9]*"),
    "un ajuste con basura dentro reventaría el script entero por el `set -e`"
  );
  assert.ok(fn.includes("|| true"), "el correo es best-effort: no puede tumbar la copia");
});
