/**
 * import-aumenta-coordinaciones.js — las actas de reunión de Organízate.
 *
 * ⚠️ SIMULA POR DEFECTO. Sin `--confirm` no escribe nada.
 *
 * ── Qué son ────────────────────────────────────────────────────────────────
 *
 * 700 entradas del historial clínico que NO son sesiones: coordinaciones con el
 * colegio, reuniones con la familia y coordinaciones entre profesionales. Se
 * quedaron fuera de la primera migración —y peor, 199 de ellas se colaron como
 * sesiones clínicas en blanco, porque el filtro miraba si aparecía la palabra
 * «sesión» en el texto—. Ver `_organizate-historial.js`.
 *
 * ── Cómo vienen ────────────────────────────────────────────────────────────
 *
 * Un bloque de texto seguido con etiquetas dentro, en este orden y no siempre
 * todas:
 *
 *   BLANCA MÁRQUEZ Lunes, 20 de Abril, 14:31 Coordinación 12añ
 *   Formato de la reunión: Vía online (Google Meet)
 *   Centro: Colegio Altamira
 *   Asistentes: Paloma (tutora), Alejandro (PT), Marga (orientadora)
 *   Puntos a tratar: …
 *   Acuerdos: …
 *   Duración: …
 *
 * Cada bloque va a su campo: asistentes → `participants`, puntos → `topics`,
 * acuerdos → `agreements`. Lo que no case con ninguna etiqueta se queda en
 * `topics` como un único punto, para no perderlo. El texto original entero se
 * guarda SIEMPRE en `aiTranscription`, igual que las sesiones guardan el suyo:
 * si este parseo se equivoca, el original sigue ahí.
 *
 * ── Quién la registró ──────────────────────────────────────────────────────
 *
 * 529 de las 700 las firma alguien que sigue en el centro y se enlazan a su
 * ficha de equipo. Las otras 171 las firma quien ya se fue, o cuentas que no
 * son personas («NADIE», «FISIO»): esas van con el nombre en `createdByName`,
 * el campo de texto libre que se añadió para esto (Rodrigo, 02/08/2026).
 * Ninguna se atribuye a nadie que no la escribiera.
 *
 * Uso:
 *   node --env-file=.env.local scripts/import-aumenta-coordinaciones.js
 *   node --env-file=.env.local scripts/import-aumenta-coordinaciones.js --confirm
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { getTenantDb } from "../../lib/db/tenantDb.js";
import { etiquetaDe, ETIQUETAS_COORDINACION } from "../_organizate-historial.js";

const args = process.argv.slice(2);
const CONFIRM = args.includes("--confirm");
const SLUG = args.includes("--tenant") ? args[args.indexOf("--tenant") + 1] : "aumenta";
const DATOS = (args.includes("--datos") ? args[args.indexOf("--datos") + 1] : null) || "C:/Claude Code/migracion-aumenta";

const norm = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
const cap = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

const MESES = {
  enero: "01", febrero: "02", marzo: "03", abril: "04", mayo: "05", junio: "06",
  julio: "07", agosto: "08", septiembre: "09", octubre: "10", noviembre: "11", diciembre: "12",
};

/** Mismo mapa que el resto de importadores: los nombres NO coinciden literalmente. */
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
};
/** Firmas que NO son una persona del equipo: van al campo de texto libre. */
const OTRAS_FIRMAS = {
  "VICTORIA LOSADA SALIDO": "Victoria Losada Salido",
  "DANIA": "Dania",
  "LAURA A. ARROYO GUTIERREZ": "Laura A. Arroyo Gutiérrez",
  "CRISTINA CALDERON MORENO": "Cristina Calderón Moreno",
  "CRISTINA AGUDO CONTRERAS": "Cristina Agudo Contreras",
  "FISIO": "Fisioterapia (cuenta del servicio)",
  "NADIE": "Sin asignar en Organízate",
};
const FIRMAS = Object.keys({ ...TERAPEUTAS, ...OTRAS_FIRMAS }).sort((a, b) => b.length - a.length);

