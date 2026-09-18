// @vivo — pone Activo / En pausa / Baja a pacientes y familias de UN tenant por su actividad; se relanza a mano cada curso.
/**
 * estados-por-actividad.js — Activo, En pausa o Baja a cada paciente y a cada
 * familia de un centro, por lo que ha pasado con ellos (15/09/2026, Rodrigo).
 *
 * La regla, con su porqué, en `lib/clients/estadoPorActividad.js`:
 *   · Activo   — cita no cancelada o sesión desde el 1 de septiembre del curso
 *                en marcha (una futura también), o una cuota vigente.
 *   · En pausa — lo último (cita, sesión, cobro completado o factura
 *                emitida) fue en el curso pasado.
 *   · Baja     — nada de eso desde antes del curso pasado.
 *
 * NO BORRA NADA. Solo cambia `patients.status` y `clients.status`. Las
 * facturas, cobros, citas y sesiones se quedan donde están y siguen saliendo
 * en la ficha; lo único que cambia es que Morosidad deja de contar a quien no
 * está activo (`entraEnMorosidad`, lib/billing/morosidad.js).
 *
 * De quién es cada cosa:
 *   · Lo que lleva `patient_id` es de ese paciente.
 *   · Lo que va a nombre de la familia sin paciente cuenta para la FAMILIA, y
 *     para el paciente solo si es hijo único (con hermanos no se adivina de
 *     cuál es, la misma regla que Morosidad).
 *   · Una cuota sin paciente es de todos los hijos de la familia.
 *   · La familia toma el estado más vivo entre sus pacientes y lo suyo.
 *   · Una ficha en `prospect` (el «No vino» que se quitó el 15/09/2026) se
 *     trata como las demás. No lo lances sobre un centro con tienda: allí
 *     `prospect` es «compró una vez» y la regla no aplica.
 *   · Quien está en la COLA DE ADMISIÓN se queda En pausa y nunca de Baja
 *     (18/09/2026, AV-0177): no tiene citas porque aún no le hemos dado hora.
 *   · Y tampoco la ficha ABIERTA ESTE CURSO: acaba de entrar, no se ha ido.
 *
 * Ensayo por defecto: cuenta cuántos cambiarían, sin nombres. `--confirm`
 * escribe en UNA transacción, y ANTES deja en `RESPALDO_DIR` (defecto /tmp) un
 * JSON con el estado anterior de cada fila tocada, para deshacerlo con
 * `--deshacer <fichero>`. Una fila de auditoría con el resumen.
 *
 * Uso VPS: docker exec crm-salamandra-app-1 node scripts/estados-por-actividad.js aumenta [--confirm]
 *          docker exec crm-salamandra-app-1 node scripts/estados-por-actividad.js aumenta --deshacer /tmp/x.json --confirm
 */

import { readFileSync, writeFileSync } from "node:fs";
import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { estadoPorActividad, elMasVivo, sube, inicioDelCurso, inicioDelCursoAnterior } from "../lib/clients/estadoPorActividad.js";
import { auditar } from "../lib/utils/auditoria.js";

const args = process.argv.slice(2);
const SLUG = args.find((a) => !a.startsWith("--") && !a.endsWith(".json"));
const CONFIRMAR = args.includes("--confirm");
/*
 * `--solo-subir` (18/09/2026): aplica SOLO lo que mejora de estado —de Baja a
 * En pausa, de En pausa a Activo—. Sirve para arreglar a quien está peor de lo
 * que le toca (los de la cola de admisión de AV-0177) sin bajar de Activo, de
 * paso, a trece fichas que nadie ha mirado hoy. Bajar es otra decisión y se
 * toma lanzándolo sin esta opción.
 */
const SOLO_SUBIR = args.includes("--solo-subir");
const iDeshacer = args.indexOf("--deshacer");
const DESHACER = iDeshacer >= 0 ? args[iDeshacer + 1] : null;
const out = (m = "") => process.stdout.write(`${m}\n`);

