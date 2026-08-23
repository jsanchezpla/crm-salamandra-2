// @prueba ligera — lee ficheros del repo y llama a funciones puras de /lib; sin base ni servidor.
/**
 * _smoke-piezas-ficha.mjs — quién ve qué en la ficha de cliente (18/08/2026).
 *
 *   node scripts/_smoke-piezas-ficha.mjs
 *
 * ── POR QUÉ EXISTE ──────────────────────────────────────────────────────────
 *
 * El 18/08/2026 los tres paneles de la ficha de nutri_laura (Historia clínica,
 * Documentos, Sesiones) pasaron de `modules/overrides/nutri-laura/` a
 * `components/clients/`, y la ficha por defecto los monta para quien diga
 * `lib/clients/piezasFicha.js`. La decisión de Jorge ese día fue clara:
 * **Aumenta no cambia**. Esta prueba es esa frase convertida en rojo/verde:
 * si alguien afloja una regla y la ficha de Aumenta gana una pestaña, esto lo
 * dice antes de subir.
 *
 * ── LO QUE FIJA ─────────────────────────────────────────────────────────────
 *
 *   · con la FORMA de Aumenta (clínica + archivo avanzado + citas) no se
 *     monta ninguno de los tres; con la de somos y la demo general, tampoco;
 *   · con la forma de una consulta de nutrición (la de Laura, la de
 *     demo_nutricion) se montan los tres y hablan de «paciente»;
 *   · con la de una consultora (clients + leads) se montan Notas y Documentos,
 *     no la lista de citas, y hablan de «cliente»;
 *   · los tres paneles están en `components/clients/` y ya NO en la carpeta de
 *     Laura; la ficha por defecto los importa; la de Laura los importa de la
 *     carpeta compartida y les pasa SUS textos (si no, la mudanza le cambia
 *     las palabras);
 *   · ningún panel compartido lleva «la paciente» / «el paciente» escrito en
 *     el JSX: esas palabras llegan por `textos`.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { piezasDeFicha, textosPiezas, fichaSegunModulos } from "../lib/clients/piezasFicha.js";
import { VOCABULARIO_PACIENTE, VOCABULARIO_CLIENTE } from "../lib/clients/vocabulario.js";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (rel) => readFileSync(join(RAIZ, rel), "utf8");

let fallos = 0;
let pasadas = 0;
function check(nombre, condicion, detalle = "") {
  if (condicion) {
    pasadas++;
    process.stdout.write(`  ✓ ${nombre}\n`);
  } else {
    fallos++;
    process.stdout.write(`  ✗ ${nombre}${detalle ? `\n      ${detalle}` : ""}\n`);
  }
}
const h = (t) => process.stdout.write(`\n▶ ${t}\n`);
const con = (...mods) => (k) => mods.includes(k);

process.stdout.write("\nPiezas de la ficha de cliente (Notas · Documentos · Citas)\n");

// ── 1. Las formas de cliente que hay en producción ─────────────────────────
// Copiadas de master.tenant_modules el 18/08/2026 (solo las que deciden aquí).

h("Aumenta no cambia (ni somos, ni la demo general: misma forma)");
const AUMENTA = con("clients", "leads", "nutricion", "pacientes", "clinica", "billing", "citas", "documents", "documents_avanzado", "clients_avanzado", "team");
const pA = piezasDeFicha(AUMENTA);
check("aumenta: sin Notas", pA.notas === false, JSON.stringify(pA));
check("aumenta: sin Documentos", pA.documentos === false, JSON.stringify(pA));
check("aumenta: sin la lista de citas", pA.sesiones === false, JSON.stringify(pA));
check("y sus palabras son las de «cliente»", textosPiezas(VOCABULARIO_CLIENTE).notas.pestana === "Notas");

h("La consulta de nutrición (Laura, demo_nutricion) los tiene los tres");
const LAURA = con("clients", "leads", "nutricion", "citas", "documents");
const pL = piezasDeFicha(LAURA);
check("nutrición: Historia clínica", pL.notas === true, JSON.stringify(pL));
check("nutrición: Documentos", pL.documentos === true, JSON.stringify(pL));
check("nutrición: lista de citas", pL.sesiones === true, JSON.stringify(pL));
const { textos: tL } = fichaSegunModulos(LAURA);
check("y la pestaña se llama «Historia clínica»", tL.notas.pestana === "Historia clínica", tL.notas.pestana);
check("y habla de «el paciente»", tL.documentos.queLoVea === "Que el paciente lo vea", tL.documentos.queLoVea);
check("y las citas son «Sesiones del paciente»", tL.sesiones.titulo === "Sesiones del paciente", tL.sesiones.titulo);

h("La consultora (clients + leads) tiene Notas y Documentos, no citas");
const CONSULTORA = con("clients", "leads");
const pC = piezasDeFicha(CONSULTORA);
check("consultora: Notas", pC.notas === true, JSON.stringify(pC));
check("consultora: Documentos", pC.documentos === true, JSON.stringify(pC));
check("consultora: sin lista de citas (no tiene Citas)", pC.sesiones === false, JSON.stringify(pC));
const { textos: tC } = fichaSegunModulos(CONSULTORA);
check("y la pestaña se llama «Notas»", tC.notas.pestana === "Notas", tC.notas.pestana);
check("y habla de «el cliente»", tC.documentos.queLoVea === "Que el cliente lo vea", tC.documentos.queLoVea);

h("Un centro clínico SIN archivo avanzado (demo_clinica) solo gana Documentos");
const CLINICA_BASICA = con("clients", "leads", "pacientes", "clinica", "billing", "citas", "documents", "clients_avanzado");
const pK = piezasDeFicha(CLINICA_BASICA);
check("clínica básica: sin Notas (tiene historia clínica en el módulo)", pK.notas === false, JSON.stringify(pK));
check("clínica básica: Documentos (no tiene el archivo)", pK.documentos === true, JSON.stringify(pK));
check("clínica básica: sin lista de citas", pK.sesiones === false, JSON.stringify(pK));

h("Sin módulos no se monta nada");
const nada = piezasDeFicha(() => false);
check("nada", !nada.notas && !nada.documentos && !nada.sesiones, JSON.stringify(nada));
check("textosPiezas() sin argumento habla de cliente", textosPiezas().notas.pestana === "Notas");
check("VOCABULARIO_PACIENTE da «Historia clínica»", textosPiezas(VOCABULARIO_PACIENTE).notas.pestana === "Historia clínica");

// ── 2. Los ficheros están donde deben ──────────────────────────────────────

h("Los tres paneles viven en components/clients y ya no en la carpeta de Laura");
const PANELES = ["ClientNotesPanel.jsx", "ClientAttachmentsPanel.jsx", "ClientBookingsPanel.jsx"];
for (const p of PANELES) {
  check(`components/clients/${p} existe`, existsSync(join(RAIZ, "components/clients", p)));
  check(`modules/overrides/nutri-laura/${p} ya no existe`, !existsSync(join(RAIZ, "modules/overrides/nutri-laura", p)));
}
check("_InteractionsLegacySection.jsx (código muerto) se fue", !existsSync(join(RAIZ, "modules/overrides/nutri-laura/_InteractionsLegacySection.jsx")));

h("La ficha por defecto los monta, gateados por `piezas`");
const base = leer("modules/default/ClientDetailModule.jsx");
for (const p of PANELES) {
  const nombre = p.replace(".jsx", "");
  check(`base importa ${nombre} de components/clients`, new RegExp(`import ${nombre} from "\\.\\./\\.\\./components/clients/${p}"`).test(base));
}
check("base: Notas solo con piezas.notas", /piezas\.notas && <ClientNotesPanel/.test(base));
check("base: Documentos solo con piezas.documentos", /piezas\.documentos && <ClientAttachmentsPanel/.test(base));
check("base: la lista de citas solo con piezas.sesiones", /piezas\.sesiones && \(\s*<ClientBookingsPanel/.test(base));
check("base: importa PIEZAS_NINGUNA (sin decisión, nada)", /PIEZAS_NINGUNA/.test(base));

h("La página decide con los módulos y se lo pasa a la ficha");
const pagina = leer("app/(dashboard)/clientes/[id]/page.jsx");
check("page.jsx importa fichaSegunModulos", /fichaSegunModulos/.test(pagina));
check("page.jsx pasa piezas={piezas}", /piezas=\{piezas\}/.test(pagina));
check("page.jsx pasa textos={textos}", /textos=\{textos\}/.test(pagina));

h("La ficha de Laura importa de la carpeta compartida y pasa SUS textos");
const laura = leer("modules/overrides/nutri-laura/ClientDetailModule.jsx");
for (const p of PANELES) {
  const nombre = p.replace(".jsx", "");
  check(`laura importa ${nombre} de components/clients`, new RegExp(`import ${nombre} from "\\.\\./\\.\\./\\.\\./components/clients/${p}"`).test(laura));
}
check("laura: <ClientNotesPanel … textos=", /<ClientNotesPanel[^>]*textos=\{TEXTOS_LAURA\.notas\}/.test(laura));
check("laura: <ClientAttachmentsPanel … textos=", /<ClientAttachmentsPanel[^>]*textos=\{TEXTOS_LAURA\.documentos\}/.test(laura));
check("laura: <ClientBookingsPanel … textos=", /<ClientBookingsPanel[^>]*textos=\{TEXTOS_LAURA\.sesiones\}/.test(laura));
check("laura sigue diciendo «la paciente» en sus textos", /Que la paciente lo vea/.test(laura) && /no lo ve la paciente/.test(laura));

h("Los paneles compartidos no llevan «paciente» escrito en el JSX");
for (const p of PANELES) {
  const txt = leer(join("components/clients", p));
  // Solo el código: fuera comentarios de bloque y de línea.
  const codigo = txt.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const restos = codigo.split("\n").filter((l) => /\b(la|el|este|esta) paciente\b/i.test(l));
  check(`${p}: sin «paciente» a fuego`, restos.length === 0, restos.map((l) => l.trim()).join(" | "));
}

process.stdout.write(`\n${fallos ? "✗" : "✓"} ${pasadas} bien · ${fallos} mal\n`);
process.exit(fallos ? 1 : 0);
