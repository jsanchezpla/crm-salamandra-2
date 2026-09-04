/**
 * import-aumenta-sesiones.js — las sesiones clínicas de Organízate.
 *
 * ⚠️ SIMULA POR DEFECTO. Sin `--confirm` no escribe nada.
 *
 * Son 22.811 entradas: las notas de trabajo de las terapeutas durante cuatro
 * años. Es el dato más delicado de toda la migración —contenido clínico de
 * menores— y el que menos margen tiene para inventar nada.
 *
 * ── Cómo viene y cómo se guarda ────────────────────────────────────────────
 *
 * En Organízate la sesión es UN bloque de texto seguido, con dos marcadores:
 *
 *   <terapeuta> Lunes, 23 de Marzo, 17:57 Sesión 14añ
 *   Objetivo + Actividad<TEXTO…>  Desempeño<TEXTO…>
 *
 * Nuestro modelo la guarda en tres campos (`objectives`, `activities`,
 * `performance`). Organízate junta objetivo y actividad en uno solo, así que:
 *
 *   · Lo que va tras «Objetivo + Actividad» → `activities`, que es el campo de
 *     TEXTO libre. (`objectives` NO vale: es una LISTA de objetivos cortos que
 *     la ficha muestra separados por puntos, no un párrafo.)
 *   · Lo que va tras «Desempeño»            → `performance`
 *   · `objectives` queda como lista VACÍA. Partir a ojo el párrafo que la
 *     terapeuta escribió del tirón, para inventarle unos objetivos sueltos,
 *     sería falsear su trabajo.
 *
 * El texto original completo queda en `observations.textoOriginal`, para que
 * nada dependa de que este parseo sea perfecto.
 *
 * Uso:
 *   node scripts/import-aumenta-sesiones.js            → simulación
 *   node scripts/import-aumenta-sesiones.js --confirm  → escribe
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { getTenantDb } from "../../lib/db/tenantDb.js";
import { etiquetaDe, claveSesion } from "../_organizate-historial.js";

const args = process.argv.slice(2);
const CONFIRM = args.includes("--confirm");
const SLUG = args.includes("--tenant") ? args[args.indexOf("--tenant") + 1] : "aumenta";
const DATOS = (args.includes("--datos") ? args[args.indexOf("--datos") + 1] : null) || "C:/Claude Code/migracion-aumenta";

const norm = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
const cap = (s) => String(s ?? "").trim();

const MESES = {
  enero: "01", febrero: "02", marzo: "03", abril: "04", mayo: "05", junio: "06",
  julio: "07", agosto: "08", septiembre: "09", octubre: "10", noviembre: "11", diciembre: "12",
};

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
const EMPLEADOS = [
  ...Object.keys(TERAPEUTAS),
  "VICTORIA LOSADA SALIDO", "DANIA", "FISIO", "NADIE",
  "LAURA A. ARROYO GUTIERREZ", "CRISTINA CALDERON MORENO", "CRISTINA AGUDO CONTRERAS",
].sort((a, b) => b.length - a.length);

const DOBLES = { 122: 121, 250: 249, 372: 371, 167: 166 };

/** El tercer bloque, el que se me pasó en la primera pasada. Ver `partir`. */
const RE_TAREA = /Observaciones\s*\/\s*Tareas?\s*pendientes?/i;

/**
 * Parte el texto de la sesión en sus bloques. Ver cabecera.
 *
 * ⚠️ Hay TRES marcadores, no dos (visto el 02/08/2026 al auditar). Además de
 * «Objetivo + Actividad» y «Desempeño» existe **«Observaciones / Tarea
 * pendiente»**, y 520 sesiones usan ese y solo ese. Al no conocerlo, esas
 * sesiones se guardaban con los dos campos vacíos: en la ficha del niño salían
 * EN BLANCO aunque el texto ocupara tres mil caracteres.
 *
 * Ese bloque va a `observations.homeworkTasks`, que es literalmente el campo de
 * «tareas para casa» del modelo. No a `activities`: son cosas distintas y la
 * ficha las enseña por separado.
 */
function partir(txt) {
  const iObj = txt.search(/Objetivo\s*\+\s*Actividad/i);
  const iDes = txt.search(/Desempe[ñn]o/i);
  const iTar = txt.search(RE_TAREA);

  // Cada bloque llega hasta el siguiente marcador que aparezca DESPUÉS.
  const siguiente = (desde) =>
    [iObj, iDes, iTar].filter((i) => i > desde).sort((a, b) => a - b)[0] ?? txt.length;

  const trozo = (i, re) => {
    if (i < 0) return null;
    const largo = txt.slice(i).match(re)[0].length;
    return cap(txt.slice(i + largo, siguiente(i))) || null;
  };

  return {
    actividades: trozo(iObj, /Objetivo\s*\+\s*Actividad/i),
    desempeno: trozo(iDes, /Desempe[ñn]o/i),
    tareas: trozo(iTar, RE_TAREA),
  };
}

