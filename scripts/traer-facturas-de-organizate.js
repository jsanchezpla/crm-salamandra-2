/**
 * traer-facturas-de-organizate.js — las facturas que el centro sigue emitiendo
 * en Organízate, y el concepto de verdad de las que ya estaban
 * (09/09/2026, AV-0075 y AV-0081 de Aumenta).
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 * Isabel: «no se han pasado todas las facturas de Organízate. Faltan facturas
 * del mes de Septiembre… es importante de cara a que tenemos que tener
 * guardadas todo el histórico». El volcado del 02/08 se paró en julio y el
 * centro ha seguido facturando allí: cobra en el CRM y factura en Organízate.
 *
 * Y Rodrigo, el mismo día: «hay que ir trayéndolas desde Organízate, es que los
 * conceptos no funcionan bien». Lo son: **las 14.243 facturas del volcado
 * tienen una sola línea que dice “Importado de Organízate”**. El concepto real
 * —«1 Sesión semanal de 1 hora de Terapia», «Sesiones de Logopedia»— nunca se
 * trajo, porque se importaron de un listado que no lo enseñaba.
 *
 * ── DE DÓNDE SALE AHORA ────────────────────────────────────────────────────
 * De la exportación a Excel del listado de Facturas de Organízate, que da 17
 * columnas y entre ellas `conceptos` (ver
 * `atar-facturas-al-paciente-de-organizate.js` para cómo se saca). Cada fila:
 *   { numero, fecha, paciente, cif, cliente, concepto, importe, estado }
 * Cuando una factura de allí tenía VARIAS líneas, esa columna las trae pegadas
 * con saltos de línea y sin sus importes, y así entran: una sola línea con el
 * texto entero y el total de la factura (ver `lineasDe` para por qué la ficha
 * de la factura no sirve para separarlas).
 *
 * ── QUÉ HACE, EN SECO POR DEFECTO ──────────────────────────────────────────
 *   · `--conceptos`: a las facturas que YA están y siguen con la línea
 *     «Importado de Organízate», les pone el concepto de verdad. No toca
 *     importes, ni número, ni fecha, ni estado: solo el texto de la línea.
 *   · `--nuevas`: crea las que no están, cruzando la familia por el nombre del
 *     pagador y del paciente (las tres pasadas de siempre) y atando también el
 *     `patient_id`, que ahora sí viene.
 * Sin ninguna de las dos, hace las dos cosas.
 *
 * ── LO QUE SE DECIDIÓ, Y POR QUÉ ───────────────────────────────────────────
 * · **Cada nueva se mira UNA A UNA contra los cobros del CRM** (Rodrigo,
 *   09/09/2026: «revisa una a una que las facturas de septiembre correspondan a
 *   cobros realizados y tráelas al CRM, si no déjalas pendiente de pago»). Si
 *   la familia tiene un cobro COMPLETADO por ese mismo importe cerca de la
 *   fecha, la factura entra `paid` con la fecha de ese cobro; si no, entra
 *   `issued`, o sea emitida y sin pagar. Cada cobro respalda UNA sola factura:
 *   se consume al usarlo, o dos facturas gemelas se apoyarían en el mismo euro.
 *   Ojo: esto es distinto del volcado del 02/08, que las metió todas cobradas
 *   porque en Organízate el 97 % figura impagado y nadie marca allí el cobro.
 * · **El número es el de Organízate** (`C26xxxxx`, `R-C26xxxxx`), no se
 *   renumera. No choca con la serie del CRM: `assignInvoiceNumber` solo mira
 *   los números con la forma `F-2026-…`, así que la correlatividad de la serie
 *   propia no se entera de estas.
 * · **El IVA no se inventa**: Organízate da el total y ya. Se guarda como base
 *   sin impuesto, igual que hizo el volcado.
 *
 * Idempotente por número de factura, y cada fila tocada o creada deja
 * `custom_fields.deOrganizate` con la fecha de la pasada.
 *
 * ── CÓMO SE EJECUTA ────────────────────────────────────────────────────────
 *   docker exec -w /app crm-salamandra-app-1 node \
 *     scripts/traer-facturas-de-organizate.js aumenta \
 *     --datos /tmp/migracion-aumenta/facturas-organizate.json [--detalle]
 *   ... y con --confirm para escribir.
 */

