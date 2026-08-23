// @prueba ligera — lee ficheros del repo y llama a funciones puras de /lib; sin base ni servidor.
/**
 * _smoke-formacion-abierta.mjs — la portada de Formación es una, con
 * interruptor (18/08/2026).
 *
 *   node scripts/_smoke-formacion-abierta.mjs
 *
 * ── POR QUÉ EXISTE ──────────────────────────────────────────────────────────
 *
 * Aumenta tenía la portada de Formación en `modules/overrides/aumenta/`: la
 * base recortada (sin Empresas, Cuestionarios ni sincronizar con WordPress) y
 * copiada. El 18/08 se borró y la portada base sabe pintarse «abierta» según
 * `featureFlags.formacionAbierta` del módulo `training`, que leen la página y
 * el menú lateral (`lib/training/formacionAbierta.js`). Esta prueba fija que
 * los dos leen LO MISMO, que sin bandera nadie pierde nada (Retorika, Laura,
 * la demo ven la portada completa) y que el override no vuelve.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  esFormacionAbierta,
  textosPortada,
  FLAG_FORMACION_ABIERTA,
  HIJOS_OCULTOS_FORMACION_ABIERTA,
} from "../lib/training/formacionAbierta.js";

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

process.stdout.write("\nFormación: una portada, con el interruptor «formación abierta»\n");

h("El interruptor: sin bandera, portada completa; solo `true` la abre");
check("sin flags → completa", esFormacionAbierta(undefined) === false);
check("flags {} → completa", esFormacionAbierta({}) === false);
check("las banderas viejas de logicOverrides NO abren nada", esFormacionAbierta({ b2bEnabled: false, quizzesEnabled: false, tutorlmsConnected: false }) === false);
check(`{ ${FLAG_FORMACION_ABIERTA}: true } → abierta`, esFormacionAbierta({ [FLAG_FORMACION_ABIERTA]: true }) === true);
check("«true» como texto NO abre (solo el booleano)", esFormacionAbierta({ [FLAG_FORMACION_ABIERTA]: "true" }) === false);
check("también acepta el hasFeatureFlag del contexto", esFormacionAbierta((k) => k === FLAG_FORMACION_ABIERTA) === true);
check("los hijos ocultos son Empresas y Cuestionarios", JSON.stringify(HIJOS_OCULTOS_FORMACION_ABIERTA) === JSON.stringify(["formacion-empresas", "formacion-cuestionarios"]));

h("Las palabras: completa habla de empresas y WordPress; abierta, no");
const completa = textosPortada(false);
const abierta = textosPortada(true);
check("completa: «— empresas, cursos, alumnos»", completa.tituloSufijo === "— empresas, cursos, alumnos");
check("abierta: no menciona empresas en la intro", !/empresas cliente/i.test(abierta.intro));
check("abierta: no menciona WordPress en Cursos", !/WordPress/i.test(abierta.descCursos) && !/academia online/i.test(abierta.ayudaCursos));
check("abierta: la métrica de Alumnos no habla de empleados de empresa", !/empresa/i.test(abierta.metricaAlumnos));
for (const k of Object.keys(completa)) {
  check(`abierta tiene «${k}»`, typeof abierta[k] === "string" && abierta[k].length > 0);
}

h("El override de Aumenta se fue y la página no lo importa");
check("modules/overrides/aumenta/FormacionOverview.jsx ya no existe", !existsSync(join(RAIZ, "modules/overrides/aumenta/FormacionOverview.jsx")));
const pagina = leer("app/(dashboard)/formacion/page.jsx");
check("page.jsx no importa de modules/overrides/", !/^import .*modules\/overrides\//m.test(pagina));
check("page.jsx importa esFormacionAbierta", /esFormacionAbierta/.test(pagina));
check("page.jsx lee la fila training del tenant", /moduleKey:\s*"training"/.test(pagina));
check("page.jsx pasa abierta={abierta}", /abierta=\{abierta\}/.test(pagina));
check("page.jsx conserva las frases de Aumenta (peldaño 1)", /TEXTOS_POR_TENANT[\s\S]*aumenta:/.test(pagina) && /familias y profesionales/.test(pagina));

h("La portada base sabe pintarse abierta");
const base = leer("modules/training/FormacionOverview.jsx");
check("recibe { abierta, textos }", /export default function FormacionOverview\(\{\s*abierta\s*=\s*false,\s*textos/.test(base));
check("usa textosPortada(abierta)", /textosPortada\(abierta\)/.test(base));
check("Empresas y Cuestionarios van marcadas soloCompleta", (base.match(/soloCompleta:\s*true/g) || []).length === 2);
check("filtra las soloCompleta cuando es abierta", /abierta \? todas\.filter\(\(s\) => !s\.soloCompleta\)/.test(base));
check("no sincroniza con la web si es abierta", /\{!abierta && <SincronizarConLaWeb \/>\}/.test(base));
check("no pide /api/training/companies si es abierta", /abierta\s*\?\s*Promise\.resolve/.test(base));
check("la cifra de Empresas solo si no es abierta", /\{!abierta && \(\s*<MetricCard label="Empresas"/.test(base));

h("El menú lateral esconde por el MISMO interruptor, no por slug");
const sidebar = leer("components/layout/Sidebar.jsx");
check("Sidebar importa esFormacionAbierta y HIJOS_OCULTOS_FORMACION_ABIERTA", /esFormacionAbierta.*HIJOS_OCULTOS_FORMACION_ABIERTA|HIJOS_OCULTOS_FORMACION_ABIERTA.*esFormacionAbierta/.test(sidebar));
check("Sidebar ya no tiene la lista TENANT_HIDDEN_CHILDREN por slug", !/const TENANT_HIDDEN_CHILDREN\s*=/.test(sidebar));
check("Sidebar decide con hijosOcultosSegunModulos(modules)", /hijosOcultosSegunModulos\(modules\)/.test(sidebar));
check("y mira la fila training encendida", /m\.moduleKey === "training" && m\.enabled/.test(sidebar));

h("El script de alta de Aumenta ya no escribe el letrero viejo");
const alta = leer("scripts/add-training-module-aumenta.js");
check("no escribe uiOverride: \"aumenta/FormacionOverview\"", !/uiOverride:\s*"aumenta\/FormacionOverview"/.test(alta));
check("enciende formacionAbierta", /formacionAbierta:\s*true/.test(alta));
check("existe scripts/formacion-abierta.js para encenderlo a mano", existsSync(join(RAIZ, "scripts/formacion-abierta.js")));

process.stdout.write(`\n${fallos ? "✗" : "✓"} ${pasadas} bien · ${fallos} mal\n`);
process.exit(fallos ? 1 : 0);