if (!SLUG || !/^[a-z0-9_]+$/.test(SLUG)) {
  out("Uso: node scripts/estados-por-actividad.js <slug> [--confirm] [--deshacer fichero.json]");
  process.exit(1);
}

const db = getMasterDb();
const S = `"crm_${SLUG}"`;
const q = (sql, replacements = {}, transaction) => db.query(sql, { type: "SELECT", replacements, transaction });
const hay = async (tabla) => (await q(`SELECT to_regclass(:t) IS NOT NULL AS hay`, { t: `crm_${SLUG}.${tabla}` }))[0].hay;

async function aplicar(tabla, grupos, t) {
  for (const [estado, ids] of Object.entries(grupos)) {
    for (let i = 0; i < ids.length; i += 500) {
      await db.query(`UPDATE ${S}.${tabla} SET status = :estado, updated_at = now() WHERE id IN (:ids)`, {
        replacements: { estado, ids: ids.slice(i, i + 500) },
        transaction: t,
      });
    }
  }
}

function agrupar(cambios) {
  const g = {};
  for (const c of cambios) (g[c.a] ??= []).push(c.id);
  return g;
}

function contar(cambios, titulo) {
  const m = new Map();
  for (const c of cambios) m.set(`${c.de} → ${c.a}`, (m.get(`${c.de} → ${c.a}`) ?? 0) + 1);
  out(`  ${titulo}: ${cambios.length} cambian`);
  for (const [k, n] of [...m].sort()) out(`    ${k}: ${n}`);
}

async function deshacer() {
  const r = JSON.parse(readFileSync(DESHACER, "utf8"));
  if (r.slug !== SLUG) throw new Error(`El respaldo es de ${r.slug}, no de ${SLUG}`);
  const vuelta = (filas) => agrupar(filas.map((f) => ({ id: f.id, a: f.de })));
  out(`Deshacer ${DESHACER}: ${r.pacientes.length} pacientes y ${r.familias.length} familias vuelven a su estado anterior.`);
  if (!CONFIRMAR) return out("Ensayo: nada escrito. Añade --confirm.");
  await db.transaction(async (t) => {
    if (r.pacientes.length) await aplicar("patients", vuelta(r.pacientes), t);
    if (r.familias.length) await aplicar("clients", vuelta(r.familias), t);
  });
  out("✓ Deshecho.");
}