const DOBLES = { 122: 121, 250: 249, 372: 371, 167: 166 };

/** Etiquetas internas del acta, de la más larga a la más corta. */
const CAMPOS = [
  ["formato", /Formato de la reuni[óo]n\s*:/i],
  ["centro", /Centro\s*:/i],
  ["asistentes", /Asistentes\s*:/i],
  ["motivo", /Motivo de la solicitud\s*:/i],
  ["puntos", /Puntos a tratar\s*:/i],
  ["acuerdos", /Acuerdos\s*:/i],
  ["seguimiento", /Responsables de seguimiento\s*:/i],
  ["observaciones", /Observaciones\s*:/i],
  ["duracion", /Duraci[óo]n total\s*:|Duraci[óo]n\s*:/i],
];

/**
 * Parte el acta en sus bloques.
 *
 * Se localizan TODAS las etiquetas con su posición y se ordena por posición: el
 * contenido de cada una llega hasta donde empieza la siguiente. Buscar cada
 * bloque por su cuenta no vale, porque el orden no es fijo y un «Acuerdos:» se
 * comería el resto del acta.
 */
function partir(txt, desde) {
  const marcas = [];
  for (const [clave, re] of CAMPOS) {
    const m = String(txt).slice(desde).match(re);
    if (m && m.index != null) marcas.push({ clave, ini: desde + m.index, fin: desde + m.index + m[0].length });
  }
  marcas.sort((a, b) => a.ini - b.ini);

  const out = {};
  for (let i = 0; i < marcas.length; i++) {
    const hasta = i + 1 < marcas.length ? marcas[i + 1].ini : txt.length;
    out[marcas[i].clave] = cap(txt.slice(marcas[i].fin, hasta));
  }
  // Lo que va entre la cabecera y la primera etiqueta: si no hay etiquetas, es
  // el acta entera. No se tira.
  const primera = marcas.length ? marcas[0].ini : txt.length;
  out.suelto = cap(txt.slice(desde, primera));
  return out;
}

/**
 * Papeles que la gente escribe en las actas. Sirven para leer «Orientadora
 * Lidia» (papel + nombre) y para reconocer un apunte que es SOLO el papel.
 * De más largo a más corto, para que «jefe de estudios» gane a «jefe».
 */
const PAPELES = [
  "trabajadora social", "trabajador social", "jefe de estudios", "orientadora",
  "orientador", "neuropediatra", "psicopedagoga", "psicopedagogo", "fisioterapeuta",
  "terapeuta ocupacional", "psiquiatra", "psicóloga", "psicologa", "psicólogo",
  "psicologo", "logopeda", "pedagoga", "pedagogo", "maestra", "maestro",
  "profesora", "profesor", "directora", "director", "tutora", "tutor",
  "pediatra", "enfermera", "educadora", "educador", "monitora", "monitor",
  "madre", "padre", "abuela", "abuelo", "pt", "al",
];

/**
 * Un apunte de asistente → { nombre, papel }.
 *
 * En las actas de Organízate esto se escribía a mano y sale de todas las formas:
 *   «Marga (orientadora)»  → nombre y papel
 *   «Orientadora Lidia»    → papel delante, nombre detrás
 *   «Tutora»               → solo el papel
 *   «Blanca»               → solo el nombre
 *
 * Decisión de Rodrigo (02/08/2026): los cuatro casos entran, con el hueco que
 * falte en blanco. Adivinar la otra mitad sería inventarse quién estuvo en una
 * reunión sobre un menor.
 */
