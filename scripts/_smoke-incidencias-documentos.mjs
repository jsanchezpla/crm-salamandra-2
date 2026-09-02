// @prueba ligera
/**
 * _smoke-incidencias-documentos.mjs — documentos adjuntos a incidencias y el
 * salto Productividad → perfil de desempeño (26/08/2026, Aumenta).
 *
 *   node scripts/_smoke-incidencias-documentos.mjs
 *
 * Sin base de datos, sin servidor, sin `.env`. Solo lee ficheros.
 *
 * ── DE QUÉ FALLO REAL NACE CADA BLOQUE ─────────────────────────────────────
 *
 * 1. 42703 EN TODO EL ARCHIVO. El modelo Document declara `incidenciaId` para
 *    TODOS los tenants: si la migración no existe o nadie la ejecuta (no está
 *    en CORE), cualquier lectura de documentos revienta en el tenant que se
 *    quedó sin la columna. Es el agujero del 2026-07-21, otra vez.
 *
 * 2. DOCUMENTO HUÉRFANO EN LA FICHA EQUIVOCADA. El adjunto hereda el paciente
 *    de la incidencia, y si el paciente se corrige después, los documentos
 *    tienen que moverse con él. Sin el re-enlace del PATCH, el justificante se
 *    queda colgado en la ficha del paciente equivocado sin que nadie lo vea.
 *
 * 3. EN LA FICHA SE VE PERO NO SE DESCARGA. La ficha de paciente filtra por
 *    `source`: si el GET lista `incidencia` pero el download no lo acepta, el
 *    documento sale en pantalla y el enlace da 404. Y el DELETE de la ficha
 *    debe seguir SIN aceptar `incidencia`: un adjunto de incidencia se borra
 *    desde su incidencia, no desde la ficha.
 *
 * 4. EL ENLACE QUE NO LLEVABA A NADIE. Dirección enlazaba al perfil individual
 *    con `?therapistId=` desde julio, pero mi-desempeno no leía el parámetro y
 *    abría siempre el desempeño del usuario logueado. Al añadir el mismo salto
 *    desde Productividad se arregló la página de destino; esto fija que nadie
 *    vuelva a dejar el enlace mudo.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { CORE } from "./_module-migrations.js";

const root = process.cwd();
const leer = (p) => readFileSync(path.join(root, p), "utf8");

let fallos = 0;
const h = (t) => process.stdout.write(`\n▶ ${t}\n`);
const check = (nombre, ok, detalle = "") => {
  process.stdout.write(`  ${ok ? "✓" : "✗"} ${nombre}${ok || !detalle ? "" : ` — ${detalle}`}\n`);
  if (!ok) fallos += 1;
};

// ── 1. La columna existe para todos: modelo + migración + CORE ──────────────
h("Columna documents.incidencia_id");

const modelo = leer("models/tenant/Document.model.js");
check(
  "el modelo Document declara incidenciaId → incidencia_id",
  /incidenciaId:\s*\{[^}]*field:\s*"incidencia_id"/s.test(modelo)
);

const migracion = leer("scripts/migrate-documents-incidencia-link.js");
check(
  "la migración añade la columna con IF NOT EXISTS",
  migracion.includes('ADD COLUMN IF NOT EXISTS incidencia_id UUID')
);
check(
  "la FK es ON DELETE SET NULL (borrar la incidencia no borra el documento)",
  /REFERENCES "\$\{schema\}"\."incidencias"\(id\) ON DELETE SET NULL/.test(migracion)
);
check(
  "y está declarada en CORE (si no, ensure-tenant-schema no la correría nunca)",
  CORE.includes("migrate-documents-incidencia-link")
);

// ── 2. Endpoints de documentos de una incidencia ────────────────────────────
h("Endpoints /api/clinica/incidencias/[id]/documents");

const rutaDocs = leer("app/api/clinica/incidencias/[id]/documents/route.js");
const rutaDoc = leer("app/api/clinica/incidencias/[id]/documents/[docId]/route.js");
const rutaDescarga = leer("app/api/clinica/incidencias/[id]/documents/[docId]/download/route.js");

for (const [nombre, src] of [["listar/subir", rutaDocs], ["borrar", rutaDoc], ["descargar", rutaDescarga]]) {
  check(`${nombre}: gate de clinica/pacientes`, src.includes('ctx.hasModule("clinica") || ctx.hasModule("pacientes")'));
  check(`${nombre}: gate de team_avanzado`, src.includes('ctx.hasModule("team_avanzado")'));
}
check(
  "al subir, el documento hereda el paciente de la incidencia",
  rutaDocs.includes("patientId: incidencia.patientId") && rutaDocs.includes("clientId: incidencia.clientId")
);
check('al subir, source="incidencia" y visibilidad shared', rutaDocs.includes('source: "incidencia"') && rutaDocs.includes('visibility: "shared"'));
check(
  "borrar y descargar quedan aislados a los documentos de ESA incidencia",
  rutaDoc.includes('incidenciaId: id, source: "incidencia"') && rutaDescarga.includes('incidenciaId: id, source: "incidencia"')
);

const patchIncidencia = leer("app/api/clinica/incidencias/[id]/route.js");
check(
  "el PATCH re-enlaza los documentos si cambia el paciente de la incidencia",
  /"patientId" in changes[\s\S]{0,200}Document\.update\(/.test(patchIncidencia)
);

// ── 3. La ficha de paciente: listar y descargar sí, borrar no ───────────────
h("Ficha de paciente");

const fichaLista = leer("app/api/pacientes/[id]/documents/route.js");
const fichaDescarga = leer("app/api/pacientes/[id]/documents/[docId]/download/route.js");
const fichaBorrado = leer("app/api/pacientes/[id]/documents/[docId]/route.js");

// Desde el 29/08/2026 son TRES: se sumó `sesion`, el registro de sesión que se
// envía al área privada de la familia. Se ve y se descarga desde la ficha, pero
// se retira desde su sesión (por eso no entra en el DELETE de aquí abajo).
check("el GET de la ficha lista source paciente, incidencia, sesion Y sesion_preparacion (02/09/2026)", fichaLista.includes('["paciente", "incidencia", "sesion", "sesion_preparacion"]'));
check("la descarga desde la ficha acepta los cuatro", fichaDescarga.includes('["paciente", "incidencia", "sesion", "sesion_preparacion"]'));
check(
  "el DELETE de la ficha sigue SIN aceptar incidencia (se borra desde la incidencia)",
  fichaBorrado.includes('source: "paciente"') && !fichaBorrado.includes("incidencia")
);

const fichaUI = leer("components/clinica/PatientDocumentsSection.jsx");
check(
  "la ficha etiqueta el adjunto de incidencia y el registro enviado, y solo deja borrar los suyos",
  fichaUI.includes("De incidencia") && fichaUI.includes("Enviado a la familia") && fichaUI.includes('d.source === "paciente"')
);

// ── 4. Productividad → perfil de desempeño ──────────────────────────────────
h("Salto Productividad → perfil");

const productividad = leer("app/(dashboard)/equipo/productividad/page.jsx");
const miDesempeno = leer("app/(dashboard)/equipo/mi-desempeno/page.jsx");
const direccion = leer("app/(dashboard)/equipo/direccion/page.jsx");

check(
  "cada persona de Productividad enlaza a su perfil",
  productividad.includes("/equipo/mi-desempeno?therapistId=")
);
check(
  "Dirección conserva su enlace «Ver» al mismo destino",
  direccion.includes("/equipo/mi-desempeno?therapistId=")
);
check(
  "y mi-desempeno LEE el parámetro (antes el enlace abría siempre al logueado)",
  miDesempeno.includes("useSearchParams") && /useState\(sp\.get\("therapistId"\)/.test(miDesempeno)
);

process.stdout.write(fallos ? `\n✗ ${fallos} fallo(s)\n\n` : "\n✓ Todo correcto\n\n");
process.exit(fallos ? 1 : 0);
