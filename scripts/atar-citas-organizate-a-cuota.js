// @vivo — Cada cita importada de Organízate deja de ser «Sesión (importada)»: coge el tipo de cita de su curso de Organízate y queda atada a la cuota de su familia que corresponde a ESE servicio (terapia y minutos), aunque la cuota tenga varios conceptos. Se ejecutó en aumenta el 06/09/2026; se repite tras cada copia de la agenda.
/**
 * atar-citas-organizate-a-cuota.js — las citas importadas, con su tipo de
 * verdad y con la cuota de la familia que les toca (06/09/2026, Rodrigo:
 * «cambia en lugar de Sesión (importada) y mete las sesiones en la cuota
 * correspondiente a la familia, que el cambio sea perfecto»).
 *
 *   docker exec crm-salamandra-app-1 node scripts/atar-citas-organizate-a-cuota.js aumenta [--desde=2026-09-01] [--confirm] [--detalle] [--pisar] [--tipos]
 *
 * ENSAYA POR DEFECTO. Solo escribe con `--confirm`.
 *
 * ── LO QUE SABE CADA CITA IMPORTADA ────────────────────────────────────────
 * Cada cita traída de Organízate lleva en `additional_data` el CURSO al que
 * pertenecía allí («Importada de Organízate #126600 · C_LOGOPEDIA45»), y ese
 * curso ES la cuota en el vocabulario del centro: terapia, minutos y veces
 * por semana. `backfill-citas-cobro-desde-cuota.js` (04/09) no lo miraba y
 * por eso se detenía en 5.268 citas de familias cuya cuota tiene varios
 * conceptos (Logopedia 45x1 + T.O. 45x1: dos terapias del mismo niño). Con
 * el curso de la cita ya no hay que adivinar: la cita de T.O. va a la cuota
 * de T.O. y la de logopedia a la de logopedia.
 *
 * ── QUÉ HACE ───────────────────────────────────────────────────────────────
 * Para cada cita con la marca de Organízate desde `--desde` (sin taller):
 *   1. TIPO DE CITA: si sigue siendo «Sesión (importada)», pasa al tipo que
 *      corresponde a su curso (C_LOGOPEDIA45 → «CUOTA LOGOPEDIA 45»,
 *      C_PEDAG45X2 SS → «CUOTA PEDAGOGIA 45 X 2 SESIONES SEMANALES»…), que
 *      son los 57 tipos que vinieron de Organízate y nadie usaba. Los cursos
 *      que no son cuota (entrevista inicial, bonos, programa de conducta)
 *      van a su tipo si existe; los que no se reconocen se quedan como están.
 *   2. COBRO: entre las cuotas vivas de la familia (las del paciente si las
 *      tiene; si no, las de la familia sin paciente) se busca el concepto de
 *      la MISMA terapia y los MISMOS minutos que el curso; si hay varios,
 *      desempata las veces por semana. Si de esa terapia solo hay uno aunque
 *      cambien los minutos, se coge (el curso de Organízate y la cuota del
 *      CRM pueden discrepar en 45/60: manda lo que paga la familia). Si la
 *      familia no tiene cuota de esa terapia, o hay dos y no se distinguen,
 *      la cita se deja sin cobro y se lista.
 *   3. Una cita que YA tenía cobro no se toca (lo puso el backfill o una
 *      persona); si lo calculado es distinto se cuenta y, con `--pisar`, se
 *      corrige.
 *   4. Con `--tipos`, además, cada tipo «CUOTA …» sin concepto se enlaza al
 *      concepto de cuota que le corresponde (`event_types.concept_id`), que
 *      es de donde las citas NUEVAS heredan su dinero (`dineroDeLaCita.js`).
 *
 * Idempotente: relanzarlo sobre lo ya hecho no cambia nada. No toca citas
 * creadas a mano en el CRM (no llevan la marca) ni las de taller.
 */

import { Sequelize, QueryTypes } from "sequelize";

const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith("--")) ?? "aumenta";
const CONFIRMAR = args.includes("--confirm");
const DETALLE = args.includes("--detalle");
const PISAR = args.includes("--pisar");
const TIPOS = args.includes("--tipos");
const desdeArg = args.find((a) => a.startsWith("--desde="))?.split("=")[1];
const DESDE = desdeArg && /^\d{4}-\d{2}-\d{2}$/.test(desdeArg) ? desdeArg : "2026-09-01";
const TIPO_IMPORTADO = "Sesión (importada)";