/** Las claves de lo que YA está importado en el CRM. Una sola construcción. */
async function claves(m, transaction) {
  const filas = await m.ClinicSession.findAll({
    attributes: ["patientId", "sessionDate", "observations"],
    ...(transaction ? { transaction } : {}),
  });
  return new Set(filas.map((s) => claveSesion(s.patientId, s.sessionDate, s.observations?.textoOriginal)));
}

async function main() {
  console.log(`\n${"═".repeat(62)}`);
  console.log(` SESIONES CLÍNICAS DE AUMENTA → tenant "${SLUG}"`);
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

  const listas = [];
  const n = { total: 0, sinFecha: 0, sinPaciente: 0, sinTerapeuta: 0, conDesempeno: 0, conTareas: 0, sinTexto: 0 };

  for (const h of historiales) {
    const src = srcPorId.get(DOBLES[Number(h.id_pac)] ?? Number(h.id_pac));
    const paciente = src ? porNombre.get(norm(`${src.nombre} ${src.apellidos}`)) : null;

    for (const e of h.entradas ?? []) {
      // Por ETIQUETA, no por «que salga la palabra sesión». Ver la cabecera de
      // `_organizate-historial.js`: el filtro por palabra metía aquí 752 actas
      // de coordinación, citas y adjuntos, que quedaban como sesiones en blanco.
      if (etiquetaDe(e.txt) !== "Sesión") continue;
      n.total++;
      if (!paciente) { n.sinPaciente++; continue; }

      // El año NO está en el texto: viene del bloque mensual del historial.
      const fm = String(e.txt).match(/(\d{1,2}) de ([A-Za-zÁÉÍÓÚáéíóú]+)(?:,\s*(\d{1,2}:\d{2}))?/);
      const anio = String(e.mes ?? "").slice(0, 4);
      const mes = fm ? MESES[fm[2].toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")] : null;
      if (!fm || !mes || !/^\d{4}$/.test(anio)) { n.sinFecha++; continue; }
      const fecha = `${anio}-${mes}-${String(fm[1]).padStart(2, "0")}`;

      // Quien la escribió es el nombre que va MÁS A LA IZQUIERDA: en una sesión
      // firma la terapeuta que la da, no quien la registra.
      const t = norm(e.txt);
      let quien = null, pos = Infinity;
      for (const nom of EMPLEADOS) {
        const i = t.indexOf(nom);
        if (i >= 0 && i < pos) { pos = i; quien = nom; }
      }
      const destino = quien ? TERAPEUTAS[quien] : null;
      const therapistId = destino ? (equipoPorNombre.get(norm(destino)) ?? null) : null;
      if (!therapistId) n.sinTerapeuta++;

      const { actividades, desempeno, tareas } = partir(e.txt);
      if (desempeno) n.conDesempeno++;
      if (tareas) n.conTareas++;
      if (!actividades && !desempeno && !tareas) n.sinTexto++;

      listas.push({ paciente, therapistId, fecha, hora: fm[3] ?? null, actividades, desempeno, tareas, original: e.txt });
    }
  }

  console.log("── LO QUE SE VA A CREAR ──────────────────────────────────────\n");
  console.log(`  Sesiones encontradas     ${String(n.total).padStart(6)}`);
  console.log(`  …importables             ${String(listas.length).padStart(6)}`);
  console.log(`  Sin paciente que cruzar  ${String(n.sinPaciente).padStart(6)}`);
  console.log(`  Sin fecha reconocible    ${String(n.sinFecha).padStart(6)}`);
  console.log(`  Sin terapeuta            ${String(n.sinTerapeuta).padStart(6)}   baja o cuenta que no es persona`);
  console.log(`  Con bloque «Desempeño»   ${String(n.conDesempeno).padStart(6)}`);
  console.log(`  Con «Tarea pendiente»    ${String(n.conTareas).padStart(6)}   va a tareas para casa`);
  console.log(`  Sin texto aprovechable   ${String(n.sinTexto).padStart(6)}   se guarda igual el original\n`);
  if (listas.length) {
    const f = listas.map((x) => x.fecha).sort();
    console.log(`  Periodo: ${f[0]} → ${f[f.length - 1]}\n`);
  }

  // ⚠️ LA SIMULACIÓN TIENE QUE SIMULAR LA PARTE PELIGROSA (04/09/2026)
  //
  // Antes, el reparto entre «ya está» y «nueva» se calculaba DENTRO de la
  // transacción, o sea solo con --confirm. El seco decía «22.168 importables»
  // —que es el volcado entero— y no distinguía de las 22.045 que ya estaban en
  // el CRM: enseñaba el número tranquilizador y se callaba el único que
  // importaba. Con la clave rota, el seco salió igual de bien y el --confirm
  // creó 22.154 duplicados. Ahora se cuenta SIEMPRE, y en seco se enseña.
  const yaEnElCrm = await claves(m);
  const nuevas = listas.filter((s) => !yaEnElCrm.has(claveSesion(s.paciente.id, s.fecha, s.original)));
  const repetidas = listas.length - nuevas.length;

  console.log(`  Ya están en el CRM       ${String(repetidas).padStart(6)}`);
  console.log(`  SE CREARÍAN              ${String(nuevas.length).padStart(6)}\n`);

  // Un volcado que no reconoce NADA de lo que ya hay es la señal de que la
  // clave se ha vuelto a romper, no de que la tabla esté vacía.
  if (yaEnElCrm.size > 0 && repetidas === 0) {
    console.log(`${"═".repeat(62)}`);
    console.log(` ⚠️  ALTO: el CRM tiene ${yaEnElCrm.size} sesiones importadas y este volcado`);
    console.log("    no reconoce NI UNA. La clave de idempotencia no está casando:");
    console.log("    seguir crearía un duplicado de cada una. Ver `claveSesion`.");
    console.log(`${"═".repeat(62)}\n`);
    process.exit(2);
  }

  if (!CONFIRM) {
    console.log(`${"═".repeat(62)}`);
    console.log(" SIMULACIÓN: no se ha escrito nada. Con --confirm se ejecuta.");
    console.log(`${"═".repeat(62)}\n`);
    process.exit(0);
  }

  console.log("⚠️  Escribiendo…\n");
  let creadas = 0, yaEstaban = 0;

  await sequelize.transaction(async (t) => {
    // Idempotencia por (paciente, fecha, principio del TEXTO ORIGINAL): una
    // terapeuta puede escribir DOS sesiones el mismo día para el mismo niño.
    //
    // La clave usa el original y no `activities` a propósito: con `activities`,
    // dos sesiones del mismo día cuyo texto no llevaba ese bloque daban las dos
    // la misma clave («paciente|fecha|») y la segunda se descartaba como
    // repetida. Se perdían 27 sesiones que no eran repetidas de nada.
    //
    // ⚠️ LOS DOS LADOS DE LA CLAVE SE NORMALIZAN IGUAL (04/09/2026)
    //
    // `session_date` es `timestamptz` y Sequelize lo devuelve como objeto
    // Date, así que el lado de la BD daba «Mon Feb 10 2026 00:00:00 GMT+0000
    // (...)» y el del volcado, «2026-02-10». No casaban NUNCA, y por tanto la
    // tabla entera parecía vacía: al reimportar el 04/09/2026 se crearon
    // 22.154 sesiones duplicadas en producción. En agosto no se vio porque la
    // tabla estaba vacía de verdad y no había con qué comparar.
    //
    // Por eso la clave la construye UNA función para los dos lados. Si algún
    // día cambia, cambia para ambos.
    const yaHay = await claves(m, t);

    for (const s of listas) {
      const clave = claveSesion(s.paciente.id, s.fecha, s.original);
      if (yaHay.has(clave)) { yaEstaban++; continue; }
      yaHay.add(clave);

      await m.ClinicSession.create({
        patientId: s.paciente.id,
        clientId: s.paciente.clientId,
        therapistId: s.therapistId,
        sessionDate: s.fecha,
        duration: 45,
        // `objectives` se deja vacío A PROPÓSITO: Organízate junta objetivo y
        // actividad en un solo bloque y partirlo a ojo sería inventarse el
        // trabajo de la terapeuta. Ver cabecera.
        // Lista vacía, que es su valor por defecto: es una lista de objetivos
        // cortos, no un párrafo. Ver cabecera.
        objectives: [],
        activities: s.actividades,
        performance: s.desempeno,
        observations: {
          // «Observaciones / Tarea pendiente» de Organízate. Es el campo de
          // tareas para casa del modelo, y la ficha ya lo pinta.
          homeworkTasks: s.tareas ?? "",
          origen: "organizate",
          importadoEl: new Date().toISOString().slice(0, 10),
          // El original entero, para que nada dependa de que el parseo sea
          // perfecto: si algún día hace falta releerlo, está aquí.
          textoOriginal: s.original,
          horaOriginal: s.hora,
        },
      }, { transaction: t });
      creadas++;
    }
  });

  console.log("── ESCRITO ───────────────────────────────────────────────────\n");
  console.log(`  Sesiones creadas  ${String(creadas).padStart(6)}   (${yaEstaban} ya estaban)\n`);
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ ${err?.stack ?? err}\n`);
  process.exit(1);
});
