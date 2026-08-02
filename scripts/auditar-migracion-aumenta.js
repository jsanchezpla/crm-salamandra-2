/**
 * auditar-migracion-aumenta.js — ¿llegó todo, y llegó a su sitio?
 *
 * SOLO LECTURA. No escribe nada, nunca. Se puede lanzar contra producción.
 *
 * ── Para qué ───────────────────────────────────────────────────────────────
 *
 * Contar filas no demuestra nada: los tres fallos que aparecieron en esta
 * migración (tutores sin correo, cierres duplicados por la zona horaria, citas
 * futuras marcadas como «realizadas») pasaban TODOS el recuento. Este script
 * compara contra los ficheros de Organízate y comprueba que cada dato esté en
 * el campo que le toca.
 *
 * Cinco bloques:
 *   1. RECUENTOS       — cuánto hay de cada cosa
 *   2. DINERO          — facturas y gastos al céntimo, año por año
 *   3. HUÉRFANOS       — lo que apunta a un sitio vacío
 *   4. COHERENCIA      — lo que es imposible aunque cuadre el total
 *   5. MUESTREO        — 60 registros del origen, verificados uno a uno
 *
 * Termina con un veredicto y sale con código 1 si algo falla, para poder
 * encadenarlo en un despliegue.
 *
 * Uso:
 *   node --env-file=.env.local      scripts/auditar-migracion-aumenta.js
 *   node --env-file=.env.production scripts/auditar-migracion-aumenta.js
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { getTenantDb } from "../lib/db/tenantDb.js";
import { etiquetaDe } from "./_organizate-historial.js";

const args = process.argv.slice(2);
const SLUG = args.includes("--tenant") ? args[args.indexOf("--tenant") + 1] : "aumenta";
const DATOS = (args.includes("--datos") ? args[args.indexOf("--datos") + 1] : null) || "C:/Claude Code/migracion-aumenta";

const norm = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
const cap = (s) => String(s ?? "").trim();
const cent = (s) => {
  const t = String(s ?? "").replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const v = parseFloat(t);
  return isNaN(v) ? 0 : Math.round(v * 100);
};
const fechaOrg = (s) => {
  const m = String(s ?? "").trim().match(/^(\d{2})\/(\d{2})\/(\d{2,4})$/);
  if (!m) return null;
  return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[2]}-${m[1]}`;
};
const eur = (c) => (c / 100).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const DOBLES = { 122: 121, 250: 249, 372: 371, 167: 166 };

// ── Marcador ───────────────────────────────────────────────────────────────
const fallos = [];
const avisos = [];
function ok(t, detalle = "") { console.log(`  ✓ ${t}${detalle ? `   ${detalle}` : ""}`); }
function mal(t, detalle = "") { console.log(`  ✗ ${t}${detalle ? `   ${detalle}` : ""}`); fallos.push(t); }
function ojo(t, detalle = "") { console.log(`  ⚠ ${t}${detalle ? `   ${detalle}` : ""}`); avisos.push(t); }
/** Compara dos números y marca según coincidan. */
function comparar(titulo, esperado, real, { tolerancia = 0, aviso = false } = {}) {
  const dif = Math.abs(esperado - real);
  if (dif <= tolerancia) return ok(titulo, `${real}`);
  const txt = `esperaba ${esperado}, hay ${real}   (${real > esperado ? "+" : ""}${real - esperado})`;
  return aviso ? ojo(titulo, txt) : mal(titulo, txt);
}
const titulo = (t) => console.log(`\n── ${t} ${"─".repeat(Math.max(0, 58 - t.length))}\n`);

