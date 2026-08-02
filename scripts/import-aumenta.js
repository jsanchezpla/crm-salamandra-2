/**
 * import-aumenta.js — vuelca los datos de Organízate en el tenant `aumenta`.
 *
 * ⚠️ SIMULA POR DEFECTO. Sin `--confirm` no escribe NADA: solo cuenta lo que
 * haría. Esto escribe 1.178 pacientes en un CRM que usan 15 personas a diario,
 * así que la simulación no es una cortesía, es el modo normal.
 *
 *   node scripts/import-aumenta.js                 → simulación (no toca nada)
 *   node scripts/import-aumenta.js --confirm       → escribe de verdad
 *   node scripts/import-aumenta.js --tenant demo   → contra otro tenant
 *
 * ── De dónde salen los datos ───────────────────────────────────────────────
 *
 * De los ficheros extraídos en C:\Claude Code\migracion-aumenta (o la ruta que
 * se pase con `--datos`). Organízate NO se toca: la extracción ya se hizo y
 * está cuadrada contra sus propias pantallas.
 *
 * ── Las decisiones de Rodrigo que aplica (02/08/2026) ──────────────────────
 *
 * · Un paciente = UNA ficha, aunque en Organízate tuviera dos por el apaño del
 *   doble pagador. Duplicar al niño parte su historial clínico en dos.
 * · Padres separados = UN cliente con DOS tutores (mismo login del portal, dos
 *   personas). Es lo que ya hace `Client.guardians`.
 * · Fundación Adecco = cliente EMPRESA aparte.
 * · Habilidades Sociales NO es especialidad: es un taller, y los pacientes que
 *   la tenían quedan inscritos en él.
 *
 * ── Es idempotente ────────────────────────────────────────────────────────
 *
 * Reconoce lo ya importado por DNI y, si no hay, por nombre + fecha de
 * nacimiento. Ejecutarlo dos veces no duplica nada.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { getTenantDb } from "../lib/db/tenantDb.js";
import validator from "validator";
import { normalizeGuardians } from "../lib/clients/guardians.js";
import { CORRECCIONES_EMAIL } from "./_correcciones-email-aumenta.js";

const args = process.argv.slice(2);
const CONFIRM = args.includes("--confirm");
const SLUG = (args[args.indexOf("--tenant") + 1] && args.includes("--tenant")) ? args[args.indexOf("--tenant") + 1] : "aumenta";
const DATOS = (args.includes("--datos") ? args[args.indexOf("--datos") + 1] : null) || "C:/Claude Code/migracion-aumenta";

const norm = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
const cap = (s) => String(s ?? "").trim();

/**
 * Correo válido, o null.
 *
 * En Organízate hay 5 mal tecleados: «no facilitado», un espacio en medio del
 * nombre, un dominio duplicado… Los que no están en `CORRECCIONES_EMAIL` se
 * DESCARTAN en vez de arreglarlos a ojo: adivinar dónde iba el espacio de
 * «silvia casco garcia@gmail.com» es inventarse la dirección de una familia.
 * Se listan al final para corregirlos a mano.
 */
const emailsMalos = [];
function emailValido(v, quien) {
  // Un punto FINAL sí se quita: «bonacasa13@gmail.com.» solo se puede leer de
  // una manera. No es adivinar, es limpiar.
  const e = cap(v).replace(/\.+$/, "");
  if (!e) return null;
  const corregido = CORRECCIONES_EMAIL[cap(v)]?.email;
  if (corregido) return corregido;
  // Se usa el MISMO validador que Sequelize (`isEmail` de validator.js). Con un
  // regex propio, más laxo, el script daba por bueno un correo que el modelo
  // rechazaba después y abortaba la transacción entera a mitad de importación.
  if (validator.isEmail(e)) return e;
  emailsMalos.push(`${quien}: ${cap(v)}`);
  return null;
}

/**
 * Organízate → plantilla real del CRM. A mano y no por parecido, porque los
 * nombres NO coinciden literalmente y un cruce difuso podría asignarle los
 * pacientes de una terapeuta a otra:
 *   "ISABEL VARA VARA PEREA" → "Isabel Vara Perea"  (apellido repetido)
 *   "LAURA.G GARRIDO"        → "Laura Garrido Rascón"
 *   "ROSA SANCHEZ VELAZQUEZ" → "Rosa María Sánchez Velázquez"
 * Las que están a null son bajas o cuentas que NO son personas.
 */