function partirAsistente(txt) {
  const t = cap(txt).replace(/\.+$/, "");
  if (!t) return null;

  // «Marga (orientadora)». Sin anclar al final a propósito: hay apuntes que
  // siguen con una coletilla sobre la reunión —«Estefanía (psicóloga) - Ha sido
  // telefónica»— y esa cola no es parte de la persona. Se ignora aquí; el
  // bloque de asistentes original se guarda entero en el acta.
  const par = t.match(/^(.*?)\s*\(([^)]+)\)/);
  if (par) {
    const nombre = cap(par[1]);
    const papel = cap(par[2]);
    return { nombre: nombre || null, papel: papel || null };
  }

  const bajo = t.toLowerCase();
  for (const p of PAPELES) {
    if (bajo === p) return { nombre: null, papel: cap(t) };           // «Tutora»
    if (bajo.startsWith(p + " ")) {                                    // «Orientadora Lidia»
      return { nombre: cap(t.slice(p.length)), papel: cap(t.slice(0, p.length)) };
    }
    if (bajo.endsWith(" " + p)) {                                      // «Lidia orientadora»
      return { nombre: cap(t.slice(0, t.length - p.length)), papel: cap(t.slice(t.length - p.length)) };
    }
  }
  return { nombre: t, papel: null };                                   // «Blanca»
}

/** «Paloma (tutora), Alejandro (PT) y Marga» → apuntes sueltos. */
function trocearAsistentes(txt) {
  if (!txt) return { apuntes: [], descartados: [] };
  const apuntes = [], descartados = [];
  for (const trozo of String(txt).split(/\s*[,;]\s*|\s+y\s+/i)) {
    const t = cap(trozo);
    if (!t || t.length < 2) continue;
    // Más de seis palabras no es una persona: es que el troceado ha pillado
    // prosa del acta. Se descarta como asistente, pero se cuenta y el texto
    // original del bloque sigue guardado en el acta, así que no se pierde.
    if (t.split(" ").length > 6 || t.length > 70) { descartados.push(t); continue; }
    const a = partirAsistente(t);
    if (a && (a.nombre || a.papel)) apuntes.push(a);
  }
  return { apuntes: apuntes.slice(0, 25), descartados };
}

/**
 * Tipo de coordinación, por lo que dice el acta y NO por adivinar.
 *
 * Solo se marca «colegio» cuando el centro se llama como un centro educativo:
 * poner «colegio» a todo lo que no sea la familia haría pasar por escolar una
 * reunión con un hospital.
 */
/** Papeles que dicen «esta persona es de la familia», nunca del centro. */
const ES_FAMILIA = /\b(madre|padre|abuel[ao]|t[íi][ao]|hermano?a?|tutor legal|mam[áa]|pap[áa])\b/i;

/**
 * ¿El asistente es del CENTRO o de fuera?
 *
 * Son dos listas distintas y no da igual (Rodrigo, 02/08/2026): los del centro
 * se conectan con la plantilla —«lo he derivado a Blanca, pedagogía»— y los de
 * fuera van a la agenda de profesionales externos del paciente.
 *
 * Se marca como interno solo con una prueba, no por parecido:
 *   · el apunte dice «Aumenta», o
 *   · el nombre completo coincide con alguien de la plantilla, o
 *   · es un nombre de pila que en la plantilla lleva UNA sola persona.
 *
 * Un nombre de pila repetido («Laura», que en Aumenta son dos) no basta: mejor
 * que quede como externo a colgarle una reunión a la Laura que no era. Y un
 * papel de familia («Andy (padre de Anthony)») nunca es interno, aunque el
 * nombre coincida con el de alguien del equipo.
 */