async function main() {
  if (DESHACER) return deshacer();

  const hoy = new Date();
  const inicio = inicioDelCurso(hoy);
  out(`\n${SLUG} · curso en marcha desde ${inicio}, anterior desde ${inicioDelCursoAnterior(hoy)}`);
  out(CONFIRMAR ? "MODO ESCRITURA" : "ENSAYO (no escribe nada)");
  out(SOLO_SUBIR ? "SOLO SUBIR: no se baja de estado a nadie\n" : "");

  const conPacientes = await hay("patients");
  const conSesiones = await hay("clinic_sessions");
  const conCuotas = await hay("billing_cuotas");
  const hoyTxt = hoy.toISOString().slice(0, 10);

  // Las familias que ESPERAN PLAZA (AV-0177): su entrada sigue viva en la cola
  // de admisión. Sin `clients_avanzado` la tabla puede no existir en el schema.
  const esperando = new Set();
  if (await hay("waitlist_entries")) {
    const filas = await q(`SELECT DISTINCT client_id FROM ${S}.waitlist_entries WHERE status::text = 'active' AND client_id IS NOT NULL`);
    for (const f of filas) esperando.add(String(f.client_id));
  }
  out(`  En la cola de admisión: ${esperando.size} familia(s) — se quedan En pausa, no de Baja.`);

  // Lo último a nombre de cada FAMILIA sin paciente concreto.
  const sinPac = (alias) => (conPacientes ? `AND ${alias}.patient_id IS NULL` : "");
  const familias = await q(`
    SELECT c.id, c.status::text AS status, c.created_at::text AS alta,
      (SELECT max(b.scheduled_at) FROM ${S}.bookings b WHERE b.client_id = c.id ${sinPac("b")} AND b.status::text <> 'cancelled')::text AS cita,
      greatest(
        (SELECT max(p.paid_at) FROM ${S}.payments p WHERE p.client_id = c.id ${sinPac("p")} AND p.status::text = 'completed'),
        (SELECT max(i.issue_date)::timestamptz FROM ${S}.invoices i WHERE i.client_id = c.id ${sinPac("i")} AND i.status::text IN ('issued','sent','paid','partially_paid','overdue'))
      )::text AS dinero,
      ${conCuotas ? `EXISTS (SELECT 1 FROM ${S}.billing_cuotas q WHERE (q.client_id = c.id OR q.payer_client_id = c.id) ${conPacientes ? "AND q.patient_id IS NULL" : ""} AND q.active AND (q.end_date IS NULL OR q.end_date >= :hoy))` : "false"} AS cuota
    FROM ${S}.clients c`, { hoy: hoyTxt });

  let pacientes = [];
  if (conPacientes) {
    pacientes = await q(`
      SELECT pa.id, pa.client_id, pa.status::text AS status, pa.created_at::text AS alta,
        (SELECT count(*) FROM ${S}.patients h WHERE h.client_id = pa.client_id)::int AS hermanos,
        greatest(
          (SELECT max(b.scheduled_at) FROM ${S}.bookings b WHERE b.patient_id = pa.id AND b.status::text <> 'cancelled')
          ${conSesiones ? `, (SELECT max(cs.session_date)::timestamptz FROM ${S}.clinic_sessions cs WHERE cs.patient_id = pa.id)` : ""}
        )::text AS cita,
        greatest(
          (SELECT max(p.paid_at) FROM ${S}.payments p WHERE p.patient_id = pa.id AND p.status::text = 'completed'),
          (SELECT max(i.issue_date)::timestamptz FROM ${S}.invoices i WHERE i.patient_id = pa.id AND i.status::text IN ('issued','sent','paid','partially_paid','overdue'))
        )::text AS dinero,
        ${conCuotas ? `EXISTS (SELECT 1 FROM ${S}.billing_cuotas q WHERE (q.patient_id = pa.id OR (q.patient_id IS NULL AND q.client_id = pa.client_id)) AND q.active AND (q.end_date IS NULL OR q.end_date >= :hoy))` : "false"} AS cuota
      FROM ${S}.patients pa`, { hoy: hoyTxt });
  }

  const deLaFamilia = new Map(familias.map((f) => [String(f.id), f]));
  const mayor = (a, b) => (!a ? b : !b ? a : a > b ? a : b);

  const estadoPaciente = new Map();
  const cambiosPac = [];
  for (const p of pacientes) {
    const fam = p.client_id ? deLaFamilia.get(String(p.client_id)) : null;
    // Lo de la familia sin paciente cuenta para el hijo único.
    const unico = p.hermanos === 1;
    const nuevo = estadoPorActividad(
      {
        ultimaCita: unico ? mayor(p.cita, fam?.cita) : p.cita,
        ultimoDinero: unico ? mayor(p.dinero, fam?.dinero) : p.dinero,
        cuotaVigente: p.cuota || (unico && fam?.cuota),
        esperandoPlaza: p.client_id ? esperando.has(String(p.client_id)) : false,
        // La ficha del paciente o la de su familia: cualquiera de las dos
        // recién abierta dice que este caso acaba de empezar.
        altaEn: mayor(p.alta, fam?.alta),
      },
      { baja: "discharged", hoy }
    );
    estadoPaciente.set(String(p.id), nuevo);
    if (nuevo !== p.status) cambiosPac.push({ id: p.id, de: p.status, a: nuevo });
  }

  const hijosDe = new Map();
  for (const p of pacientes) {
    if (!p.client_id) continue;
    const k = String(p.client_id);
    if (!hijosDe.has(k)) hijosDe.set(k, []);
    hijosDe.get(k).push(estadoPaciente.get(String(p.id)));
  }

  const cambiosFam = [];
  for (const f of familias) {
    const propio = estadoPorActividad(
      {
        ultimaCita: f.cita,
        ultimoDinero: f.dinero,
        cuotaVigente: f.cuota,
        esperandoPlaza: esperando.has(String(f.id)),
        altaEn: f.alta,
      },
      { baja: "inactive", hoy }
    );
    const deHijos = (hijosDe.get(String(f.id)) ?? []).map((e) => (e === "discharged" ? "inactive" : e));
    const nuevo = elMasVivo([propio, ...deHijos], "inactive");
    if (nuevo !== f.status) cambiosFam.push({ id: f.id, de: f.status, a: nuevo });
  }

  // `--solo-subir`: se descarta lo que empeora DESPUÉS de calcularlo todo, así
  // que el recuento de arriba sigue diciendo lo que saldría del pase entero.
  const soloLasQueSuben = (lista) => (SOLO_SUBIR ? lista.filter((c) => sube(c.de, c.a)) : lista);
  const cambiosPacAplicar = soloLasQueSuben(cambiosPac);
  const cambiosFamAplicar = soloLasQueSuben(cambiosFam);

  const resumenEstados = (filas, mapa) => {
    const m = {};
    for (const f of filas) m[mapa(f)] = (m[mapa(f)] ?? 0) + 1;
    return m;
  };
  out(`  Pacientes: ${pacientes.length} · después: ${JSON.stringify(resumenEstados(pacientes, (p) => estadoPaciente.get(String(p.id))))}`);
  contar(cambiosPac, "Pacientes");
  const finalFam = new Map(cambiosFam.map((c) => [String(c.id), c.a]));
  out(`  Familias: ${familias.length} · después: ${JSON.stringify(resumenEstados(familias, (f) => finalFam.get(String(f.id)) ?? f.status))}`);
  contar(cambiosFam, "Familias");

  if (SOLO_SUBIR) {
    out(`\n  Con --solo-subir se aplican ${cambiosPacAplicar.length} paciente(s) y ${cambiosFamAplicar.length} familia(s); el resto se queda como está.`);
    contar(cambiosPacAplicar, "Pacientes que suben");
    contar(cambiosFamAplicar, "Familias que suben");
  }

  if (!CONFIRMAR) {
    out("\nEnsayo: nada escrito. Añade --confirm para aplicarlo.");
    return;
  }

  const fichero = `${process.env.RESPALDO_DIR || "/tmp"}/estados-por-actividad-${SLUG}-${Date.now()}.json`;
  writeFileSync(
    fichero,
    JSON.stringify({ slug: SLUG, fecha: hoy.toISOString(), pacientes: cambiosPacAplicar, familias: cambiosFamAplicar })
  );
  out(`\nRespaldo del estado anterior: ${fichero}`);

  await db.transaction(async (t) => {
    if (cambiosPacAplicar.length) await aplicar("patients", agrupar(cambiosPacAplicar), t);
    if (cambiosFamAplicar.length) await aplicar("clients", agrupar(cambiosFamAplicar), t);
  });

  const { Tenant } = getMasterModels();
  const tenant = await Tenant.findOne({ where: { slug: SLUG }, attributes: ["id"] });
  await auditar({
    tenantId: tenant?.id ?? null,
    userId: null,
    action: "client.estados_por_actividad",
    entity: "clients",
    entityId: null,
    after: {
      curso: inicio,
      pacientes: cambiosPacAplicar.length,
      familias: cambiosFamAplicar.length,
      soloSubir: SOLO_SUBIR,
      respaldo: fichero,
    },
  });
  out("✓ Escrito.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    process.stderr.write(`\n✗ ${err.message}\n`);
    process.exit(1);
  });