const log = (m = "") => process.stdout.write(`${m}\n`);
const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
const ini = (s) => norm(s).split(" ").filter(Boolean).map((w) => w[0]).join(".");
const n6 = (x) => String(x).padStart(6);

/** Terapia de un texto (curso de Organízate, concepto del CRM o tipo de cita). */
function terapiaDe(texto) {
  const t = norm(texto);
  if (/LOGOP/.test(t)) return "logopedia";
  if (/PSICO|PISCO/.test(t)) return "psicologia";
  if (/PEDAG/.test(t)) return "pedagogia";
  if (/T\.?\s?O\.?(\s|$)|OCUPACIONAL/.test(t)) return "to";
  if (/HHSS|HABILIDADES/.test(t)) return "hhss";
  if (/REFUERZO|TT\.?EE/.test(t)) return "refuerzo";
  if (/FISIO/.test(t)) return "fisio";
  return null;
}

/** Minutos y veces por semana de un texto: «45x1», «60X2», «45 X 2 SESIONES», «2x45», «60+45». */
function dosisDe(texto) {
  const t = norm(texto).replace(/SESIONES?|SEMANA(LES)?|SS/g, " ");
  const combo = t.match(/(\d{2})\s*\+\s*(\d{2})/);
  if (combo) return { mins: [Number(combo[1]), Number(combo[2])], veces: 1 };
  let min = null, veces = 1;
  const axb = t.match(/(\d+)\s*X\s*(\d+)/);
  if (axb) {
    const a = Number(axb[1]), b = Number(axb[2]);
    if (a >= 30 && b < 10) { min = a; veces = b; }
    else if (b >= 30 && a < 10) { min = b; veces = a; }
  }
  if (min === null) {
    const m = t.match(/(30|45|60|90)/);
    if (m) min = Number(m[1]);
  }
  return min === null ? null : { mins: [min], veces };
}

/** Cursos de Organízate que no son una cuota mensual. */
const CURSOS_ESPECIALES = {
  ENTREVINIC: { tipo: "ENTREVISTA INICIAL", concepto: "Entrevista Inicial" },
  "PROGR.CONDUC": { tipo: "PROGRAMA DE CONDUCTA" },
};

/** Qué dice el curso de una cita: cuota (terapia+dosis), especial, bono, o nada. */
function cursoDe(servicio, tipoNombre = null) {
  const s = String(servicio ?? "").trim();
  if (!s) {
    // Cita nacida en el CRM: su tipo hace de curso.
    const n = norm(tipoNombre);
    if (!n) return null;
    if (n === "ENTREVISTA INICIAL") return { clase: "especial", ...CURSOS_ESPECIALES.ENTREVINIC, texto: tipoNombre };
    if (!n.startsWith("CUOTA ") || /FAMILIAR/.test(n)) return { clase: "otro", texto: tipoNombre };
    const terapia = terapiaDe(n), dosis = dosisDe(n.replace(/^CUOTA /, ""));
    if (!terapia || !dosis) return { clase: "otro", texto: tipoNombre };
    return { clase: "cuota", terapia, min: dosis.mins[0], veces: dosis.veces, texto: tipoNombre };
  }
  if (CURSOS_ESPECIALES[s]) return { clase: "especial", ...CURSOS_ESPECIALES[s], texto: s };
  const bono = s.match(/^(PSICOLOGIA|LOGOPEDIA|PEDAGOGIA|TERAPIA OCUPACIONAL)\s+(\d{2})\s*\(B-\d+\)$/i);
  if (bono) return { clase: "bono", tipo: `${bono[1].toUpperCase()} ${bono[2]}`, texto: s };
  if (!/^C_/.test(s)) return { clase: "desconocido", texto: s };
  const terapia = terapiaDe(s);
  const dosis = dosisDe(s);
  if (!terapia || !dosis) return { clase: "desconocido", texto: s };
  return { clase: "cuota", terapia, min: dosis.mins[0], veces: dosis.veces, texto: s };
}