function dondeVa({ nombre, papel }, indice) {
  const texto = norm(`${nombre ?? ""} ${papel ?? ""}`);
  const deCasa = /\bAUMENTA\b/.test(texto);
  if (papel && ES_FAMILIA.test(papel) && !deCasa) return { kind: "external", teamMemberId: null };

  const n = norm(nombre);
  if (n) {
    const exacto = indice.porNombre.get(n);
    if (exacto) return { kind: "internal", teamMemberId: exacto };
    if (!n.includes(" ")) {
      const porPila = indice.porPila.get(n);
      if (porPila) return { kind: "internal", teamMemberId: porPila };
    }
    // «Laura B» — así es como se distinguen entre ellas cuando hay dos con el
    // mismo nombre de pila, y así lo escriben en las actas. Solo vale si la
    // inicial deja UNA sola candidata.
    const inicial = n.match(/^([A-ZÑ]+)\s+([A-ZÑ])\.?$/);
    if (inicial) {
      const porInicial = indice.porPilaInicial.get(`${inicial[1]} ${inicial[2]}`);
      if (porInicial) return { kind: "internal", teamMemberId: porInicial };
    }
  }
  // Dice que es del centro pero no sabemos quién: interno sin ficha. Pasa con
  // quien ya no está en plantilla.
  if (deCasa) return { kind: "internal", teamMemberId: null };
  return { kind: "external", teamMemberId: null };
}

function tipoDe(etiqueta, centro) {
  if (etiqueta === "Reuniones con la familia") return { tipo: "family", scope: "external", entidad: null };
  const c = norm(centro);
  if (!c || c === "AUMENTA") return { tipo: "other_therapist", scope: "internal", entidad: null };
  if (/COLEGIO|CEIP|C E I P|INSTITUTO|IES|ESCUELA|CEE|COLE|EDUCATIV/.test(c)) {
    return { tipo: "school", scope: "external", entidad: cap(centro).slice(0, 200) };
  }
  return { tipo: "other", scope: "external", entidad: cap(centro).slice(0, 200) };
}

