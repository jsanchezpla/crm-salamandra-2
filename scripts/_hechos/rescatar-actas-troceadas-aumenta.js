/**
 * rescatar-actas-troceadas-aumenta.js — devolver a su acta el correo que el
 * volcado de Organízate partió en pedazos (18/09/2026, AV-0102).
 *
 * ── QUÉ PASÓ ────────────────────────────────────────────────────────────────
 * Al traer las actas de coordinación en agosto, el programa sacaba de cada una
 * «con quién se había hablado». En las actas que eran un correo seguido no
 * encontró nombres: fue troceando el texto y metió cada pedazo como si fuera
 * una persona. Por eso la agenda de contactos de esos pacientes tiene frases
 * como «sacó un cero» o «tenia carita de querer llorar» — la queja de Silvia.
 *
 * Al mirarlo salieron 92 contactos así, colgando de 19 actas. Y ahí está el
 * matiz que decide qué hacer con ellos:
 *
 *   · **16 actas conservan su correo entero** en «temas». Sus trozos son
 *     pedazos duplicados de un texto que ya está escrito: no aportan nada.
 *   · **3 actas están VACÍAS** —sin temas, sin acuerdos, sin próximos pasos— y
 *     esos 39 trozos son LO ÚNICO que queda de aquella conversación con la
 *     familia. Borrarlos sin más sería perderla.
 *
 * ── QUÉ HACE ────────────────────────────────────────────────────────────────
 * Solo lo segundo: en las actas vacías, escribe los trozos EN SU ORDEN dentro
 * de «temas», encabezados por una línea que avisa de que el texto llegó
 * troceado. Se pone el aviso a propósito: sin él, alguien lo leería dentro de
 * seis meses como si fuera una redacción del centro, y no lo es.
 *
 * El orden sale de `participants`, que conserva el del volcado; no se reordena
 * ni se corrige la puntuación, porque eso sería inventar texto clínico.
 *
 * NO borra ningún contacto: eso lo hace `borrar-contactos-troceados-aumenta.js`
 * después, y a propósito en dos pasos — primero se salva, luego se limpia.
 *
 * ── CÓMO SE LANZA ───────────────────────────────────────────────────────────
 *   docker exec -i crm-salamandra-app-1 node scripts/_hechos/rescatar-actas-troceadas-aumenta.js \
 *     --datos /tmp/actas-a-reconstruir.json            # ensayo
 *   … --confirmar                                       # de verdad
 */

import { readFileSync } from "node:fs";
import { getTenantDb } from "../../lib/db/tenantDb.js";

const SLUG = "aumenta";
const args = process.argv.slice(2);
const CONFIRMAR = args.includes("--confirmar");
const RUTA = (() => {
  const i = args.indexOf("--datos");
  return i >= 0 ? args[i + 1] : null;
})();

/** La línea que encabeza lo rescatado. Dice de dónde sale y por qué se lee mal. */
const CABECERA =
  "[Recuperado el 18/09/2026] Este texto llegó troceado en el volcado de " +
  "Organízate y se ha devuelto aquí en el orden en que estaba. Se lee a saltos " +
  "porque así llegó; no se ha corregido nada para no inventar lo que no consta.";

const vacio = (v) => v == null || (Array.isArray(v) && v.length === 0) || (typeof v === "string" && !v.trim());

async function main() {
  if (!RUTA) {
    console.error("Falta --datos <fichero.json>");
    process.exit(1);
  }
  const actas = JSON.parse(readFileSync(RUTA, "utf8"));
  const { models } = getTenantDb(SLUG);
  const { Coordination } = models;

  let escritas = 0, saltadas = 0;
  for (const a of actas) {
    if (a.tieneTexto) { saltadas += 1; continue; }

    const fila = await Coordination.findByPk(a.actaId);
    if (!fila) { console.log(`  · ${a.actaId.slice(0, 8)} ya no existe`); continue; }

    // Que siga vacía. Si alguien la ha escrito mientras, manda lo suyo.
    if (!vacio(fila.topics) || !vacio(fila.agreements) || !vacio(fila.nextActions)) {
      console.log(`  · ${a.actaId.slice(0, 8)} ya tiene texto escrito, se salta`);
      saltadas += 1;
      continue;
    }

    const trozos = a.trozos.map((t) => t.texto).filter(Boolean);
    if (!trozos.length) { saltadas += 1; continue; }

    const temas = [CABECERA, ...trozos];
    console.log(`  ${CONFIRMAR ? "✓" : "·"} ${a.actaId.slice(0, 8)} ${a.fecha.slice(0, 10)} — ${trozos.length} trozos a «temas»`);
    for (const t of trozos) console.log(`        · ${t}`);
    if (CONFIRMAR) await fila.update({ topics: temas });
    escritas += 1;
  }

  console.log("");
  console.log(`  actas en el fichero:  ${actas.length}`);
  console.log(`  ${CONFIRMAR ? "escritas" : "se escribirían"}: ${escritas}`);
  console.log(`  saltadas (ya tenían texto): ${saltadas}`);
  if (!CONFIRMAR) console.log("\n  ENSAYO: no se ha escrito nada. Con --confirmar se aplica.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
