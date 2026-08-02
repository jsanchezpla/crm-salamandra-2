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
import { getTenantDb } from "../lib/db/tenantDb.js";

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

/** Parte el texto de la sesión en sus dos bloques. Ver cabecera. */
function partir(txt) {
  const iObj = txt.search(/Objetivo\s*\+\s*Actividad/i);
  const iDes = txt.search(/Desempe[ñn]o/i);
  let actividades = null, desempeno = null;

  if (iObj >= 0) {
    const desde = iObj + txt.slice(iObj).match(/Objetivo\s*\+\s*Actividad/i)[0].length;
    actividades = cap(iDes > iObj ? txt.slice(desde, iDes) : txt.slice(desde));
  }
  if (iDes >= 0) {
    const desde = iDes + txt.slice(iDes).match(/Desempe[ñn]o/i)[0].length;
    desempeno = cap(txt.slice(desde));
  }
  return { actividades: actividades || null, desempeno: desempeno || null };
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
  const n = { total: 0, sinFecha: 0, sinPaciente: 0, sinTerapeuta: 0, conDesempeno: 0, sinTexto: 0 };

  for (const h of historiales) {
    const src = srcPorId.get(DOBLES[Number(h.id_pac)] ?? Number(h.id_pac));
    const paciente = src ? porNombre.get(norm(`${src.nombre} ${src.apellidos}`)) : null;

    for (const e of h.entradas ?? []) {
      if (!/\bSesi[óo]n\b/i.test(e.txt)) continue;
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

      const { actividades, desempeno } = partir(e.txt);
      if (desempeno) n.conDesempeno++;
      if (!actividades && !desempeno) n.sinTexto++;

      listas.push({ paciente, therapistId, fecha, hora: fm[3] ?? null, actividades, desempeno, original: e.txt });
    }
  }

  console.log("── LO QUE SE VA A CREAR ──────────────────────────────────────\n");
  console.log(`  Sesiones encontradas     ${String(n.total).padStart(6)}`);
  console.log(`  …importables             ${String(listas.length).padStart(6)}`);
  console.log(`  Sin paciente que cruzar  ${String(n.sinPaciente).padStart(6)}`);
  console.log(`  Sin fecha reconocible    ${String(n.sinFecha).padStart(6)}`);
  console.log(`  Sin terapeuta            ${String(n.sinTerapeuta).padStart(6)}   baja o cuenta que no es persona`);
  console.log(`  Con bloque «Desempeño»   ${String(n.conDesempeno).padStart(6)}`);
  console.log(`  Sin texto aprovechable   ${String(n.sinTexto).padStart(6)}   se guarda igual el original\n`);
  if (listas.length) {
    const f = listas.map((x) => x.fecha).sort();
    console.log(`  Periodo: ${f[0]} → ${f[f.length - 1]}\n`);
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
    // Idempotencia por (paciente, fecha, primeros caracteres del texto): una
    // terapeuta puede escribir DOS sesiones el mismo día para el mismo niño.
    const yaHay = new Set(
      (await m.ClinicSession.findAll({ attributes: ["patientId", "sessionDate", "activities"], transaction: t }))
        .map((s) => `${s.patientId}|${s.sessionDate}|${String(s.activities ?? "").slice(0, 40)}`)
    );

    for (const s of listas) {
      const clave = `${s.paciente.id}|${s.fecha}|${String(s.actividades ?? "").slice(0, 40)}`;
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