async function main() {
  console.log(`\n${"═".repeat(62)}`);
  console.log(` COORDINACIONES DE AUMENTA → tenant "${SLUG}"`);
  console.log(`${CONFIRM ? " ⚠️  MODO REAL: va a escribir" : " · SIMULACIÓN: no se escribe nada"}`);
  console.log(`${"═".repeat(62)}\n`);

  const historiales = JSON.parse(readFileSync(path.join(DATOS, "organizate-historiales.json"), "utf8")).historiales;
  const pacientesSrc = JSON.parse(readFileSync(path.join(DATOS, "pacientes-limpio.json"), "utf8")).fichas;
  const srcPorId = new Map(pacientesSrc.map((f) => [Number(f.id_pac), f]));

  const { models: m, sequelize } = getTenantDb(SLUG);
  const pacientes = await m.Patient.findAll({ attributes: ["id", "firstName", "lastName", "clientId"] });
  const porNombre = new Map();
  for (const p of pacientes) {
    const k = norm(`${p.firstName} ${p.lastName}`);
    if (!porNombre.has(k)) porNombre.set(k, p);
  }
  const equipo = await m.TeamMember.findAll({ attributes: ["id", "displayName"] });
  const equipoPorNombre = new Map(equipo.map((e) => [norm(e.displayName), e.id]));

  // Índice para reconocer a los del centro entre los asistentes. El de nombre de
  // pila solo guarda los que NO se repiten: en Aumenta hay dos Lauras y dos
  // Cristinas, y con esas no se puede resolver por el nombre a secas.
  const pilaCuenta = new Map();
  for (const e of equipo) {
    const pila = norm(e.displayName).split(" ")[0];
    pilaCuenta.set(pila, (pilaCuenta.get(pila) ?? 0) + 1);
  }
  // «LAURA B» → nombre de pila + inicial del primer apellido, si es única.
  const inicialCuenta = new Map();
  const claveInicial = (nombre) => {
    const p = norm(nombre).split(" ");
    return p.length > 1 ? `${p[0]} ${p[1][0]}` : null;
  };
  for (const e of equipo) {
    const k = claveInicial(e.displayName);
    if (k) inicialCuenta.set(k, (inicialCuenta.get(k) ?? 0) + 1);
  }

  const indiceEquipo = {
    porNombre: equipoPorNombre,
    porPila: new Map(
      equipo
        .filter((e) => pilaCuenta.get(norm(e.displayName).split(" ")[0]) === 1)
        .map((e) => [norm(e.displayName).split(" ")[0], e.id])
    ),
    porPilaInicial: new Map(
      equipo
        .filter((e) => claveInicial(e.displayName) && inicialCuenta.get(claveInicial(e.displayName)) === 1)
        .map((e) => [claveInicial(e.displayName), e.id])
    ),
  };

  const listas = [];
  const n = {
    total: 0, sinPaciente: 0, sinFecha: 0, conEquipo: 0, conNombre: 0, sinFirma: 0,
    internos: 0, internosConFicha: 0, externos: 0, prosaDescartada: 0,
  };
  const porTipo = {};

  for (const h of historiales) {
    const src = srcPorId.get(DOBLES[Number(h.id_pac)] ?? Number(h.id_pac));
    const paciente = src ? porNombre.get(norm(`${src.nombre} ${src.apellidos}`)) : null;

    for (const e of h.entradas ?? []) {
      const etiqueta = etiquetaDe(e.txt);
      if (!ETIQUETAS_COORDINACION.has(etiqueta)) continue;
      n.total++;
      if (!paciente) { n.sinPaciente++; continue; }

      // El año NO está en el texto: viene del bloque mensual del historial.
      const fm = String(e.txt).match(/(\d{1,2}) de ([A-Za-zÁÉÍÓÚáéíóú]+)(?:,\s*(\d{1,2}:\d{2}))?/);
      const anio = String(e.mes ?? "").slice(0, 4);
      const mes = fm ? MESES[fm[2].toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")] : null;
      if (!fm || !mes || !/^\d{4}$/.test(anio)) { n.sinFecha++; continue; }
      const fecha = `${anio}-${mes}-${String(fm[1]).padStart(2, "0")}`;

      // Quien firma va SIEMPRE al principio del texto.
      const t = norm(e.txt);
      const firma = FIRMAS.find((x) => t.startsWith(x)) ?? null;
      const delEquipo = firma && TERAPEUTAS[firma] ? equipoPorNombre.get(norm(TERAPEUTAS[firma])) ?? null : null;
      const nombreLibre = delEquipo ? null : (firma ? (TERAPEUTAS[firma] ?? OTRAS_FIRMAS[firma]) : null);
      if (delEquipo) n.conEquipo++;
      else if (nombreLibre) n.conNombre++;
      else n.sinFirma++;

      // El parseo empieza DESPUÉS de la edad: antes solo hay firma y fecha.
      const iEdad = String(e.txt).search(/\d{1,2}\s*añ/);
      const bloques = partir(String(e.txt), iEdad >= 0 ? iEdad + String(e.txt).slice(iEdad).match(/\d{1,2}\s*añ\w*/)[0].length : 0);

      const { tipo, scope, entidad } = tipoDe(etiqueta, bloques.centro);
      porTipo[tipo] = (porTipo[tipo] ?? 0) + 1;

      // Nada se tira: lo que no case con una etiqueta conocida entra como punto.
      const puntos = [bloques.motivo, bloques.puntos, bloques.suelto, bloques.observaciones].filter(Boolean);

      // Los asistentes, repartidos en las dos listas que pidió Rodrigo.
      const { apuntes, descartados } = trocearAsistentes(bloques.asistentes);
      n.prosaDescartada += descartados.length;
      const asistentes = apuntes.map((a) => ({ ...a, ...dondeVa(a, indiceEquipo) }));
      for (const a of asistentes) {
        if (a.kind === "internal") { n.internos++; if (a.teamMemberId) n.internosConFicha++; }
        else n.externos++;
      }

      listas.push({
        paciente, fecha, tipo, scope, entidad,
        createdById: delEquipo,
        createdByName: nombreLibre,
        asistentes,
        topics: puntos,
        agreements: [bloques.acuerdos, bloques.seguimiento].filter(Boolean),
        formato: bloques.formato ?? null,
        original: e.txt,
        etiqueta,
      });
    }
  }

  console.log("── LO QUE SE VA A CREAR ──────────────────────────────────────\n");
  console.log(`  Actas encontradas        ${String(n.total).padStart(6)}`);
  console.log(`  …importables             ${String(listas.length).padStart(6)}`);
  console.log(`  Sin paciente que cruzar  ${String(n.sinPaciente).padStart(6)}`);
  console.log(`  Sin fecha reconocible    ${String(n.sinFecha).padStart(6)}`);
  console.log(`  Firmadas por el equipo   ${String(n.conEquipo).padStart(6)}   se enlazan a su ficha`);
  console.log(`  Firmadas por otros       ${String(n.conNombre).padStart(6)}   solo el nombre, en texto libre`);
  console.log(`  Sin firma reconocible    ${String(n.sinFirma).padStart(6)}\n`);
  console.log(`  Por tipo: ${Object.entries(porTipo).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  const conAsistentes = listas.filter((x) => x.asistentes.length).length;
  const conAcuerdos = listas.filter((x) => x.agreements.length).length;
  console.log(`  Con asistentes: ${conAsistentes} · con acuerdos: ${conAcuerdos}\n`);

  // Los externos, agrupados por paciente: es SU agenda, así que la misma
  // orientadora sale una vez por cada niño que lleva, y así debe ser.
  const agenda = new Map();
  for (const a of listas) {
    for (const x of a.asistentes.filter((y) => y.kind === "external")) {
      const k = `${a.paciente.id}|${norm(x.nombre)}|${norm(x.papel)}`;
      if (!agenda.has(k)) agenda.set(k, { paciente: a.paciente, nombre: x.nombre, papel: x.papel, entidad: a.entidad });
    }
  }
  console.log("── ASISTENTES ────────────────────────────────────────────────\n");
  console.log(`  Del centro                ${String(n.internos).padStart(6)}   ${n.internosConFicha} enlazados a su ficha de equipo`);
  console.log(`  De fuera                  ${String(n.externos).padStart(6)}`);
  console.log(`  …fichas de contacto nuevas${String(agenda.size).padStart(6)}   en la agenda del paciente`);
  const soloPapel = [...agenda.values()].filter((x) => !x.nombre).length;
  const soloNombre = [...agenda.values()].filter((x) => !x.papel).length;
  console.log(`     de ellas, solo con el papel  ${String(soloPapel).padStart(4)}   («Tutora», sin nombre)`);
  console.log(`     de ellas, solo con el nombre ${String(soloNombre).padStart(4)}   («Blanca», sin papel)`);
  console.log(`  Trozos descartados por ser prosa y no una persona: ${n.prosaDescartada}`);
  console.log("     (el bloque de asistentes original se guarda entero en el acta)\n");
  if (listas.length) {
    const f = listas.map((x) => x.fecha).sort();
    console.log(`  Periodo: ${f[0]} → ${f[f.length - 1]}\n`);
    const ej = listas.find((x) => x.asistentes.some((y) => y.kind === "internal")
      && x.asistentes.some((y) => y.kind === "external") && x.agreements.length);
    if (ej) {
      const pinta = (a) => `${a.nombre ?? "—"}${a.papel ? ` · ${a.papel}` : ""}`;
      console.log("  Ejemplo de cómo queda una:");
      console.log(`    paciente     ${ej.paciente.firstName} ${ej.paciente.lastName}`);
      console.log(`    tipo         ${ej.tipo} · ${ej.scope}${ej.entidad ? ` · ${ej.entidad}` : ""}`);
      console.log(`    la registró  ${ej.createdById ? "(ficha de equipo)" : ej.createdByName}`);
      console.log(`    del centro   ${ej.asistentes.filter((a) => a.kind === "internal").map(pinta).join(" | ") || "—"}`);
      console.log(`    de fuera     ${ej.asistentes.filter((a) => a.kind === "external").map(pinta).join(" | ") || "—"}`);
      console.log(`    acuerdos     ${String(ej.agreements[0]).slice(0, 90)}…\n`);
    }
  }

  if (!CONFIRM) {
    console.log(`${"═".repeat(62)}`);
    console.log(" SIMULACIÓN: no se ha escrito nada. Con --confirm se ejecuta.");
    console.log(`${"═".repeat(62)}\n`);
    process.exit(0);
  }

  console.log("⚠️  Escribiendo…\n");
  let creadas = 0, yaEstaban = 0, contactos = 0;

  await sequelize.transaction(async (tx) => {
    // ── Agenda de contactos externos ──────────────────────────────────────
    // Se crean ANTES que las actas, para que cada acta pueda apuntar a la ficha
    // del contacto y no solo escribir su nombre otra vez.
    const idContacto = new Map();
    for (const c of await m.ExternalContact.findAll({ attributes: ["id", "patientId", "name", "role"], transaction: tx })) {
      idContacto.set(`${c.patientId}|${norm(c.name)}|${norm(c.role)}`, c.id);
    }
    for (const [clave, c] of agenda) {
      if (idContacto.has(clave)) continue;
      const nuevo = await m.ExternalContact.create({
        patientId: c.paciente.id,
        clientId: c.paciente.clientId,
        name: c.nombre,
        role: c.papel,
        entity: c.entidad,
        notes: "Sacado de las actas de coordinación de Organízate.",
      }, { transaction: tx });
      idContacto.set(clave, nuevo.id);
      contactos++;
    }

    // Idempotencia por (paciente, fecha, primeros caracteres del original): dos
    // actas del mismo niño el mismo día son posibles, pero no idénticas.
    const yaHay = new Set(
      (await m.Coordination.findAll({ attributes: ["relatedPatientId", "coordinationDate", "aiTranscription"], transaction: tx }))
        .map((c) => `${c.relatedPatientId}|${String(c.coordinationDate).slice(0, 10)}|${String(c.aiTranscription ?? "").slice(0, 60)}`)
    );

    for (const a of listas) {
      const clave = `${a.paciente.id}|${a.fecha}|${String(a.original).slice(0, 60)}`;
      if (yaHay.has(clave)) { yaEstaban++; continue; }
      yaHay.add(clave);

      // Cada asistente, con su lista y su enlace: los del centro a la ficha de
      // equipo, los de fuera a la de la agenda del paciente.
      const participantes = a.asistentes.map((x) => ({
        kind: x.kind,
        name: x.nombre ?? null,
        role: x.papel ?? null,
        teamMemberId: x.teamMemberId ?? null,
        externalContactId: x.kind === "external"
          ? idContacto.get(`${a.paciente.id}|${norm(x.nombre)}|${norm(x.papel)}`) ?? null
          : null,
      }));

      await m.Coordination.create({
        coordinationType: a.tipo,
        scope: a.scope,
        externalEntity: a.entidad,
        coordinationDate: new Date(`${a.fecha}T00:00:00`),
        participants: participantes,
        topics: a.topics,
        agreements: a.agreements,
        nextActions: [],
        relatedPatientId: a.paciente.id,
        clientId: a.paciente.clientId,
        createdById: a.createdById,
        createdByName: a.createdByName,
        // El acta entera tal cual venía. Si el parseo de arriba se equivoca en
        // algo, esto sigue siendo la verdad.
        aiTranscription: a.original,
      }, { transaction: tx });
      creadas++;
    }
  });

  console.log("── ESCRITO ───────────────────────────────────────────────────\n");
  console.log(`  Coordinaciones creadas  ${String(creadas).padStart(6)}   (${yaEstaban} ya estaban)`);
  console.log(`  Contactos externos      ${String(contactos).padStart(6)}   en la agenda de sus pacientes\n`);
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ ${err?.stack ?? err}\n`);
  process.exit(1);
});