const TERAPEUTAS = {
  "ARACELI VIGARA MENDEZ": "Araceli Vigara Méndez",
  "BLANCA MARQUEZ BASCON": "Blanca Márquez Bascón",
  "DANIELA DE LA CRUZ ESTEBAN": "Daniela de la Cruz Esteban",
  "ELENA GUTIERREZ GARCIA": "Elena Gutiérrez García",
  "ESTEFANIA BERMEJO BLAZQUEZ": "Estefanía Bermejo Blázquez",
  "ISABEL ALBERCA BOLANOS": "Isabel Alberca Bolaños",
  "ISABEL VARA VARA PEREA": "Isabel Vara Perea",
  "LAURA BARRIONUEVO MACHOTA": "Laura Barrionuevo Machota",
  "LAURA.G GARRIDO": "Laura Garrido Rascón",
  "OLGA GARCIA ARCONES": "Olga García Arcones",
  "RAQUEL MESONES BERNAL": "Raquel Mesones Bernal",
  "ROSA SANCHEZ VELAZQUEZ": "Rosa María Sánchez Velázquez",
  "SILVIA PEREZ HERNANDEZ": "Silvia Pérez Hernández",
  // Bajas y cuentas que no son personas: el paciente entra SIN terapeuta.
  "DANIA": null,
  "VICTORIA LOSADA SALIDO": null,
  "LAURA A. ARROYO GUTIERREZ": null,
  "CRISTINA CALDERON MORENO": null,
  "CRISTINA AGUDO CONTRERAS": null,
  "FISIO": null,   // cuenta genérica del servicio de fisioterapia
  "NADIE": null,   // el hueco de las citas sin profesional
};

const EMPLEADOS_ORG = Object.keys(TERAPEUTAS);

/** Fichas que en Organízate estaban duplicadas por el apaño del doble pagador. */
const DOBLES = {
  122: 121,  // Diego Sánchez Couceiro — Fundación Adecco / madre
  250: 249,  // María Gómez Gómez      — Fundación Adecco / padre
  372: 371,  // Violeta García Yañez   — padre / madre (separados)
  167: 166,  // Hugo Pla López         — mismo pagador: duplicado a secas
};
const SEPARADOS = new Set([371]);          // el único caso con evidencia de separación
const ES_EMPRESA = /FUNDACION ADECCO|FUNDACIÓN ADECCO/i;

/**
 * NIF en su forma canónica: solo letras y números, en mayúsculas.
 *
 * ⚠️ AÑADIDO el 02/08/2026 tras la auditoría. En Organízate el mismo documento
 * está tecleado de varias maneras —«49.005.048-Y», «49005048Y», «G 28423275»—
 * y el NIF es la CLAVE con la que se agrupa a una familia. Sin normalizar, dos
 * hermanos cuyas fichas escribían el DNI de la madre distinto acababan en DOS
 * familias diferentes: 26 familias partidas en dos, con sus pacientes y sus
 * facturas repartidos entre las dos mitades y el correo del portal duplicado.
 *
 * Se normaliza también lo que se GUARDA, no solo la clave: son el mismo
 * documento, y en la ficha debe verse uno solo.
 */
const nifCanon = (s) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "") || null;

/**
 * Pagadores con DOS documentos distintos en Organízate.
 *
 * Normalizar el NIF junta a las familias cuyo documento solo cambiaba de
 * formato, pero no a esta: Raquel tiene un hijo cuya ficha la identifica por el
 * DNI y una hija cuya ficha la identifica por el NIE, así que salían dos
 * familias con un hermano cada una. Confirmado por Rodrigo el 02/08/2026: es la
 * misma persona, y el apellido correcto es «Quiñones».
 *
 * Los DOS documentos se conservan —también lo pidió él—: el que manda va en el
 * NIF de la ficha y el otro en `customFields.documentosAdicionales`, porque un
 * cambio de NIE a DNI no borra las facturas emitidas con el anterior.
 *
 * Se indexa por los dos documentos, para que la familia se encuentre se entre
 * por donde se entre.
 */
