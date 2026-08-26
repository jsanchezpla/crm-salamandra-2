/**
 * importar-onedrive-aumenta.js — el archivo de OneDrive entra en la ficha de
 * cada paciente (26/08/2026).
 *
 * ⚠️ SIMULA POR DEFECTO. Sin `--confirm` no escribe nada.
 *
 * Entrada: un manifiesto (construido en el portátil desde el volcado, FUERA
 * del repo) y los PDF ya subidos a `uploads/importacion-onedrive/` — que está
 * dentro del volumen, así que moverlos a su sitio final es instantáneo.
 *
 * Por cada fichero: paciente por nombre (el mismo cruce que usó la agenda),
 * el PDF se MUEVE a documents/{slug}/shared/{uuid}.pdf y nace su fila con
 * `documentDate` = la fecha real del documento en OneDrive — el informe de
 * junio de 2024 se queda en junio de 2024, no en «hoy». `clientVisible:false`:
 * qué ve cada familia lo decide el centro después, no una importación.
 *
 * También cuelga en cada paciente el enlace a su carpeta de OneDrive
 * (`externalLinks`): las fotos y vídeos se quedan allí a propósito.
 *
 * Idempotente: un fichero con el mismo nombre, tamaño y paciente no se repite;
 * los enlaces no se duplican por URL.
 *
 * Uso (VPS):
 *   docker exec crm-salamandra-app-1 node scripts/importar-onedrive-aumenta.js --datos /app/uploads/importacion-onedrive            → simulación
 *   docker exec crm-salamandra-app-1 node scripts/importar-onedrive-aumenta.js --datos /app/uploads/importacion-onedrive --confirm  → escribe
 */

import { readFileSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getTenantDb } from "../lib/db/tenantDb.js";
import { getUploadsRoot } from "../lib/documents/documentStorage.js";

const args = process.argv.slice(2);
const CONFIRM = args.includes("--confirm");
const SLUG = args.includes("--tenant") ? args[args.indexOf("--tenant") + 1] : "aumenta";
const DATOS = args.includes("--datos") ? args[args.indexOf("--datos") + 1] : null;
if (!DATOS) { console.error("Falta --datos <carpeta con manifiesto-onedrive.json y los PDF>"); process.exit(1); }

const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();

async function main() {
  console.log(`\n${"═".repeat(62)}`);
  console.log(` ARCHIVO DE ONEDRIVE → fichas de pacientes de "${SLUG}"`);
  console.log(`${CONFIRM ? " ⚠️  MODO REAL: va a escribir" : " · SIMULACIÓN: no se escribe nada"}`);
  console.log(`${"═".repeat(62)}\n`);

  const man = JSON.parse(readFileSync(path.join(DATOS, "manifiesto-onedrive.json"), "utf8"));
  console.log(`Manifiesto: ${man.documentos.length} documentos · enlaces para ${Object.keys(man.enlaces).length} pacientes\n`);

  const { models: m } = getTenantDb(SLUG);
  const pacientes = await m.Patient.findAll({ attributes: ["id", "firstName", "lastName", "clientId", "externalLinks"] });
  const porNombre = new Map();
  for (const p of pacientes) {
    const k = norm(`${p.firstName} ${p.lastName}`);
    if (!porNombre.has(k)) porNombre.set(k, p);
  }

  const destinoDir = path.join(getUploadsRoot(), "documents", SLUG, "shared");
  if (CONFIRM) mkdirSync(destinoDir, { recursive: true });

  const n = { creados: 0, yaEstaban: 0, sinPaciente: 0, sinFichero: 0 };
  let bytes = 0;
  const sinPaciente = new Set();

  for (const d of man.documentos) {
    const p = porNombre.get(norm(d.paciente));
    if (!p) { n.sinPaciente++; sinPaciente.add(d.paciente); continue; }
    const origen = path.join(DATOS, d.rel);
    if (!existsSync(origen)) { n.sinFichero++; continue; }
    const fileName = path.basename(d.rel);
    const fileSize = statSync(origen).size;

    const ya = await m.Document.findOne({ where: { patientId: p.id, fileName, fileSize }, attributes: ["id"] });
    if (ya) { n.yaEstaban++; continue; }

    n.creados++; bytes += fileSize;
    if (!CONFIRM) continue;

    const id = randomUUID();
    const storagePath = `documents/${SLUG}/shared/${id}.pdf`;
    renameSync(origen, path.join(getUploadsRoot(), storagePath));
    await m.Document.create({
      id,
      folderId: null,
      visibility: "shared",
      name: fileName.replace(/\.pdf$/i, ""),
      fileName,
      storagePath,
      fileSize,
      mimeType: "application/pdf",
      patientId: p.id,
      clientId: p.clientId ?? null,
      source: "paciente",
      clientVisible: false,
      documentDate: d.fecha ? String(d.fecha).slice(0, 10) : null,
    });
  }

  // Enlaces a OneDrive, sin duplicar por URL.
  let enlazados = 0;
  for (const [nombre, enlaces] of Object.entries(man.enlaces)) {
    const p = porNombre.get(norm(nombre));
    if (!p || !Array.isArray(enlaces) || !enlaces.length) continue;
    const actuales = Array.isArray(p.externalLinks) ? p.externalLinks : [];
    const urls = new Set(actuales.map((e) => e.url));
    const nuevos = enlaces.filter((e) => e?.url && !urls.has(e.url));
    if (!nuevos.length) continue;
    enlazados++;
    if (CONFIRM) await p.update({ externalLinks: [...actuales, ...nuevos] });
  }

  console.log(`  Documentos ${CONFIRM ? "creados" : "que se crearían"}  ${String(n.creados).padStart(6)}   (${(bytes / 1e9).toFixed(2)} GB)`);
  console.log(`  Ya estaban               ${String(n.yaEstaban).padStart(6)}`);
  console.log(`  Sin paciente que cruce   ${String(n.sinPaciente).padStart(6)}   (${sinPaciente.size} nombres distintos)`);
  console.log(`  Sin fichero en disco     ${String(n.sinFichero).padStart(6)}`);
  console.log(`  Pacientes con enlace a OneDrive ${CONFIRM ? "puestos" : "previstos"}: ${enlazados}\n`);
  if (!CONFIRM) console.log(" SIMULACIÓN: nada escrito. Con --confirm se ejecuta.\n");
  process.exit(0);
}

main().catch((err) => { process.stderr.write(`\n✗ ${err?.stack ?? err}\n`); process.exit(1); });