async function main() {
  if (!/^[a-z0-9_]+$/.test(slug) || !process.env.DATABASE_URL) {
    process.stderr.write("\nUso: node scripts/atar-citas-organizate-a-cuota.js <slug> [--desde=AAAA-MM-DD] [--confirm] [--detalle] [--pisar] [--tipos]\n\n");
    process.exit(1);
  }
  const S = `crm_${slug}`;
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });
  const q = (sql, bind) => s.query(sql, { bind, type: QueryTypes.SELECT });

  log("\n════════════════════════════════════════════════════");
  log(` Citas importadas → su tipo y la cuota de su familia — ${slug}`);
  log(` Desde ${DESDE} · ${CONFIRMAR ? "ESCRIBIENDO" : "ENSAYO (no escribe)"}${PISAR ? " · pisa cobros distintos" : ""}${TIPOS ? " · enlaza tipos↔conceptos" : ""}`);
  log("════════════════════════════════════════════════════\n");

  const tipos = await q(`SELECT id, name, concept_id FROM "${S}".event_types`);
  const conceptos = await q(`SELECT id, name, unit_price FROM "${S}".billing_concepts WHERE active`);
  const cuotas = await q(`SELECT id, client_id, patient_id, concept_ids FROM "${S}".billing_cuotas WHERE active`);
  // Las importadas llevan su curso de Organízate; las nacidas en el CRM no,
  // pero su TIPO de cita dice lo mismo («CUOTA LOGOPEDIA 45», «ENTREVISTA
  // INICIAL»): se lee como si fuera el curso. Una cita de un tipo que no es
  // cuota ni entrevista se deja como está.
  const citas = await q(
    `SELECT b.id, b.patient_id, b.client_id, b.duration, b.status, b.event_type_id, b.cobro_modo, b.cobro_concept_id,
            substring(b.additional_data from '· (.*)$') AS servicio,
            (b.additional_data LIKE 'Importada de Organízate%') AS importada,
            et.name AS tipo_nombre,
            p.first_name || ' ' || p.last_name AS paciente
       FROM "${S}".bookings b
       LEFT JOIN "${S}".patients p ON p.id = b.patient_id
       LEFT JOIN "${S}".event_types et ON et.id = b.event_type_id
      WHERE b.scheduled_at >= $1 AND b.taller_grupo_id IS NULL AND b.status <> 'cancelled'`,
    [DESDE]
  );

  // ── Tipos de cita por clave terapia|min|veces (solo los «CUOTA …» sin «FAMILIAR») ──
  const tipoImportado = tipos.find((t) => t.name === TIPO_IMPORTADO) ?? null;
  const tipoPorNombre = new Map(tipos.map((t) => [norm(t.name), t]));
  const tipoPorClave = new Map();
  for (const t of tipos) {
    const n = norm(t.name);
    if (!n.startsWith("CUOTA ") || /FAMILIAR/.test(n)) continue;
    const terapia = terapiaDe(n), dosis = dosisDe(n.replace(/^CUOTA /, ""));
    if (!terapia || !dosis || dosis.mins.length !== 1) continue;
    const k = `${terapia}|${dosis.mins[0]}|${dosis.veces}`;
    if (tipoPorClave.has(k)) tipoPorClave.set(k, null); // dos tipos para lo mismo: no se elige
    else tipoPorClave.set(k, t);
  }

  // ── Conceptos de cuota, parseados ────────────────────────────────────────
  const conceptoPorId = new Map();
  for (const c of conceptos) {
    const n = norm(c.name);
    const terapia = terapiaDe(n);
    const dosis = n.startsWith("CUOTA ") ? dosisDe(n.replace(/^CUOTA /, "")) : null;
    conceptoPorId.set(String(c.id), { ...c, terapia, mins: dosis?.mins ?? [], veces: dosis?.veces ?? 1, esCuota: n.startsWith("CUOTA ") });
  }
  const conceptoEntrevista = conceptos.find((c) => norm(c.name) === norm("Entrevista Inicial")) ?? null;

  // ── Cuotas por familia ───────────────────────────────────────────────────
  const cuotasPorFamilia = new Map();
  for (const c of cuotas) {
    const k = String(c.client_id);
    if (!cuotasPorFamilia.has(k)) cuotasPorFamilia.set(k, []);
    cuotasPorFamilia.get(k).push({ ...c, conceptIds: Array.isArray(c.concept_ids) ? c.concept_ids.map(String) : [] });
  }

  const conceptoParaCita = (cita, curso) => {
    const fam = cuotasPorFamilia.get(String(cita.client_id)) ?? [];
    if (!fam.length) return { motivo: "familia sin cuota" };
    const suyas = cita.patient_id ? fam.filter((c) => String(c.patient_id ?? "") === String(cita.patient_id)) : [];
    const base = suyas.length ? suyas : fam.filter((c) => !c.patient_id);
    if (!base.length) return { motivo: "cuotas de otros hermanos" };
    const ids = [...new Set(base.flatMap((c) => c.conceptIds))];
    const cands = ids.map((id) => conceptoPorId.get(id)).filter((c) => c && c.esCuota);
    if (!cands.length) return { motivo: "familia sin cuota" };
    const mismaTerapia = cands.filter((c) => c.terapia === curso.terapia);
    if (!mismaTerapia.length) return { motivo: "sin cuota de esa terapia", cands };
    const mismosMin = mismaTerapia.filter((c) => c.mins.includes(curso.min));
    if (mismosMin.length === 1) return { concepto: mismosMin[0], como: "terapia y minutos" };
    if (mismosMin.length > 1) {
      const mismasVeces = mismosMin.filter((c) => c.veces === curso.veces);
      if (mismasVeces.length === 1) return { concepto: mismasVeces[0], como: "terapia, minutos y veces" };
      return { motivo: "varias cuotas de esa terapia", cands: mismosMin };
    }
    if (mismaTerapia.length === 1) return { concepto: mismaTerapia[0], como: "terapia (minutos distintos)" };
    return { motivo: "varias cuotas de esa terapia", cands: mismaTerapia };
  };

  // ── Decidir cita a cita ──────────────────────────────────────────────────
  const cambiosTipo = []; // { id, tipoId }
  const cambiosCobro = []; // { id, concepto }
  const cuenta = {
    citas: citas.length, servicioDesconocido: 0, otroTipo: 0, tipoCambia: 0, tipoYaEstaba: 0, tipoSinDestino: 0,
    cobroNuevo: 0, cobroYaIgual: 0, cobroDistinto: 0, cobroSinFamilia: 0, cobroSinCuota: 0, cobroSinTerapia: 0, cobroAmbiguo: 0, cobroHermanos: 0, cobroNoCuota: 0,
  };
  const porConcepto = new Map(), porTipo = new Map(), porComo = new Map();
  const sinTerapia = new Map(), ambiguas = new Map(), distintas = [], desconocidos = new Map(), sinCuota = new Map();
  const suma = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);

  for (const cita of citas) {
    const curso = cursoDe(cita.servicio, cita.tipo_nombre);
    if (curso?.clase === "otro") { cuenta.otroTipo++; continue; } // nacida en el CRM con un tipo que no es cuota
    if (!curso || curso.clase === "desconocido") { cuenta.servicioDesconocido++; suma(desconocidos, cita.servicio ?? cita.tipo_nombre ?? "(vacío)"); continue; }

    // 1. El tipo
    let tipoDestino = null;
    if (curso.clase === "cuota") tipoDestino = tipoPorClave.get(`${curso.terapia}|${curso.min}|${curso.veces}`) ?? null;
    else if (curso.tipo) tipoDestino = tipoPorNombre.get(norm(curso.tipo)) ?? null;
    if (tipoImportado && String(cita.event_type_id) === String(tipoImportado.id)) {
      if (tipoDestino) { cambiosTipo.push({ id: cita.id, tipoId: tipoDestino.id }); cuenta.tipoCambia++; suma(porTipo, tipoDestino.name); }
      else cuenta.tipoSinDestino++;
    } else cuenta.tipoYaEstaba++;

    // 2. El cobro
    let concepto = null, como = null;
    if (curso.clase === "cuota") {
      if (!cita.client_id) { cuenta.cobroSinFamilia++; continue; }
      const r = conceptoParaCita(cita, curso);
      if (r.concepto) { concepto = r.concepto; como = r.como; }
      else {
        if (r.motivo === "familia sin cuota") { cuenta.cobroSinCuota++; suma(sinCuota, `${ini(cita.paciente)} · ${curso.texto}`); }
        else if (r.motivo === "cuotas de otros hermanos") cuenta.cobroHermanos++;
        else if (r.motivo === "sin cuota de esa terapia") { cuenta.cobroSinTerapia++; suma(sinTerapia, `${ini(cita.paciente)} · ${curso.texto} · cuota: ${(r.cands ?? []).map((c) => c.name).join(" + ")}`); }
        else { cuenta.cobroAmbiguo++; suma(ambiguas, `${ini(cita.paciente)} · ${curso.texto} · ${(r.cands ?? []).map((c) => c.name).join(" | ")}`); }
        continue;
      }
    } else if (curso.clase === "especial" && curso.concepto && conceptoEntrevista) {
      concepto = conceptoPorId.get(String(conceptoEntrevista.id)); como = "entrevista inicial";
    } else { cuenta.cobroNoCuota++; continue; }

    if (cita.cobro_modo) {
      if (String(cita.cobro_concept_id ?? "") === String(concepto.id)) { cuenta.cobroYaIgual++; continue; }
      cuenta.cobroDistinto++;
      if (distintas.length < 12) distintas.push(`${ini(cita.paciente)} · ${curso.texto} · tenía ${conceptoPorId.get(String(cita.cobro_concept_id))?.name ?? cita.cobro_modo} → ${concepto.name}`);
      if (!PISAR) continue;
    }
    cambiosCobro.push({ id: cita.id, concepto });
    cuenta.cobroNuevo++;
    suma(porConcepto, concepto.name); suma(porComo, como);
  }

  // ── Tipos ↔ conceptos ────────────────────────────────────────────────────
  const enlaces = [];
  if (TIPOS) {
    const conceptoPorClave = new Map();
    for (const c of conceptoPorId.values()) {
      if (!c.esCuota || !c.terapia || c.mins.length !== 1) continue;
      const k = `${c.terapia}|${c.mins[0]}|${c.veces}`;
      conceptoPorClave.set(k, conceptoPorClave.has(k) ? null : c);
    }
    for (const [k, t] of tipoPorClave) {
      const c = t && conceptoPorClave.get(k);
      if (!t || !c) continue;
      if (t.concept_id) continue; // ya lo tiene: no se pisa
      enlaces.push({ tipo: t, concepto: c });
    }
    const tipoEntrevista = tipoPorNombre.get(norm("ENTREVISTA INICIAL"));
    if (tipoEntrevista && !tipoEntrevista.concept_id && conceptoEntrevista) {
      enlaces.push({ tipo: tipoEntrevista, concepto: conceptoPorId.get(String(conceptoEntrevista.id)) });
    }
  }

  // ── Informe ──────────────────────────────────────────────────────────────
  log(`  Citas vivas desde ${DESDE} (sin taller):  ${n6(cuenta.citas)}`);
  log(`  · curso que no se reconoce:            ${n6(cuenta.servicioDesconocido)}`);
  log(`  · nacidas en el CRM con otro tipo:     ${n6(cuenta.otroTipo)}`);
  log(`\n  TIPO DE CITA`);
  log(`  · pasan de «${TIPO_IMPORTADO}» a su tipo: ${n6(cuenta.tipoCambia)}`);
  log(`  · ya tenían otro tipo:                 ${n6(cuenta.tipoYaEstaba)}`);
  log(`  · sin tipo al que ir:                  ${n6(cuenta.tipoSinDestino)}`);
  for (const [nombre, n] of [...porTipo.entries()].sort((a, b) => b[1] - a[1])) log(`      ${String(n).padStart(6)}  ${nombre}`);
  log(`\n  COBRO (la cuota de la familia)`);
  log(`  · se atan ahora:                       ${n6(cuenta.cobroNuevo)}`);
  log(`  · ya estaban atadas a esa cuota:       ${n6(cuenta.cobroYaIgual)}`);
  log(`  · tenían OTRA cuota puesta:            ${n6(cuenta.cobroDistinto)}${PISAR ? "   (se corrigen)" : "   (se respetan; --pisar para corregir)"}`);
  log(`  · familia sin cuota viva:              ${n6(cuenta.cobroSinCuota)}`);
  log(`  · sin cuota de esa terapia:            ${n6(cuenta.cobroSinTerapia)}`);
  log(`  · varias cuotas y no se distinguen:    ${n6(cuenta.cobroAmbiguo)}`);
  log(`  · solo cuotas de otros hermanos:       ${n6(cuenta.cobroHermanos)}`);
  log(`  · sin familia enlazada:                ${n6(cuenta.cobroSinFamilia)}`);
  log(`  · no es cuota (bono, informe, programa): ${n6(cuenta.cobroNoCuota)}`);
  if (porComo.size) { log(`\n  Cómo se ha decidido:`); for (const [k, n] of [...porComo.entries()].sort((a, b) => b[1] - a[1])) log(`      ${String(n).padStart(6)}  ${k}`); }
  if (porConcepto.size) { log(`\n  Reparto por cuota:`); for (const [k, n] of [...porConcepto.entries()].sort((a, b) => b[1] - a[1])) log(`      ${String(n).padStart(6)}  ${k}`); }
  if (desconocidos.size) { log(`\n  Cursos que no se reconocen:`); for (const [k, n] of desconocidos) log(`      ${String(n).padStart(6)}  ${k}`); }
  if (DETALLE) {
    if (sinTerapia.size) { log(`\n  Sin cuota de esa terapia (paciente · curso · lo que paga la familia):`); for (const [k, n] of [...sinTerapia.entries()].sort((a, b) => b[1] - a[1])) log(`      ${String(n).padStart(4)}  ${k}`); }
    if (sinCuota.size) { log(`\n  Familias sin cuota viva (paciente · curso · citas):`); for (const [k, n] of [...sinCuota.entries()].sort((a, b) => b[1] - a[1])) log(`      ${String(n).padStart(4)}  ${k}`); }
    if (ambiguas.size) { log(`\n  Varias cuotas posibles:`); for (const [k, n] of ambiguas) log(`      ${String(n).padStart(4)}  ${k}`); }
    if (distintas.length) { log(`\n  Tenían otra cuota (muestra):`); for (const d of distintas) log(`      ${d}`); }
  }
  if (TIPOS) {
    log(`\n  TIPOS ↔ CONCEPTOS: ${enlaces.length} tipos «CUOTA …» se enlazan a su concepto`);
    for (const e of enlaces) log(`      ${e.tipo.name}  →  ${e.concepto.name}`);
  }

  if (!CONFIRMAR) {
    log("\n  (ensayo: no se ha escrito nada. Para hacerlo, --confirm)\n");
    await s.close();
    return;
  }

  const t = await s.transaction();
  try {
    for (const c of cambiosTipo) {
      await s.query(`UPDATE "${S}".bookings SET event_type_id = $1, updated_at = NOW() WHERE id = $2 AND event_type_id = $3`,
        { bind: [c.tipoId, c.id, tipoImportado.id], transaction: t });
    }
    for (const c of cambiosCobro) {
      await s.query(
        `UPDATE "${S}".bookings SET cobro_modo = 'cuota', cobro_concept_id = $1, cobro_texto = $2, cobro_importe = $3, updated_at = NOW() WHERE id = $4`,
        { bind: [c.concepto.id, String(c.concepto.name).slice(0, 200), Math.round((Number(c.concepto.unit_price) || 0) * 100), c.id], transaction: t }
      );
    }
    for (const e of enlaces) {
      await s.query(`UPDATE "${S}".event_types SET concept_id = $1, updated_at = NOW() WHERE id = $2 AND concept_id IS NULL`, { bind: [e.concepto.id, e.tipo.id], transaction: t });
    }
    await t.commit();
  } catch (err) {
    await t.rollback();
    throw err;
  }
  const [{ con_cobro, importadas }] = await q(
    `SELECT count(*) FILTER (WHERE cobro_modo IS NOT NULL)::int AS con_cobro, count(*) FILTER (WHERE event_type_id = $1)::int AS importadas FROM "${S}".bookings WHERE scheduled_at >= $2`,
    [tipoImportado?.id ?? "00000000-0000-0000-0000-000000000000", DESDE]
  );
  log(`\n  ✓ ${cambiosTipo.length} citas con su tipo, ${cambiosCobro.length} atadas a su cuota${TIPOS ? `, ${enlaces.length} tipos enlazados` : ""}.`);
  log(`  ✓ Desde ${DESDE}: ${con_cobro} citas dicen de qué se cobran; quedan ${importadas} como «${TIPO_IMPORTADO}».\n`);
  await s.close();
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n\n`);
  process.exit(1);
});