const UNIFICADOS = {
  RAQUEL: {
    // El DNI manda: aparece en la ficha del hijo MENOR (2020) y el NIE en la de
    // la mayor (2012), que es el orden de un NIE que se convierte en DNI.
    nif: "60629450R",
    nombre: "Raquel Quiñones Vega",
    otros: ["Y0566459Y"],
    documentos: ["60629450R", "Y0566459Y"],
    // Su nombre está escrito de tres formas entre las dos fichas («RAQUEL
    // QUIÑONEZ VEGA», «RAQUEL QUIÑONEZ», «RAQUEL QUIÑONES VEGA»). Sin esto
    // saldría como dos tutoras distintas dentro de su propia familia, porque el
    // fusionador de tutores compara por palabras y «QUIÑONEZ» no es «QUIÑONES».
    // La L de «Raquel» es opcional: en una de las fichas pone «RAQUE».
    variantes: /^RAQUEL?\s+QUI[ÑN]ONE[ZS]\b/i,
  },
};
const PAGADORES_UNIFICADOS = Object.fromEntries(
  Object.values(UNIFICADOS).flatMap((u) => u.documentos.map((d) => [d, u]))
);

/** Nombre de tutor con las variantes conocidas ya corregidas. */
function nombreTutorCanon(nombre) {
  const n = cap(nombre);
  if (!n) return n;
  for (const u of Object.values(UNIFICADOS)) {
    if (u.variantes?.test(norm(n))) return u.nombre;
  }
  return n;
}

/**
 * Con qué se agrupa a una familia: su NIF canónico, y si no lo hay, el nombre.
 * En una función y no repetida en dos sitios: si las dos copias se separasen,
 * la familia se crearía con una clave y se buscaría con otra.
 */
const claveFamilia = (pagador) => {
  const n = nifCanon(pagador?.cifnif);
  return (n ? (PAGADORES_UNIFICADOS[n]?.nif ?? n) : null) ?? norm(pagador?.nombre);
};

const ESP = [
  [/H\.?H\.?\.?S\.?S|HABILIDADES SOCIALES/, "taller_hhss"],
  [/NEUROPSICOLOG/, "neuropsicologia"],
  [/LOGOPEDIA|LOGOPEDIC/, "logopedia"],
  [/PSICOLOG/, "psicologia"],
  [/PEDAGOG/, "pedagogia"],
  [/FISIOTERAPIA/, "fisioterapia"],
  [/TERAPIA OCUPACIONAL|T\.\s?OCUPACIONAL/, "terapia_ocupacional"],
];

function leer(nombre) {
  return JSON.parse(readFileSync(path.join(DATOS, nombre), "utf8"));
}

/** Del historial saca, por paciente: terapeuta dominante y especialidades. */
function analizarHistorial(historiales) {
  const buscarEmp = (t) => {
    let mejor = null, pos = -1;
    for (const n of EMPLEADOS_ORG) {
      const re = new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![A-Z])", "g");
      let m;
      while ((m = re.exec(t)) !== null) if (m.index > pos) { pos = m.index; mejor = n; }
    }
    return { mejor, pos };
  };

  const salida = new Map();
  for (const h of historiales) {
    const porTera = {};
    const esps = new Set();
    for (const e of h.entradas ?? []) {
      const t = norm(e.txt);
      const { mejor, pos } = buscarEmp(t);
      if (!mejor || mejor === "NADIE") continue;
      const cola = t.slice(pos + mejor.length);
      if (!/CUOTA/.test(cola)) continue;
      for (const [re, k] of ESP) if (re.test(cola)) { esps.add(k); break; }
      porTera[mejor] = (porTera[mejor] ?? 0) + 1;
    }
    // ¿Tiene el contrato del centro firmado? En Organízate consta como un
    // FICHERO en el historial ("Contrato AARON RODRÍGUEZ (firmado…)").
    const contrato = (h.entradas ?? []).some((e) =>
      /CONTRATO|PRESTACION DE SERVICIOS|PRESTACIÓN DE SERVICIOS/i.test(e.txt)
    );
    const orden = Object.entries(porTera).sort((a, b) => b[1] - a[1]);
    salida.set(h.id_pac, {
      terapeutaOrg: orden[0]?.[0] ?? null,
      citas: orden[0]?.[1] ?? 0,
      especialidades: [...esps].filter((x) => x !== "taller_hhss"),
      taller: esps.has("taller_hhss"),
      contrato,
    });
  }
  return salida;
}

/**
 * ¿Son la misma persona? Igual, o uno es el principio del otro.
 *
 * En Organízate el pagador va con nombre completo («David Gómez Ropero») y el
 * contacto del teléfono con el nombre de pila («David»). Comparando solo por
 * igualdad salían 52 de las 159 familias con el mismo tutor repetido dos veces.
 * Se compara por PALABRAS enteras para que «Ana» no absorba a «Ana María» por
 * accidente... que de hecho SÍ es lo que queremos aquí: quien tiene el nombre
 * más largo se queda, porque es la ficha más completa.
 */
