/**
 * lib/tablero/copiar.js — la tarea entera en texto, lista para pegar en un chat.
 *
 * (Fichero nuevo en /lib, regla #2: hasta el 03/09/2026 esto era `comoTexto()`
 * dentro de `app/admin/tablero/page.jsx`. Sale de la pantalla para poder
 * fijarlo con una prueba —`scripts/_smoke-tablero-copiar.mjs`— el día que
 * empieza a decir cosas que importan: qué capturas tiene la tarea y cómo se
 * bajan.)
 *
 * ── POR QUÉ EL BOTÓN «COPIAR» EXISTE ────────────────────────────────────────
 * La pantalla parte la tarea en trozos —el título arriba, el cliente en una
 * etiqueta, el cuerpo dentro del desplegable, la solución más abajo— y
 * seleccionarlos a mano es justo lo que el botón viene a evitar. El orden es el
 * de siempre: qué pasa, de quién es, el detalle, y lo que ya hemos pensado.
 * Sin markdown: se pega en un chat, no en un fichero.
 *
 * ── LAS CAPTURAS NO VIAJAN EN EL PORTAPAPELES, PERO SE DICEN (03/09/2026) ──
 * Rodrigo: «cuando copio del Registro la tarea a Claude no me adjunta la
 * captura. Esto tiene sentido, pero hay que meter algún tipo de indicador para
 * que mire la captura de dentro de Registro y lo haga bien.» El portapapeles
 * lleva texto; una imagen no cabe y, aunque cupiera, no debe (§4.7 de
 * `docs/como-apuntar-en-el-tablero.md`: pueden llevar datos de un paciente y
 * no se pegan en un chat). Lo que sí cabe es decir CUÁNTAS hay, CÓMO se llaman
 * y CÓMO se bajan desde el repo: `node scripts/registro.mjs capturas <ficha>`
 * las deja en `docs/registro/capturas/<ficha>/` (carpeta fuera de git) y desde
 * ahí se abren como cualquier imagen. La ficha va en el texto porque es lo
 * único de la tarea que no cambia.
 */

/** `{ nombre, bytes }` → «pantalla.png (0,4 MB)». */
function describir(c) {
  const mb = Number(c?.bytes) > 0 ? ` (${(c.bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB)` : "";
  return `${c?.nombre || "captura"}${mb}`;
}

/**
 * El texto que se copia. `t` es la tarea tal y como la sirve
 * `GET /api/admin/tablero` (`titulo`, `quien`, `cuerpo`, `solucion`, `id`,
 * `capturas`).
 */
export function tareaComoTexto(t) {
  const trozos = [t.titulo];
  if (t.quien) trozos.push(`Cliente: ${t.quien}`);
  if (t.cuerpo?.trim()) trozos.push("", t.cuerpo.trim());
  if (t.solucion?.trim()) trozos.push("", "Solución propuesta:", t.solucion.trim());
  const capturas = Array.isArray(t.capturas) ? t.capturas : [];
  if (capturas.length) {
    trozos.push(
      "",
      capturas.length === 1
        ? "Esta tarea lleva 1 captura de pantalla en el Registro. Mírala antes de tocar nada:"
        : `Esta tarea lleva ${capturas.length} capturas de pantalla en el Registro. Míralas antes de tocar nada:`,
      ...capturas.map((c) => `  - ${describir(c)}`),
      t.id
        ? `Para bajarlas al repo: node scripts/registro.mjs capturas ${t.id}   (quedan en docs/registro/capturas/${t.id}/)`
        : "Para verlas: /admin/tablero, en la tarjeta de la tarea."
    );
  }
  return trozos.join("\n");
}