import { readFileSync } from "node:fs";
import { getMasterDb } from "../lib/db/masterDb.js";
import { getTenantDb, closeAllConnections } from "../lib/db/tenantDb.js";
import { auditar } from "../lib/utils/auditoria.js";

const args = process.argv.slice(2);
const CONFIRMAR = args.includes("--confirm");
const DETALLE = args.includes("--detalle");
const DATOS = args.includes("--datos") ? args[args.indexOf("--datos") + 1] : null;
const SLUG = args.find((a) => !a.startsWith("--") && a !== DATOS) ?? "aumenta";
const SOLO_CONCEPTOS = args.includes("--conceptos") && !args.includes("--nuevas");
const SOLO_NUEVAS = args.includes("--nuevas") && !args.includes("--conceptos");
const MARCA = new Date().toISOString().slice(0, 10);

/** La línea que dejó el volcado del 02/08 y que hay que sustituir. */
const LINEA_DEL_VOLCADO = "Importado de Organízate";

const n = (x) => String(x).padStart(6);
const eur = (x) => Number(x ?? 0).toLocaleString("es-ES", { minimumFractionDigits: 2 });

const norm = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9ÑñÇç]+/g, " ")
    .trim()
    .toUpperCase();

/** "01/09/2026" → "2026-09-01". */
const fechaISO = (s) => {
  const m = String(s ?? "").trim().match(/^(\d{2})\/(\d{2})\/(\d{2,4})$/);
  if (!m) return null;
  const a = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${a}-${m[2]}-${m[1]}`;
};

/**
 * Las líneas de una factura tal y como se van a guardar: UNA, con el concepto
 * entero y el total.
 *
 * Cuando la factura de Organízate llevaba varios renglones, la columna
 * `conceptos` los trae pegados con saltos de línea y sin sus importes, y ahí se
 * queda: **repartir el total entre ellos sería inventárselo**. Se intentó
 * sacarlos de la ficha (`facturas_edit`, campos `ls_des[]`/`ls_imp[]`) y no
 * vale: esa pantalla lista también las líneas CANDIDATAS que no están en la
 * factura —van marcadas con `ck_co[]`—, así que barrida a lo bruto suma de más
 * (una factura de 335 € salía de 670). El contenido no se pierde: los renglones
 * van dentro de la descripción, tal cual, y el importe es el de la factura.
 */
function lineasDe(fila, total) {
  const texto = String(fila.concepto ?? "").trim();
  return [{ description: texto || LINEA_DEL_VOLCADO, quantity: 1, unitPrice: total, vatRate: 0 }];
}

if (!DATOS) {
  console.log("Falta --datos <ruta al JSON de la exportación de Organízate>");
  process.exit(1);
}

console.log("═".repeat(64));
console.log(` Facturas de Organízate → ${SLUG}${CONFIRMAR ? "" : "  ·  ENSAYO"}`);
console.log("═".repeat(64));

const fuente = JSON.parse(readFileSync(DATOS, "utf8"));
const filas = fuente.filas ?? fuente;
console.log(`
Organízate: ${filas.length} facturas, extraído ${fuente.extraido ?? "?"}`);

const db = getMasterDb();
const [tenant] = await db.query(`SELECT id, slug FROM master.tenants WHERE slug = :slug`, {
  type: db.QueryTypes.SELECT,
  replacements: { slug: SLUG },
});
if (!tenant) {
  console.log(`No existe el tenant ${SLUG}`);
  process.exit(1);
}

const { models: m, sequelize } = getTenantDb(SLUG);
const esquema = `crm_${SLUG}`;
const q = (sql, opciones = {}) => sequelize.query(sql, { type: sequelize.QueryTypes.SELECT, ...opciones });

// ── Índices para cruzar ─────────────────────────────────────────────────────
const clientes = await q(`SELECT id, name FROM ${esquema}.clients`);
const porFamilia = new Map();
for (const c of clientes) if (!porFamilia.has(norm(c.name))) porFamilia.set(norm(c.name), c.id);

const pacientes = await q(
  `SELECT id, first_name, last_name, client_id FROM ${esquema}.patients WHERE client_id IS NOT NULL`,
);
const familiaDePaciente = new Map();
const pacientePorNombre = new Map();
for (const p of pacientes) {
  const k = norm(`${p.first_name} ${p.last_name}`);
  if (!familiaDePaciente.has(k)) familiaDePaciente.set(k, p.client_id);
  if (!pacientePorNombre.has(k)) pacientePorNombre.set(k, []);
  pacientePorNombre.get(k).push(p);
}

/**
 * Las tres pasadas del volcado —familia, paciente, y la ficha duplicada « 1»—
 * más una cuarta: Organízate a veces guarda el nombre con un solo apellido
 * («MERCEDES GUERRERO» por «MERCEDES GUERRERO FERNÁNDEZ»). Se acepta el nombre
 * corto SOLO si es principio de UNA sola ficha; con dos candidatas se descarta,
 * que es justo lo que separa un atajo de una adivinanza.
 */
const cruzarFamilia = (texto) => {
  const k = norm(texto);
  if (!k) return null;
  if (porFamilia.has(k)) return porFamilia.get(k);
  if (familiaDePaciente.has(k)) return familiaDePaciente.get(k);
  const sinSufijo = k.replace(/\s+1$/, "");
  if (sinSufijo !== k && (porFamilia.has(sinSufijo) || familiaDePaciente.has(sinSufijo))) {
    return porFamilia.get(sinSufijo) ?? familiaDePaciente.get(sinSufijo);
  }
  if (k.split(" ").length < 2) return null;
  const empiezan = new Set();
  for (const [nombre, id] of porFamilia) if (nombre.startsWith(`${k} `)) empiezan.add(id);
  for (const [nombre, id] of familiaDePaciente) if (nombre.startsWith(`${k} `)) empiezan.add(id);
  return empiezan.size === 1 ? [...empiezan][0] : null;
};

const enCrm = new Map();
for (const i of await q(`SELECT id, number, total, lines, patient_id FROM ${esquema}.invoices`)) {
  enCrm.set(norm(i.number), i);
}
console.log(`CRM: ${enCrm.size} facturas\n`);

// ── 1. El concepto de las que ya están ──────────────────────────────────────
const arreglos = [];
if (!SOLO_NUEVAS) {
  for (const f of filas) {
    const inv = enCrm.get(norm(f.numero));
    if (!inv) continue;
    const lineas = Array.isArray(inv.lines) ? inv.lines : [];
    const esDelVolcado = lineas.length === 1 && String(lineas[0]?.description ?? "").trim() === LINEA_DEL_VOLCADO;
    if (!esDelVolcado) continue;
    const nuevas = lineasDe(f, Number(inv.total));
    if (nuevas.length === 1 && nuevas[0].description === LINEA_DEL_VOLCADO) continue;
    // El desglose barrido tiene que sumar el total de la factura, o no se toca.
    const suma = nuevas.reduce((s, l) => s + Number(l.unitPrice ?? 0), 0);
    if (Math.abs(suma - Number(inv.total)) > 0.01) {
      if (DETALLE && arreglos.length < 2000) console.log(`    descuadra ${f.numero}: líneas ${eur(suma)} vs total ${eur(inv.total)}`);
      continue;
    }
    arreglos.push({ id: inv.id, numero: f.numero, lines: nuevas });
  }
  const conVarias = arreglos.filter((a) => a.lines.length > 1).length;
  console.log(`── EL CONCEPTO DE LAS QUE YA ESTÁN ───────────────────────────`);
  console.log(`  con la línea «${LINEA_DEL_VOLCADO}»       ${n([...enCrm.values()].filter((i) => Array.isArray(i.lines) && i.lines.length === 1 && String(i.lines[0]?.description ?? "").trim() === LINEA_DEL_VOLCADO).length)}`);
  console.log(`  se les pone su concepto                   ${n(arreglos.length)}   ${conVarias} con varias líneas`);
}

// ── 2. Las que faltan ───────────────────────────────────────────────────────
const nuevas = [];
const fallos = { sinFamilia: 0, sinFecha: 0 };
const sinFamilia = new Map();
if (!SOLO_CONCEPTOS) {
  for (const f of filas) {
    if (enCrm.has(norm(f.numero))) continue;
    const fecha = fechaISO(f.fecha);
    if (!fecha) {
      fallos.sinFecha++;
      continue;
    }
    const clientId = cruzarFamilia(f.cliente) ?? cruzarFamilia(f.paciente);
    if (!clientId) {
      fallos.sinFamilia++;
      sinFamilia.set(f.numero, f.cliente);
      continue;
    }
    // El paciente, solo si el nombre casa con uno de esa misma familia. Igual
    // que arriba, se acepta el nombre corto si solo un hermano empieza por él.
    const deLaFamilia = pacientes.filter((p) => p.client_id === clientId);
    const clave = norm(f.paciente);
    let candidatos = deLaFamilia.filter((p) => norm(`${p.first_name} ${p.last_name}`) === clave);
    if (!candidatos.length && clave.split(" ").length >= 2) {
      candidatos = deLaFamilia.filter((p) => norm(`${p.first_name} ${p.last_name}`).startsWith(`${clave} `));
    }
    const total = Number(f.importe ?? 0);
    nuevas.push({
      fila: f,
      clientId,
      patientId: candidatos.length === 1 ? candidatos[0].id : null,
      fecha,
      total,
      lines: lineasDe(f, total),
    });
  }
  /*
   * ── Una a una contra los cobros del CRM ─────────────────────────────────
   * Un cobro respalda la factura si es de la MISMA familia, por el MISMO
   * importe y está COMPLETADO cerca de la fecha de emisión (45 días a cada
   * lado: el centro cobra el mes antes o después de facturarlo). Se ordenan
   * por cercanía y **cada cobro se consume**: dos facturas gemelas de la misma
   * familia no pueden apoyarse las dos en el mismo euro.
   */
  const cobros = await q(
    `SELECT id, client_id, amount, paid_at::text AS paid_at
       FROM ${esquema}.payments
      WHERE status = 'completed' AND paid_at IS NOT NULL
        AND paid_at >= (SELECT MIN(x) - INTERVAL '45 days' FROM (SELECT :desde::date AS x) s)`,
    { replacements: { desde: nuevas.reduce((a, x) => (x.fecha < a ? x.fecha : a), "9999-12-31") } },
  );
  const cobrosPorFamilia = new Map();
  for (const c of cobros) {
    const k = `${c.client_id}|${Number(c.amount).toFixed(2)}`;
    if (!cobrosPorFamilia.has(k)) cobrosPorFamilia.set(k, []);
    cobrosPorFamilia.get(k).push({ ...c, usado: false });
  }
  const dias = (a, b) => Math.abs((new Date(a) - new Date(b)) / 86400000);
  for (const x of nuevas.sort((a, b) => a.fecha.localeCompare(b.fecha))) {
    const cand = (cobrosPorFamilia.get(`${x.clientId}|${x.total.toFixed(2)}`) ?? [])
      .filter((c) => !c.usado && dias(c.paid_at, x.fecha) <= 45)
      .sort((a, b) => dias(a.paid_at, x.fecha) - dias(b.paid_at, x.fecha));
    if (cand.length) {
      cand[0].usado = true;
      x.cobro = cand[0];
    }
  }

  const porMes = new Map();
  for (const x of nuevas) {
    const k = x.fecha.slice(0, 7);
    porMes.set(k, (porMes.get(k) ?? 0) + 1);
  }
  const conCobro = nuevas.filter((x) => x.cobro);
  console.log(`\n── LAS QUE FALTAN ────────────────────────────────────────────`);
  console.log(`  se crean                                  ${n(nuevas.length)}   ${eur(nuevas.reduce((s, x) => s + x.total, 0))} €`);
  console.log(`  · con un cobro del CRM detrás → COBRADAS  ${n(conCobro.length)}   ${eur(conCobro.reduce((s, x) => s + x.total, 0))} €`);
  console.log(`  · sin cobro → emitidas, pendientes        ${n(nuevas.length - conCobro.length)}   ${eur(nuevas.filter((x) => !x.cobro).reduce((s, x) => s + x.total, 0))} €`);
  console.log(`  · con paciente                            ${n(nuevas.filter((x) => x.patientId).length)}`);
  console.log(`  · por mes: ${[...porMes.entries()].sort().map(([k, v]) => `${k} ${v}`).join(" · ") || "—"}`);
  console.log(`  sin familia con la que cruzarlas          ${n(fallos.sinFamilia)}`);
  console.log(`  sin fecha                                 ${n(fallos.sinFecha)}`);
  if (DETALLE && sinFamilia.size) {
    console.log(`\n  Sin familia (${Math.min(10, sinFamilia.size)} de ${sinFamilia.size}):`);
    [...sinFamilia.entries()].slice(0, 10).forEach(([num, nom]) => console.log(`    ${num}  «${nom}»`));
  }
  if (DETALLE && conCobro.length) {
    console.log(`\n  Muestra de los cobros que respaldan una factura (10 de ${conCobro.length}):`);
    conCobro.slice(0, 10).forEach((x) =>
      console.log(`    ${x.fila.numero}  factura ${x.fecha}  ${eur(x.total).padStart(9)} €  ←  cobro del ${String(x.cobro.paid_at).slice(0, 10)}`),
    );
  }
}

// ── Escribir ────────────────────────────────────────────────────────────────
if (CONFIRMAR && (arreglos.length || nuevas.length)) {
  await sequelize.transaction(async (t) => {
    for (const a of arreglos) {
      await sequelize.query(
        `UPDATE ${esquema}.invoices
            SET lines = :lines::jsonb,
                custom_fields = COALESCE(custom_fields, '{}'::jsonb) || jsonb_build_object('conceptoDeOrganizate', :marca),
                updated_at = NOW()
          WHERE id = :id`,
        { replacements: { id: a.id, lines: JSON.stringify(a.lines), marca: MARCA }, transaction: t },
      );
    }
    for (const x of nuevas) {
      await m.Invoice.create(
        {
          clientId: x.clientId,
          patientId: x.patientId,
          series: /^R/i.test(x.fila.numero) ? "R" : "F",
          number: String(x.fila.numero).trim(),
          issueDate: x.fecha,
          status: x.cobro ? "paid" : "issued",
          taxBase: x.total,
          vatAmount: 0,
          total: x.total,
          paidAmount: x.cobro ? x.total : 0,
          paidAt: x.cobro ? x.cobro.paid_at : null,
          subtotal: x.total,
          vatRate: 0,
          lines: x.lines,
          notes: x.cobro
            ? `Importado de Organízate el ${MARCA}. Cobrada: cobro del CRM del ${String(x.cobro.paid_at).slice(0, 10)} por ${eur(x.total)} €.`
            : `Importado de Organízate el ${MARCA}. Sin cobro que la respalde en el CRM: queda emitida y pendiente.`,
          customFields: { deOrganizate: MARCA, cobroDelCrm: x.cobro?.id ?? null },
        },
        { transaction: t },
      );
    }
  });
  console.log(`\n  ✓ ${arreglos.length} conceptos puestos · ${nuevas.length} facturas creadas`);

  await auditar({
    tenantId: tenant.id,
    action: "billing.invoices_import_organizate",
    entity: "invoice",
    after: { conceptos: arreglos.length, creadas: nuevas.length, sinFamilia: fallos.sinFamilia, marca: MARCA },
  });
}

const [despues] = await q(
  `SELECT COUNT(*)::int total, SUM(total)::numeric suma,
          COUNT(*) FILTER (WHERE lines->0->>'description' = '${LINEA_DEL_VOLCADO}')::int con_linea_del_volcado
     FROM ${esquema}.invoices`,
);
console.log(`\n  facturas ahora                            ${n(despues.total)}   ${eur(despues.suma)} €`);
console.log(`  con la línea del volcado                  ${n(despues.con_linea_del_volcado)}`);
if (!CONFIRMAR) console.log("\n  (ensayo: no se ha escrito nada. Para hacerlo, --confirm)");

await closeAllConnections();
await db.close();