function mismaPersona(a, b) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  return x === y || x.startsWith(y + " ") || y.startsWith(x + " ");
}

/** Añade un tutor a la lista, fusionando si ya está con el nombre corto. */
function addTutor(lista, { name, relationship, phone, dni, email }) {
  // Único sitio por el que entran TODOS los tutores (los estructurados, el
  // pagador y los de las fichas dobles), así que es aquí donde se corrigen los
  // nombres con variantes conocidas.
  const n = nombreTutorCanon(name);
  if (!n) return;
  const i = lista.findIndex((x) => mismaPersona(x.name, n));
  if (i === -1) {
    lista.push({ name: n, relationship: relationship || null, phone: phone || null, dni: dni || null, email: email || null });
    return;
  }
  // Ya está: nos quedamos con el nombre MÁS LARGO y rellenamos lo que falte.
  const ya = lista[i];
  if (norm(n).length > norm(ya.name).length) ya.name = n;
  ya.relationship = ya.relationship || relationship || null;
  ya.phone = ya.phone || phone || null;
  ya.dni = ya.dni || dni || null;
  ya.email = ya.email || email || null;
}

/**
 * Tutores de una ficha.
 *
 * ⚠️ CORREGIDO el 02/08/2026. Al principio esto reconstruía los tutores a partir
 * del campo de contacto suelto (`ref_t3`/`tlf3`) y del nombre del pagador,
 * IGNORANDO que la extracción del sprint 1 ya traía `ficha.guardians` bien
 * estructurado: nombre, DNI, teléfono, email y parentesco, con las mismas claves
 * que usa el CRM.
 *
 * El resultado de ese error: 1.121 tutores en vez de 1.897, solo 126 familias
 * con dos progenitores en vez de 887, y CERO emails — que en la práctica
 * significa que ninguna familia podía entrar al portal, porque el portal
 * identifica por correo. También explica los tutores duplicados que hubo que
 * "arreglar": no era un problema de los datos, era leer el campo equivocado.
 *
 * Ahora se usa `ficha.guardians` y solo se cae al método viejo si no lo trae.
 */
function tutoresDe(ficha, pagador) {
  const estructurados = Array.isArray(ficha.guardians) ? ficha.guardians : [];
  if (estructurados.length) {
    const t = [];
    for (const g of estructurados) {
      if (!cap(g.nombre)) continue;
      t.push({
        // Estos NO pasan por `addTutor`, así que la corrección de nombre se
        // aplica también aquí. Si se olvidara, la misma persona entraría dos
        // veces en su propia familia con las dos grafías.
        name: nombreTutorCanon(g.nombre),
        relationship: g.relationship || null,
        phone: cap(g.telefono) || null,
        // Canónico igual que el de la familia: en Organízate vienen con puntos,
        // con guiones y hasta con un espacio delante (« Y0207871B»).
        dni: nifCanon(g.dni),
        email: emailValido(g.email, cap(g.nombre)),
      });
    }
    // El pagador también es tutor si no estaba ya en la lista.
    if (pagador?.nombre) addTutor(t, { name: pagador.nombre, relationship: null, phone: null });

    // Un correo corregido puede ser de OTRO tutor de la misma ficha (ver
    // CORRECCIONES_EMAIL). Se mueve después de meter al pagador, porque el
    // dueño de la dirección puede ser precisamente él y no estar entre los
    // tutores que trae la ficha.
    for (const g of estructurados) {
      const c = CORRECCIONES_EMAIL[cap(g.email)];
      if (!c?.de) continue;
      // Mismo nombre corregido que se usó al meterlos: comparando contra el
      // original no se encontrarían los que se hayan reescrito.
      const origen = t.find((x) => mismaPersona(x.name, nombreTutorCanon(g.nombre)));
      const destino = t.find((x) => mismaPersona(x.name, c.de));
      if (origen && origen !== destino) origen.email = null;
      if (destino) destino.email = c.email;
    }

    if (t.length) return t;
  }

  const t = [];
  const add = (name, relationship, phone) => addTutor(t, { name, relationship, phone });
  // El pagador es quien firma y recibe las facturas: va el primero.
  if (pagador?.nombre) add(pagador.nombre, null, null);
  if (ficha.ref_t3 || ficha.tlf3) add(ficha.ref_t3 && !/^(padre|madre|tutor)/i.test(ficha.ref_t3) ? ficha.ref_t3 : (pagador?.nombre ? null : ficha.ref_t3), ficha.ref_t3, ficha.tlf3);
  if (ficha.ref_t4 || ficha.tlf4) add(ficha.ref_t4 && !/^(padre|madre|tutor)/i.test(ficha.ref_t4) ? ficha.ref_t4 : null, ficha.ref_t4, ficha.tlf4);
  return t;
}

