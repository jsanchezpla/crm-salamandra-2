/**
 * import-harbiz-fotos.js — las fotos de las recetas de Harbiz.
 *
 * ⚠️ SIMULA POR DEFECTO. Sin `--confirm` no descarga ni escribe nada.
 *
 * Va DESPUÉS de `import-harbiz-recetas.js`: necesita las recetas ya creadas
 * para colgarles la foto.
 *
 * ── Por qué es su propio script ────────────────────────────────────────────
 *
 * Son 1.081 descargas y unos 650 MB. Mezclarlo con el importador de recetas
 * significaría que un fallo de red a mitad dejaría las recetas a medias; así
 * cada cosa se puede repetir por su cuenta. Es idempotente: salta las recetas
 * que ya tienen foto, así que si se corta se relanza y sigue por donde iba.
 *
 * ── Qué tamaño se baja ─────────────────────────────────────────────────────
 *
 * Harbiz sirve `thumbnail` (250×283), `midSize` (512×579) y `original`
 * (537×607). Se baja **original**: tiene más resolución que midSize y encima
 * ocupa menos (606 KB frente a 792), porque el midSize es un PNG reescalado.
 *
 * Se guardan tal cual, en PNG. Recomprimir a JPEG las dejaría en la décima
 * parte, pero eso pide una librería nativa (`sharp`) y con ella cambia el
 * Dockerfile: no es algo que se meta con prisa. Queda apuntado.
 *
 * Las imágenes de Harbiz son PÚBLICAS (responden sin sesión), así que aquí no
 * viaja ninguna credencial.
 *
 * Uso:
 *   node --env-file=.env.local scripts/import-harbiz-fotos.js
 *   docker exec crm-salamandra-app-1 node scripts/import-harbiz-fotos.js --confirm
 */

import { readFileSync } from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { getTenantDb } from "../../lib/db/tenantDb.js";
import { saveRecipePhoto, validatePhotoMagicBytes, MAX_PHOTO_SIZE_BYTES } from "../../lib/nutricion/recipePhotoStorage.js";

const args = process.argv.slice(2);
const CONFIRM = args.includes("--confirm");
const SLUG = args.includes("--tenant") ? args[args.indexOf("--tenant") + 1] : "nutri_laura";
const DATOS = (args.includes("--datos") ? args[args.indexOf("--datos") + 1] : null) || "C:/Claude Code/migracion-harbiz";
const TAMANO = args.includes("--tamano") ? args[args.indexOf("--tamano") + 1] : "original";

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

const urlDe = (id) => `https://app.harbiz.io/cdn/storage/Images/${id}/${TAMANO}/${id}`;

/**
 * Qué es la imagen DE VERDAD, mirando sus primeros bytes.
 *
 * No se puede confiar en el `content-type` de Harbiz: sirve WEBP declarándolo
 * como `image/jpeg`. Se descubrió porque nuestro validador —que compara los
 * bytes con el tipo declarado— rechazó una foto, y tenía razón. La respuesta no
 * es relajar el validador, es averiguar el tipo bien antes de preguntarle.
 */
function tipoReal(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf.slice(0, 4).toString("latin1") === "RIFF" && buf.slice(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

async function main() {
  console.log(`\n${"═".repeat(64)}`);
  console.log(` FOTOS DE LAS RECETAS DE HARBIZ → tenant "${SLUG}"`);
  console.log(`${CONFIRM ? " ⚠️  MODO REAL: descarga y guarda" : " · SIMULACIÓN: no se descarga nada"}`);
  console.log(`${"═".repeat(64)}\n`);

  const recetas = JSON.parse(readFileSync(path.join(DATOS, "harbiz-recetas.json"), "utf8"));
  const conFoto = recetas.filter((r) => r.imagen);

  const { models: m } = getTenantDb(SLUG);
  const enCrm = await m.Recipe.findAll({ attributes: ["id", "name", "photoPath", "externalId"] });
  // Por el ID de Harbiz, NUNCA por el nombre: hay 59 nombres repetidos que son
  // recetas distintas, y cruzar por nombre le colgaría la foto de una a la otra
  // dejando a la segunda sin ninguna. Es el mismo fallo que ya se coló una vez
  // en el importador de recetas.
  const porId = new Map();
  for (const r of enCrm) if (r.externalId) porId.set(r.externalId, r);

  const trabajo = [];
  let sinReceta = 0, yaTienen = 0;
  for (const r of conFoto) {
    const receta = porId.get(r.id);
    if (!receta) { sinReceta++; continue; }
    if (receta.photoPath) { yaTienen++; continue; }
    trabajo.push({ receta, imagen: r.imagen, nombre: r.nombre });
  }

  console.log(`  Recetas con foto en Harbiz   ${String(conFoto.length).padStart(5)}`);
  console.log(`  …ya tienen foto aquí         ${String(yaTienen).padStart(5)}   se saltan`);
  console.log(`  …no encuentro la receta      ${String(sinReceta).padStart(5)}`);
  console.log(`  A descargar                  ${String(trabajo.length).padStart(5)}   tamaño «${TAMANO}»`);
  console.log(`  Espacio estimado             ${String(Math.round(trabajo.length * 0.6)).padStart(5)} MB aprox.\n`);

  if (!CONFIRM) {
    console.log(`${"═".repeat(64)}`);
    console.log(" SIMULACIÓN: no se ha descargado nada. Con --confirm se ejecuta.");
    console.log(`${"═".repeat(64)}\n`);
    process.exit(0);
  }

  console.log("⚠️  Descargando…\n");
  let ok = 0, fallos = 0, bytes = 0;
  const errores = [];

  for (const [i, t] of trabajo.entries()) {
    try {
      const res = await fetch(urlDe(t.imagen), { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_PHOTO_SIZE_BYTES) throw new Error(`pesa ${Math.round(buf.length / 1024)} KB, más del máximo`);

      // El tipo sale de los BYTES, no de la cabecera (Harbiz sirve WEBP
      // diciendo que es JPEG). Y aun así se pasa por el mismo validador que la
      // subida manual desde la ficha: aquí se averigua el tipo, no se confía.
      const mime = tipoReal(buf);
      if (!mime) throw new Error("no es JPEG, PNG ni WEBP");
      if (!validatePhotoMagicBytes(buf, mime)) throw new Error(`no parece ${mime} de verdad`);

      const photoId = crypto.randomUUID();
      const ruta = await saveRecipePhoto(SLUG, t.receta.id, photoId, buf, mime);
      await t.receta.update({ photoPath: ruta });
      ok++; bytes += buf.length;
    } catch (e) {
      fallos++;
      if (errores.length < 15) errores.push(`${t.nombre}: ${e.message}`);
    }
    if ((i + 1) % 50 === 0) {
      console.log(`  ${i + 1}/${trabajo.length} · ${ok} guardadas · ${fallos} fallos · ${Math.round(bytes / 1024 / 1024)} MB`);
    }
    // Cortesía con el servidor de Harbiz: no es nuestro.
    await dormir(120);
  }

  console.log("\n── ESCRITO ───────────────────────────────────────────────────\n");
  console.log(`  Fotos guardadas  ${String(ok).padStart(5)}   ${Math.round(bytes / 1024 / 1024)} MB`);
  console.log(`  Fallos           ${String(fallos).padStart(5)}${fallos ? "   (relanza el script y lo reintenta)" : ""}`);
  for (const e of errores) console.log(`      · ${e}`);
  console.log("");
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ ${err?.stack ?? err}\n`);
  process.exit(1);
});