async function main() {
  console.log(`\n${"═".repeat(64)}`);
  console.log(` AUDITORÍA DE LA MIGRACIÓN → tenant "${SLUG}"   (solo lectura)`);
  console.log(`${"═".repeat(64)}`);

  // ── Origen ──────────────────────────────────────────────────────────────
  const leer = (n) => JSON.parse(readFileSync(path.join(DATOS, n), "utf8"));
  const fichas = leer("pacientes-limpio.json").fichas;
  const conta = leer("organizate-contabilidad.json");
  const citasSrc = leer("organizate-citas.json");
  const historiales = leer("organizate-historiales.json").historiales;
  const tratamientos = leer("organizate-tratamientos.json").bloques
    .find((b) => b.clave === "s6_tratamientos")?.filas ?? [];

  const bloque = (c) => conta.bloques.find((b) => b.clave === c);
  const gastosSrc = bloque("gastos_TODO")?.filas ?? [];
  const cierresSrc = bloque("cierres_TODO")?.filas ?? [];
  const facturasSrc = conta.bloques.filter((b) => /^facturas_\d{4}$/.test(b.clave)).flatMap((b) => b.filas);

  const { models: m, sequelize } = getTenantDb(SLUG);
  const esquema = `crm_${SLUG}`;
  const q = async (sql, bind) => (await sequelize.query(sql, bind ? { bind } : undefined))[0];
  const uno = async (sql, bind) => (await q(sql, bind))[0];

  // ═══ 1. RECUENTOS ════════════════════════════════════════════════════════
  titulo("1. RECUENTOS");

  const pacientesEsperados = fichas.filter((f) => !DOBLES[Number(f.id_pac)]).length;
  const c = await uno(`
    SELECT (SELECT count(*) FROM ${esquema}.clients)                AS clientes,
           (SELECT count(*) FROM ${esquema}.clients WHERE status='inactive') AS inactivos,
           (SELECT count(*) FROM ${esquema}.clients WHERE type='company')    AS empresas,
           (SELECT count(*) FROM ${esquema}.patients)               AS pacientes,
           (SELECT count(*) FROM ${esquema}.invoices)               AS facturas,
           (SELECT count(*) FROM ${esquema}.costs)                  AS gastos,
           (SELECT count(*) FROM ${esquema}.suppliers)              AS proveedores,
           (SELECT count(*) FROM ${esquema}.cash_closes)            AS cierres,
           (SELECT count(*) FROM ${esquema}.bookings)               AS citas,
           (SELECT count(*) FROM ${esquema}.event_types)            AS tipos,
           (SELECT count(*) FROM ${esquema}.clinic_sessions)        AS sesiones,
           (SELECT count(*) FROM ${esquema}.taller_inscripciones)   AS inscripciones
  `);
  const tut = await uno(`
    SELECT sum(jsonb_array_length(guardians))::int AS total,
           (SELECT count(*) FROM ${esquema}.clients cl, jsonb_array_elements(cl.guardians) g
              WHERE jsonb_typeof(cl.guardians)='array' AND coalesce(g->>'email','') <> '')::int AS con_email
    FROM ${esquema}.clients WHERE jsonb_typeof(guardians)='array'
  `);

  comparar("Pacientes (fichas de Organízate menos las 4 dobles)", pacientesEsperados, Number(c.pacientes));
  ok("Clientes", `${c.clientes}   (${c.inactivos} inactivos · ${c.empresas} empresa)`);
  ok("Tutores", `${tut.total}   (${tut.con_email} con correo)`);
  comparar("Gastos", gastosSrc.length, Number(c.gastos));
  comparar("Cierres de caja", cierresSrc.length, Number(c.cierres));
  comparar("Tipos de cita", tratamientos.filter((t) => cap(t[1])).length, Number(c.tipos), { aviso: true });
  ok("Facturas", `${c.facturas}   (${facturasSrc.length} en Organízate)`);
  ok("Proveedores", `${c.proveedores}`);
  ok("Citas", `${c.citas}`);
  ok("Sesiones clínicas", `${c.sesiones}`);
  ok("Inscripciones al taller", `${c.inscripciones}`);

  // ═══ 2. DINERO ═══════════════════════════════════════════════════════════
  titulo("2. DINERO, AÑO POR AÑO (contra Organízate, al céntimo)");

  const porAnio = (filas, iFecha, iImporte) => {
    const mapa = new Map();
    for (const f of filas) {
      const fe = fechaOrg(f[iFecha]);
      if (!fe) continue;
      const a = fe.slice(0, 4);
      mapa.set(a, (mapa.get(a) ?? 0) + cent(f[iImporte]));
    }
    return mapa;
  };

  for (const [que, tabla, col, fecha, src] of [
    ["Facturado", "invoices", "total", "issue_date", porAnio(facturasSrc, 2, 4)],
    ["Gastado", "costs", "tax_base", "incurred_at", porAnio(gastosSrc, 1, 4)],
  ]) {
    const crm = new Map((await q(`
      SELECT to_char(${fecha}, 'YYYY') AS anio, round(sum(${col}) * 100)::bigint AS cents
      FROM ${esquema}.${tabla} GROUP BY 1 ORDER BY 1
    `)).map((r) => [r.anio, Number(r.cents)]));

    let totalSrc = 0, totalCrm = 0, cuadranTodos = true;
    const anios = [...new Set([...src.keys(), ...crm.keys()])].sort();
    console.log(`  ${que}:`);
    for (const a of anios) {
      const s = src.get(a) ?? 0, r = crm.get(a) ?? 0;
      totalSrc += s; totalCrm += r;
      if (s !== r) cuadranTodos = false;
      console.log(`     ${a}   Organízate ${eur(s).padStart(14)}   CRM ${eur(r).padStart(14)}   ${s === r ? "=" : `✗ ${eur(r - s)}`}`);
    }
    if (totalSrc === totalCrm && cuadranTodos) ok(`${que}: cuadra año a año`, eur(totalCrm));
    else if (totalSrc === totalCrm) ojo(`${que}: el total cuadra pero algún año no`, eur(totalCrm));
    else mal(`${que}: NO cuadra`, `Organízate ${eur(totalSrc)} · CRM ${eur(totalCrm)} · diferencia ${eur(totalCrm - totalSrc)}`);
  }

  // Descuadres de caja: Organízate solo guarda el importe cuando hubo descuadre,
  // y los hay a favor y en contra. Se comparan las DOS medidas, porque cada una
  // esconde un fallo distinto: la suma con signo no vería dos descuadres
  // intercambiados, y la suma de valores absolutos no vería un signo al revés.
  const descSrc = cierresSrc.filter((f) => f.some((x) => /€/.test(String(x))));
  const centsSrc = descSrc.map((f) => cent(f.find((x) => /€/.test(String(x)))));
  const absSrc = centsSrc.reduce((a, v) => a + Math.abs(v), 0);
  const netoSrc = centsSrc.reduce((a, v) => a + v, 0);
  const desc = await uno(`
    SELECT count(*)::int AS n,
           coalesce(round(sum(abs(difference)) * 100), 0)::bigint AS abs_cents,
           coalesce(round(sum(difference) * 100), 0)::bigint      AS neto_cents
    FROM ${esquema}.cash_closes WHERE difference <> 0
  `);
  console.log("");
  comparar("Cierres con descuadre", descSrc.length, Number(desc.n));
  comparar("Descuadre en valor absoluto (céntimos)", absSrc, Number(desc.abs_cents));
  comparar("Descuadre neto (céntimos)", netoSrc, Number(desc.neto_cents));

  // ═══ 3. HUÉRFANOS ════════════════════════════════════════════════════════
  titulo("3. HUÉRFANOS (apuntan a algo que no existe, o a nada)");

  const huerfanos = [
    ["Pacientes sin familia", `SELECT count(*)::int n FROM ${esquema}.patients WHERE client_id IS NULL`],
    ["Facturas sin cliente", `SELECT count(*)::int n FROM ${esquema}.invoices WHERE client_id IS NULL`],
    ["Facturas apuntando a un cliente inexistente", `SELECT count(*)::int n FROM ${esquema}.invoices i LEFT JOIN ${esquema}.clients cl ON cl.id=i.client_id WHERE i.client_id IS NOT NULL AND cl.id IS NULL`],
    ["Citas sin paciente", `SELECT count(*)::int n FROM ${esquema}.bookings WHERE patient_id IS NULL`],
    ["Citas apuntando a un tipo inexistente", `SELECT count(*)::int n FROM ${esquema}.bookings b LEFT JOIN ${esquema}.event_types e ON e.id=b.event_type_id WHERE e.id IS NULL`],
    ["Sesiones sin paciente", `SELECT count(*)::int n FROM ${esquema}.clinic_sessions WHERE patient_id IS NULL`],
    ["Sesiones apuntando a un paciente inexistente", `SELECT count(*)::int n FROM ${esquema}.clinic_sessions s LEFT JOIN ${esquema}.patients p ON p.id=s.patient_id WHERE s.patient_id IS NOT NULL AND p.id IS NULL`],
    ["Gastos apuntando a un proveedor inexistente", `SELECT count(*)::int n FROM ${esquema}.costs c LEFT JOIN ${esquema}.suppliers s ON s.id=c.supplier_id WHERE c.supplier_id IS NOT NULL AND s.id IS NULL`],
    ["Cierres sin caja", `SELECT count(*)::int n FROM ${esquema}.cash_closes cc LEFT JOIN ${esquema}.cash_points cp ON cp.id=cc.cash_point_id WHERE cp.id IS NULL`],
    ["Inscripciones sin paciente", `SELECT count(*)::int n FROM ${esquema}.taller_inscripciones ti LEFT JOIN ${esquema}.patients p ON p.id=ti.patient_id WHERE p.id IS NULL`],
  ];
  for (const [t, sql] of huerfanos) {
    const n = Number((await uno(sql)).n);
    n === 0 ? ok(t, "0") : mal(t, String(n));
  }

  // ═══ 4. COHERENCIA ═══════════════════════════════════════════════════════
  titulo("4. COHERENCIA (imposibles que un recuento no ve)");

  const coh = await uno(`
    SELECT
      (SELECT count(*) FROM ${esquema}.bookings WHERE scheduled_at > now() AND status='completed')                    AS futuras_realizadas,
      (SELECT count(*) FROM ${esquema}.invoices WHERE status <> 'paid')                                              AS sin_cobrar,
      (SELECT count(*) FROM ${esquema}.invoices WHERE round(paid_amount::numeric,2) <> round(total::numeric,2))       AS cobro_parcial,
      (SELECT count(*) FROM (SELECT number FROM ${esquema}.invoices GROUP BY number HAVING count(*)>1) x)             AS numeros_repetidos,
      (SELECT count(*) FROM ${esquema}.clinic_sessions WHERE jsonb_typeof(objectives) <> 'array')                     AS objetivos_no_lista,
      -- Sin NADA escrito: ni actividad, ni desempeño, ni tareas para casa. Las
      -- tareas cuentan: hay 520 sesiones cuyo único texto es ese bloque.
      (SELECT count(*) FROM ${esquema}.clinic_sessions
        WHERE coalesce(activities,'')='' AND coalesce(performance,'')=''
          AND coalesce(observations->>'homeworkTasks','')='') AS sesiones_vacias,
      (SELECT count(*) FROM ${esquema}.clinic_sessions WHERE coalesce(observations->>'textoOriginal','')='')          AS sin_texto_original,
      (SELECT count(*) FROM ${esquema}.patients WHERE coalesce(first_name,'')='' OR coalesce(last_name,'')='')        AS pacientes_sin_nombre,
      (SELECT count(*) FROM ${esquema}.clients WHERE email IS NOT NULL AND email !~ '^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$') AS emails_torcidos,
      (SELECT count(*) FROM (SELECT lower(email) e FROM ${esquema}.clients WHERE email IS NOT NULL GROUP BY 1 HAVING count(*)>1) x) AS emails_repetidos,
      -- Solo los cierres HECHOS EN EL CRM: en los importados los tres importes
      -- valen 0 a propósito (Organízate no guarda ni lo esperado ni lo contado,
      -- solo el descuadre), así que exigirles la resta marcaría los 12 buenos.
      (SELECT count(*) FROM ${esquema}.cash_closes
        WHERE (opening_amount <> 0 OR expected_amount <> 0 OR counted_amount <> 0)
          AND difference <> round((counted_amount - expected_amount)::numeric, 2)) AS descuadre_mal_calculado
  `);
  const cero = [
    ["Citas futuras marcadas «realizadas»", coh.futuras_realizadas],
    ["Facturas sin cobrar (Rodrigo las quiso todas cobradas)", coh.sin_cobrar],
    ["Facturas con el cobro descuadrado", coh.cobro_parcial],
    ["Números de factura repetidos", coh.numeros_repetidos],
    ["Sesiones con `objectives` que no es una lista", coh.objetivos_no_lista],
    ["Sesiones sin actividad, ni desempeño, ni tareas", coh.sesiones_vacias],
    ["Sesiones sin el texto original guardado", coh.sin_texto_original],
    ["Pacientes sin nombre o sin apellidos", coh.pacientes_sin_nombre],
    ["Correos de ficha con formato inválido", coh.emails_torcidos],
    ["Cierres con el descuadre mal calculado", coh.descuadre_mal_calculado],
  ];
  for (const [t, n] of cero) Number(n) === 0 ? ok(t, "0") : mal(t, String(n));
  Number(coh.emails_repetidos) === 0
    ? ok("Correos de ficha repetidos entre familias", "0")
    : ojo("Correos de ficha repetidos entre familias", `${coh.emails_repetidos}   (dos familias entrarían al mismo portal)`);

  // Una familia partida en dos. Pasó con 26: el NIF de la madre estaba tecleado
  // «49.005.048-Y» en la ficha de un hermano y «49005048Y» en la del otro, y
  // como el NIF es la clave con la que se agrupa, salieron dos familias con los
  // pacientes y las facturas repartidos entre las dos mitades.
  const partidas = await q(`
    SELECT regexp_replace(upper(tax_id), '[^A-Z0-9]', '', 'g') AS nif, count(*)::int n
    FROM ${esquema}.clients WHERE tax_id IS NOT NULL
    GROUP BY 1 HAVING count(*) > 1
  `);
  partidas.length === 0
    ? ok("Familias partidas en dos por el formato del NIF", "0")
    : mal("Familias partidas en dos por el formato del NIF", `${partidas.length} NIF repetidos · ${partidas.reduce((a, x) => a + x.n - 1, 0)} fichas de más`);

  // Dos tutores casi idénticos dentro de la MISMA familia: casi siempre es la
  // misma persona tecleada dos veces en Organízate («ALMENDROS»/«ALMEDROS»).
  //
  // Va como AVISO y no como fallo, y no se arregla solo a propósito: entre los
  // casos hay parejas que NO son la misma persona —«ANGEL ROCANO PEREZ» y
  // «ANGEL ROCANO LOPEZ» pueden ser el padre y el abuelo—, y fundir a dos
  // familiares de un menor por parecido sería peor que dejarlos separados.
  const cerca = (a, b, max = 3) => {
    if (Math.abs(a.length - b.length) > max) return false;
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 0; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++)
      for (let j = 1; j <= b.length; j++)
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length] <= max;
  };
  const conTutores = await q(`SELECT name, guardians FROM ${esquema}.clients WHERE jsonb_array_length(guardians) > 1`);
  let parecidos = 0;
  for (const cl of conTutores) {
    const g = (cl.guardians ?? []).map((x) => norm(x.name)).filter(Boolean);
    for (let i = 0; i < g.length; i++)
      for (let j = i + 1; j < g.length; j++)
        if (g[i] !== g[j] && cerca(g[i], g[j])) parecidos++;
  }
  parecidos === 0
    ? ok("Tutores casi idénticos en la misma familia", "0")
    : ojo("Tutores casi idénticos en la misma familia", `${parecidos} pareja(s) · erratas de Organízate, las revisa Aumenta`);

  // Las citas importadas deben caer en el futuro: son el curso que viene.
  const rango = await uno(`
    SELECT min(scheduled_at)::date AS desde, max(scheduled_at)::date AS hasta,
           count(*) FILTER (WHERE scheduled_at < now())::int AS pasadas
    FROM ${esquema}.bookings
  `);
  ok("Periodo de la agenda", `${rango.desde} → ${rango.hasta}   (${rango.pasadas} ya pasadas)`);

  const sesRango = await uno(`SELECT min(session_date)::date d, max(session_date)::date h FROM ${esquema}.clinic_sessions`);
  ok("Periodo de las sesiones", `${sesRango.d} → ${sesRango.h}`);

  // ═══ 5. MUESTREO CRUZADO ═════════════════════════════════════════════════
  titulo("5. MUESTREO: 60 registros del origen, buscados uno a uno");

  // Muestra determinista (uno de cada N) para que dos ejecuciones comparen lo
  // mismo: si algo falla, se puede repetir el examen exacto.
  const muestra = (arr, n) => {
    const paso = Math.max(1, Math.floor(arr.length / n));
    return arr.filter((_, i) => i % paso === 0).slice(0, n);
  };

  // 5.1 Pacientes: nombre + apellidos deben existir en el CRM.
  let faltan = 0; const ejemplos = [];
  for (const f of muestra(fichas.filter((x) => !DOBLES[Number(x.id_pac)]), 20)) {
    const r = await uno(
      `SELECT count(*)::int n FROM ${esquema}.patients WHERE upper(unaccent_es(first_name || ' ' || last_name)) = $1`,
      [norm(`${f.nombre} ${f.apellidos}`)]
    ).catch(() => null);
    // `unaccent` puede no estar instalada: se cae a comparar sin acentos en JS.
    if (r === null) {
      const todos = await q(`SELECT first_name, last_name FROM ${esquema}.patients`);
      const set = new Set(todos.map((p) => norm(`${p.first_name} ${p.last_name}`)));
      if (!set.has(norm(`${f.nombre} ${f.apellidos}`))) { faltan++; ejemplos.push(`${f.nombre} ${f.apellidos}`); }
      continue;
    }
    if (Number(r.n) === 0) { faltan++; ejemplos.push(`${f.nombre} ${f.apellidos}`); }
  }
  faltan === 0
    ? ok("20 pacientes del origen: todos están en el CRM")
    : mal("Pacientes del origen que no aparecen", `${faltan}/20 · p.ej. ${ejemplos.slice(0, 3).join(" · ")}`);

  // 5.2 Facturas: número + importe + fecha, exactos.
  let malas = 0; const malEj = [];
  for (const f of muestra(facturasSrc, 20)) {
    const numero = cap(f[1]);
    if (!numero) continue;
    const r = await uno(
      `SELECT round(total * 100)::bigint cents, issue_date::text f FROM ${esquema}.invoices WHERE number = $1`,
      [numero]
    );
    if (!r) { malas++; malEj.push(`${numero} no está`); continue; }
    if (Number(r.cents) !== cent(f[4])) { malas++; malEj.push(`${numero} importe ${eur(Number(r.cents))} ≠ ${eur(cent(f[4]))}`); continue; }
    if (r.f !== fechaOrg(f[2])) { malas++; malEj.push(`${numero} fecha ${r.f} ≠ ${fechaOrg(f[2])}`); }
  }
  malas === 0
    ? ok("20 facturas del origen: número, importe y fecha exactos")
    : mal("Facturas que no coinciden", `${malas}/20 · ${malEj.slice(0, 3).join(" · ")}`);

  // 5.3 Citas futuras: fecha y hora deben existir tal cual.
  const hoy = new Date().toISOString().slice(0, 10);
  const futuras = citasSrc.citas.filter((x) => x.fecha > hoy);
  let sinCita = 0; const citaEj = [];
  for (const cita of muestra(futuras, 20)) {
    const r = await uno(
      `SELECT count(*)::int n FROM ${esquema}.bookings WHERE scheduled_at::date = $1::date`,
      [cita.fecha]
    );
    if (Number(r.n) === 0) { sinCita++; citaEj.push(cita.fecha); }
  }
  sinCita === 0
    ? ok("20 días con cita en el origen: todos tienen citas en el CRM")
    : mal("Días del origen sin ninguna cita en el CRM", `${sinCita}/20 · ${citaEj.slice(0, 3).join(" · ")}`);

  // 5.4 Sesiones: contra las entradas ETIQUETADAS «Sesión» en el historial.
  //
  // Ojo con la medida: contar «entradas donde aparece la palabra sesión» da 752
  // de más —actas de coordinación, citas y adjuntos que la mencionan de pasada—
  // y ese fue exactamente el fallo del primer importador. La cuenta buena es
  // por etiqueta. Se admite una merma pequeña: hay entradas sin fecha legible o
  // de un paciente que no se pudo cruzar.
  let sesionesSrc = 0, otras = 0;
  for (const h of historiales) for (const e of h.entradas ?? []) {
    if (etiquetaDe(e.txt) === "Sesión") sesionesSrc++;
    else if (/\bSesi[óo]n\b/i.test(e.txt)) otras++;
  }
  const dif = Number(c.sesiones) - sesionesSrc;
  if (dif > 0) mal("Hay MÁS sesiones que entradas de sesión en el origen", `${c.sesiones} vs ${sesionesSrc} (+${dif}) · ${otras} entradas de otro tipo mencionan la palabra «sesión»`);
  else if (Math.abs(dif) <= sesionesSrc * 0.02) ok("Sesiones clínicas: cuadra con el origen", `${c.sesiones} de ${sesionesSrc} entradas etiquetadas «Sesión» (${dif})`);
  else mal("Faltan sesiones respecto al origen", `${c.sesiones} de ${sesionesSrc} (${dif})`);

  // ═══ VEREDICTO ═══════════════════════════════════════════════════════════
  console.log(`\n${"═".repeat(64)}`);
  if (!fallos.length && !avisos.length) console.log(" ✅ TODO CORRECTO. Nada que reprochar.");
  else {
    if (fallos.length) {
      console.log(` ❌ ${fallos.length} FALLO(S):`);
      for (const f of fallos) console.log(`     · ${f}`);
    }
    if (avisos.length) {
      console.log(` ⚠️  ${avisos.length} aviso(s) — a mirar, no necesariamente un error:`);
      for (const a of avisos) console.log(`     · ${a}`);
    }
  }
  console.log(`${"═".repeat(64)}\n`);
  process.exit(fallos.length ? 1 : 0);
}

main().catch((e) => {
  console.error("\n✖ La auditoría se ha caído:", e.message);
  process.exit(2);
});