async function main() {
  console.log(`\n${"═".repeat(62)}`);
  console.log(` IMPORTACIÓN DE AUMENTA → tenant "${SLUG}"`);
  console.log(`${CONFIRM ? " ⚠️  MODO REAL: va a escribir en la base de datos" : " · SIMULACIÓN: no se escribe nada"}`);
  console.log(`${"═".repeat(62)}\n`);

  const pacientes = leer("pacientes-limpio.json").fichas;
  const facturacion = leer("organizate-bonos-facturacion.json").fichas;
  const historiales = leer("organizate-historiales.json").historiales;
  const pagadorDe = new Map(facturacion.map((f) => [f.id_pac, f.facturacion]));

  console.log(`Leídos: ${pacientes.length} pacientes · ${historiales.length} historiales\n`);
  const analisis = analizarHistorial(historiales);

  const { models: m } = getTenantDb(SLUG);
  const equipo = await m.TeamMember.findAll({ attributes: ["id", "displayName"] });
  const equipoPorNombre = new Map(equipo.map((e) => [norm(e.displayName), e.id]));

  // ── 1. Agrupar por FAMILIA (pagador) ────────────────────────────────────
  const familias = new Map();   // clave → { nombre, nif, direccion, localidad, empresa, pacientes[] }
  const empresas = new Map();
  const sinPagador = [];

  for (const f of pacientes) {
    const idp = Number(f.id_pac);
    if (DOBLES[idp]) continue;                       // la ficha doble no crea paciente

    const pag = pagadorDe.get(idp) ?? null;
    const dobles = Object.entries(DOBLES).filter(([, buena]) => buena === idp).map(([d]) => Number(d));
    const pagadores = [pag, ...dobles.map((d) => pagadorDe.get(d))].filter((p) => p?.nombre);

    // El pagador FAMILIAR es el primero que no sea una empresa.
    const familiar = pagadores.find((p) => !ES_EMPRESA.test(p.nombre)) ?? null;
    for (const p of pagadores.filter((p) => ES_EMPRESA.test(p.nombre))) {
      const k = norm(p.nombre);
      if (!empresas.has(k)) empresas.set(k, { nombre: cap(p.nombre), nif: nifCanon(p.cifnif), pacientes: [] });
      empresas.get(k).pacientes.push(idp);
    }
    if (!familiar) { sinPagador.push(idp); continue; }

    const clave = claveFamilia(familiar);
    // Si es un pagador unificado, mandan SU nombre y SU documento, venga la
    // ficha del hijo que venga: si no, la familia se llamaría según cuál de los
    // dos hermanos se procesara primero.
    const unificado = PAGADORES_UNIFICADOS[nifCanon(familiar.cifnif)] ?? null;
    if (!familias.has(clave)) {
      familias.set(clave, {
        nombre: unificado?.nombre ?? cap(familiar.nombre),
        nif: unificado?.nif ?? nifCanon(familiar.cifnif),
        otrosDocumentos: unificado?.otros ?? null,
        direccion: familiar.direccion || f.direccion || null,
        localidad: familiar.localidad || f.localidad || null,
        separada: dobles.some((d) => SEPARADOS.has(idp) || SEPARADOS.has(d)) || SEPARADOS.has(idp),
        tutores: [], pacientes: [],
      });
    }
    const fam = familias.get(clave);
    fam.pacientes.push(idp);
    for (const t of tutoresDe(f, familiar)) addTutor(fam.tutores, t);
    // Los pagadores de la ficha doble también son tutores de esa familia.
    for (const d of dobles) {
      const pd = pagadorDe.get(d);
      if (pd?.nombre && !ES_EMPRESA.test(pd.nombre)) {
        addTutor(fam.tutores, { name: pd.nombre, relationship: null, phone: null });
      }
    }
  }

  // ── 2. Recuento de lo que se haría ──────────────────────────────────────
  const aImportar = pacientes.filter((f) => !DOBLES[Number(f.id_pac)]);
  let conTerapeuta = 0, sinTerapeutaPorBaja = 0, conTaller = 0;
  const espCuenta = {};
  const terapeutaNoEncontrada = new Set();

  for (const f of aImportar) {
    const a = analisis.get(Number(f.id_pac));
    if (!a) continue;
    if (a.taller) conTaller++;
    for (const e of a.especialidades) espCuenta[e] = (espCuenta[e] ?? 0) + 1;
    if (!a.terapeutaOrg) continue;
    const destino = TERAPEUTAS[a.terapeutaOrg];
    if (destino === null) { sinTerapeutaPorBaja++; continue; }
    if (destino === undefined) { terapeutaNoEncontrada.add(a.terapeutaOrg); continue; }
    if (equipoPorNombre.has(norm(destino))) conTerapeuta++;
    else terapeutaNoEncontrada.add(`${a.terapeutaOrg} → ${destino} (no está en la plantilla)`);
  }

  const totalTutores = [...familias.values()].reduce((s, f) => s + f.tutores.length, 0);
  const conDosTutores = [...familias.values()].filter((f) => f.tutores.length >= 2).length;

  console.log("── LO QUE SE VA A CREAR ──────────────────────────────────────\n");
  console.log(`  Clientes (familias)      ${String(familias.size).padStart(6)}`);
  console.log(`  Clientes empresa         ${String(empresas.size).padStart(6)}   ${[...empresas.values()].map((e) => `${e.nombre} (${e.pacientes.length} pac.)`).join(", ")}`);
  console.log(`  Tutores                  ${String(totalTutores).padStart(6)}   ${conDosTutores} familias con dos o más`);
  console.log(`  Pacientes                ${String(aImportar.length).padStart(6)}   (${pacientes.length} fichas − ${Object.keys(DOBLES).length} dobles)`);
  console.log(`  …con terapeuta asignada  ${String(conTerapeuta).padStart(6)}`);
  console.log(`  …sin terapeuta (bajas)   ${String(sinTerapeutaPorBaja).padStart(6)}   su profesional ya no está en el centro`);
  console.log(`  Inscripciones al taller  ${String(conTaller).padStart(6)}   Habilidades sociales\n`);

  console.log("  Especialidades detectadas:");
  for (const [k, v] of Object.entries(espCuenta).sort((a, b) => b[1] - a[1])) console.log(`    ${k.padEnd(22)} ${String(v).padStart(5)} pacientes`);

  console.log("\n── FICHAS DOBLES (una sola ficha de paciente) ────────────────\n");
  for (const [doble, buena] of Object.entries(DOBLES)) {
    const fb = pacientes.find((p) => Number(p.id_pac) === buena);
    const p1 = pagadorDe.get(buena)?.nombre ?? "—";
    const p2 = pagadorDe.get(Number(doble))?.nombre ?? "—";
    console.log(`  ${buena}/${doble}  ${fb?.nombre} ${fb?.apellidos}`);
    console.log(`         pagadores: ${p1}  ·  ${p2}${SEPARADOS.has(buena) ? "   (separados)" : ""}`);
  }

  if (sinPagador.length) {
    console.log(`\n⚠ ${sinPagador.length} paciente(s) sin ningún pagador en Organízate.`);
    console.log(`  Se les crea una familia con su propio nombre para que no queden sueltos.`);
  }
  if (terapeutaNoEncontrada.size) {
    console.log(`\n⚠ Terapeutas sin equivalencia en la plantilla:`);
    for (const t of terapeutaNoEncontrada) console.log(`    · ${t}`);
  }

  console.log("\n── LO QUE ESTE SCRIPT **NO** IMPORTA ─────────────────────────\n");
  console.log("  Facturas (14.243), gastos (1.802) y cierres de caja (828).");
  console.log("  Esos datos siguen en el navegador (IndexedDB) y hay que");
  console.log("  exportarlos a fichero antes. Es la segunda fase.\n");

  if (!CONFIRM) {
    console.log(`${"═".repeat(62)}`);
    console.log(" SIMULACIÓN: no se ha escrito nada. Con --confirm se ejecuta.");
    console.log(`${"═".repeat(62)}\n`);
    process.exit(0);
  }

  // ════════════════════════════════════════════════════════════════════════
  //  ESCRITURA
  // ════════════════════════════════════════════════════════════════════════
  console.log("⚠️  Escribiendo…\n");

  const rel = (r) => {
    const s = norm(r);
    if (/MADRE/.test(s)) return "madre";
    if (/PADRE/.test(s)) return "padre";
    return "tutor";
  };
  const hoy = new Date().toISOString().slice(0, 10);
  const cuenta = { clientesNuevos: 0, clientesYa: 0, pacientesNuevos: 0, pacientesYa: 0, inscripciones: 0 };

  // Todo dentro de UNA transacción: o entra la migración entera o no entra
  // nada. A medias sería lo peor posible — familias sin sus pacientes.
  const { sequelize } = getTenantDb(SLUG);
  await sequelize.transaction(async (t) => {
    // ── Clientes ─────────────────────────────────────────────────────────
    const clienteDe = new Map();   // clave de familia → id de Client

    const crearCliente = async ({ nombre, nif, otrosDocumentos, direccion, localidad, tipo, tutores, separada, activo }) => {
      // El correo y el teléfono del CLIENTE salen del tutor que paga (o del
      // primero que los tenga). Sin correo la familia NO puede entrar al portal:
      // el acceso se resuelve por email. Es lo que faltaba en la primera pasada.
      const conContacto = (tutores ?? []).find((x) => mismaPersona(x.name, nombre) && (x.email || x.phone))
        ?? (tutores ?? []).find((x) => x.email || x.phone)
        ?? null;
      const where = nif ? { taxId: nif } : { name: nombre };
      let c = await m.Client.findOne({ where, transaction: t });
      if (c) { cuenta.clientesYa++; return c.id; }
      c = await m.Client.create({
        type: tipo ?? "individual",
        name: nombre,
        taxId: nif || null,
        fiscalAddress: direccion || null,
        fiscalCity: localidad || null,
        // Se revalida aquí aunque los tutores ya vengan filtrados: el correo del
        // cliente puede llegar por otra vía (el pagador, el método antiguo) y un
        // solo correo torcido aborta la transacción entera.
        email: emailValido(conContacto?.email, nombre),
        phone: conContacto?.phone || null,
        status: activo === false ? "inactive" : "active",
        separated: separada ? true : null,
        guardians: normalizeGuardians((tutores ?? []).map((x) => ({
          name: x.name, relationship: rel(x.relationship), phone: x.phone,
          dni: x.dni, email: x.email,
        }))),
        // De dónde viene cada ficha: sin esto, dentro de un año nadie sabría
        // qué se importó y qué se dio de alta a mano.
        customFields: {
          origen: "organizate",
          importadoEl: hoy,
          // El otro documento de la misma persona, cuando lo hay. No se tira:
          // hay facturas emitidas con él y un cambio de NIE a DNI no las borra.
          ...(otrosDocumentos?.length ? { documentosAdicionales: otrosDocumentos } : {}),
        },
      }, { transaction: t });
      cuenta.clientesNuevos++;
      return c.id;
    };

    for (const [, e] of empresas) {
      clienteDe.set(`EMPRESA:${norm(e.nombre)}`, await crearCliente({
        nombre: e.nombre, nif: e.nif, tipo: "company", tutores: [],
      }));
    }
    for (const [clave, f] of familias) {
      clienteDe.set(clave, await crearCliente({
        nombre: f.nombre, nif: f.nif, otrosDocumentos: f.otrosDocumentos,
        direccion: f.direccion, localidad: f.localidad,
        tipo: "individual", tutores: f.tutores, separada: f.separada,
      }));
    }

    // ── Taller ───────────────────────────────────────────────────────────
    let taller = await m.Taller.findOne({ where: { name: "Habilidades sociales" }, transaction: t });
    if (!taller) {
      taller = await m.Taller.create({
        name: "Habilidades sociales",
        description: "Taller de grupo. Venía de Organízate marcado como especialidad.",
      }, { transaction: t });
    }

    // ── Pacientes ────────────────────────────────────────────────────────
    for (const f of pacientes) {
      const idp = Number(f.id_pac);
      if (DOBLES[idp]) continue;

      const a = analisis.get(idp) ?? {};
      // Fecha de alta = su primera visita en Organízate.
      const primera = /^\d{2}\/\d{2}\/\d{4}$/.test(f._primera_visita || "")
        ? f._primera_visita.split("/").reverse().join("-") : null;
      const pag = pagadorDe.get(idp) ?? null;
      const dobles = Object.entries(DOBLES).filter(([, b]) => b === idp).map(([d]) => Number(d));
      const pagadores = [pag, ...dobles.map((d) => pagadorDe.get(d))].filter((p) => p?.nombre);
      const familiar = pagadores.find((p) => !ES_EMPRESA.test(p.nombre)) ?? null;

      // Sin pagador: familia propia y ficha INACTIVA (decisión de Rodrigo,
      // 02/08). Son 119, y de ellos solo 2 tienen teléfono: fichas viejas a
      // medio rellenar que no se pierden pero tampoco ensucian la lista.
      let clientId;
      let inactivo = false;
      if (familiar) {
        clientId = clienteDe.get(claveFamilia(familiar));
      } else {
        inactivo = true;
        const propio = `${cap(f.nombre)} ${cap(f.apellidos)}`.trim();
        const clave = `PROPIO:${norm(propio)}`;
        if (!clienteDe.has(clave)) {
          clienteDe.set(clave, await crearCliente({
            nombre: propio, nif: nifCanon(f.cifnif),
            direccion: f.direccion, localidad: f.localidad,
            tipo: "individual", activo: false,
            tutores: [f.ref_t3, f.ref_t4].filter(Boolean).length
              ? [{ name: cap(f.ref_t3 || f.ref_t4), relationship: f.ref_t3 || f.ref_t4, phone: f.tlf3 || f.tlf4 }]
              : [],
          }));
        }
        clientId = clienteDe.get(clave);
      }

      const nombre = cap(f.nombre);
      const apellidos = cap(f.apellidos);
      const nac = /^\d{2}\/\d{2}\/\d{4}$/.test(f.fechanac || "")
        ? f.fechanac.split("/").reverse().join("-") : null;

      // Idempotencia: por DNI si lo hay, y si no por nombre + nacimiento.
      const yaEsta = await m.Patient.findOne({
        where: nifCanon(f.cifnif) ? { dni: nifCanon(f.cifnif) } : { firstName: nombre, lastName: apellidos, birthDate: nac },
        transaction: t,
      });
      if (yaEsta) { cuenta.pacientesYa++; continue; }

      const destino = a.terapeutaOrg ? TERAPEUTAS[a.terapeutaOrg] : null;
      const terapeutaId = destino ? (equipoPorNombre.get(norm(destino)) ?? null) : null;

      const p = await m.Patient.create({
        clientId,
        firstName: nombre,
        lastName: apellidos,
        birthDate: nac,
        dni: nifCanon(f.cifnif),
        address: f.direccion || null,
        specialties: a.especialidades ?? [],
        mainTherapistId: terapeutaId,
        enrollmentDate: primera,
        // Contrato firmado en PAPEL, que consta como fichero en su historial de
        // Organízate. No tenemos el PDF —solo la constancia— así que se marca la
        // casilla y no se inventa un documento que nadie podría abrir.
        contractSigned: !!a.contrato,
        status: inactivo ? "paused" : "active",
        notes: inactivo ? "Importado de Organízate sin pagador ni actividad. Revisar." : null,
      }, { transaction: t });
      cuenta.pacientesNuevos++;

      if (a.taller) {
        await m.TallerInscripcion.create(
          { tallerId: taller.id, patientId: p.id, joinedAt: hoy },
          { transaction: t }
        );
        cuenta.inscripciones++;
      }
    }
  });

  if (emailsMalos.length) {
    console.log(`⚠ ${emailsMalos.length} correo(s) mal tecleados en Organízate, NO importados:`);
    for (const e of emailsMalos) console.log(`    · ${e}`);
    console.log("  Hay que corregirlos a mano en la ficha de la familia.\n");
  }

  console.log("── ESCRITO ───────────────────────────────────────────────────\n");
  console.log(`  Clientes creados         ${String(cuenta.clientesNuevos).padStart(6)}   (${cuenta.clientesYa} ya existían)`);
  console.log(`  Pacientes creados        ${String(cuenta.pacientesNuevos).padStart(6)}   (${cuenta.pacientesYa} ya existían)`);
  console.log(`  Inscripciones al taller  ${String(cuenta.inscripciones).padStart(6)}\n`);
  console.log("  Las facturas, gastos y cierres van en la segunda tanda.\n");
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ ${err?.stack ?? err}\n`);
  process.exit(1);
});
