/**
 * atar-facturas-al-paciente-de-organizate.js — el paciente de las facturas de
 * las familias con hermanos, traído de Organízate (09/09/2026, AV-0081 y
 * AV-0072 de Aumenta).
 *
 * ── POR QUÉ HACE FALTA VOLVER A LA FUENTE ──────────────────────────────────
 * `atar-facturas-a-su-paciente.js` ató las 11.281 facturas de familias con un
 * solo hijo, donde no hay nada que adivinar. Las 2.964 restantes son de 76
 * familias con dos o tres hermanos, y dentro del CRM no hay con qué
 * desempatar: la línea dice «Importado de Organízate», sin concepto ni
 * terapia, y `custom_fields` está vacío.
 *
 * El volcado del 02/08/2026 no perdió el dato: nunca lo trajo. Se importó de
 * un listado de cinco columnas en el que el nombre era el del PAGADOR, y ese
 * nombre solo se usó para encontrar la familia.
 *
 * En Organízate la factura SÍ guarda las dos cosas: el listado de Facturas
 * (`opcion=facturas`) exporta a Excel hasta 17 columnas, y entre ellas están
 * «Paciente» y «Cliente» POR SEPARADO. Ese es el dato que faltaba.
 *
 * ── QUÉ ENTRA ──────────────────────────────────────────────────────────────
 * El JSON de esa exportación (`--datos`), con una fila por factura:
 *   { numero, fecha, paciente, cif, cliente, concepto, importe, estado }
 * Se saca con la sesión de Chrome: en `index.php?opcion=facturas`, POST del
 * `formulario_listado` con `vista=facturas_list_excel`, `ejercicio=todos`,
 * `pag_reg=0` y `lst_excel=numero,fecha,paciente,cif,cliente,conceptos,importe,
 * estado_pago,anulada`; el .xlsx se pasa a JSON con openpyxl.
 *
 * ── CÓMO CRUZA, Y DÓNDE SE PLANTA ──────────────────────────────────────────
 * Por NÚMERO de factura, que es único en los dos lados. Después, el nombre de
 * «Paciente» se compara SOLO con los pacientes de la familia a la que ya
 * cuelga la factura en el CRM: una factura nunca se mueve a otra familia. Tres
 * reglas, de más a menos exigente, y ninguna adivina:
 *   1. Nombre completo igual (sin acentos, sin comas, sin dobles espacios).
 *   2. Mismas palabras en distinto orden (Organízate escribe unas veces
 *      «APELLIDOS, NOMBRE» y otras «NOMBRE APELLIDOS»).
 *   3. El nombre de pila del paciente aparece entero en el nombre de
 *      Organízate y **solo un hermano** lo cumple. Es el desempate real: los
 *      hermanos comparten apellidos, así que lo que los distingue es el nombre.
 * Lo que no cae en ninguna se cuenta y se deja como está.
 *
 * Además comprueba, sin escribir, las que YA tienen paciente: si el nombre de
 * Organízate coincide con el paciente atado. Es la medida de cuánto se puede
 * fiar uno de la columna, y sale en el informe.
 *
 * ── QUÉ NO CAMBIA ──────────────────────────────────────────────────────────
 * Ni un importe, ni un número, ni el estado, ni Verifactu, ni la familia. Solo
 * `patient_id`, que hoy está vacío. Cada factura tocada se marca con
 * `custom_fields.pacienteDeOrganizate` = la fecha de la pasada, así que se
 * deshace entero con:
 *   UPDATE crm_aumenta.invoices SET patient_id = NULL
 *    WHERE custom_fields ? 'pacienteDeOrganizate';
 *
 * ── CÓMO SE EJECUTA ────────────────────────────────────────────────────────
 *   docker exec -w /app crm-salamandra-app-1 node \
 *     scripts/atar-facturas-al-paciente-de-organizate.js aumenta \
 *     --datos /tmp/migracion-aumenta/facturas-organizate.json [--detalle]
 *   ... y con --confirm para escribir. En seco por defecto.
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
const MARCA = new Date().toISOString().slice(0, 10);

const n = (x) => String(x).padStart(6);

/** Sin acentos, sin puntuación, en mayúsculas y con un solo espacio. */
const norm = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9ÑñÇç]+/g, " ")
    .trim()
    .toUpperCase();

const palabras = (s) => norm(s).split(" ").filter(Boolean);
const mismasPalabras = (a, b) => {
  const A = [...palabras(a)].sort().join(" ");
  const B = [...palabras(b)].sort().join(" ");
  return A.length > 0 && A === B;
};
/** ¿Están TODAS las palabras del nombre de pila dentro del nombre de allí? */
const contieneNombreDePila = (pila, deAlli) => {
  const dentro = new Set(palabras(deAlli));
  const p = palabras(pila);
  return p.length > 0 && p.every((w) => dentro.has(w));
};

if (!DATOS) {
  console.log("Falta --datos <ruta al JSON de la exportación de Organízate>");
  process.exit(1);
}

console.log("═".repeat(64));
console.log(` Facturas → su paciente, desde Organízate — ${SLUG}${CONFIRMAR ? "" : "  ·  ENSAYO"}`);
console.log("═".repeat(64));

// ── El fichero de Organízate ────────────────────────────────────────────────
const fuente = JSON.parse(readFileSync(DATOS, "utf8"));
const filas = fuente.filas ?? fuente;
const deOrganizate = new Map();
for (const f of filas) {
  const k = norm(f.numero);
  if (k) deOrganizate.set(k, f);
}
console.log(`\nOrganízate: ${filas.length} facturas (${deOrganizate.size} números distintos), extraído ${fuente.extraido ?? "?"}`);

// ── El CRM ──────────────────────────────────────────────────────────────────
const db = getMasterDb();
const [tenant] = await db.query(`SELECT id, slug FROM master.tenants WHERE slug = :slug`, {
  type: db.QueryTypes.SELECT,
  replacements: { slug: SLUG },
});
if (!tenant) {
  console.log(`No existe el tenant ${SLUG}`);
  process.exit(1);
}

const { sequelize } = getTenantDb(SLUG);
const esquema = `crm_${SLUG}`;
const q = (sql, opciones = {}) => sequelize.query(sql, { type: sequelize.QueryTypes.SELECT, ...opciones });

const pacientes = await q(
  `SELECT id, first_name, last_name, client_id FROM ${esquema}.patients WHERE client_id IS NOT NULL`,
);
const porFamilia = new Map();
for (const p of pacientes) {
  if (!porFamilia.has(p.client_id)) porFamilia.set(p.client_id, []);
  porFamilia.get(p.client_id).push({
    id: p.id,
    pila: p.first_name ?? "",
    completo: `${p.first_name ?? ""} ${p.last_name ?? ""}`,
  });
}

const sinPaciente = await q(
  `SELECT id, number, client_id FROM ${esquema}.invoices WHERE patient_id IS NULL ORDER BY number`,
);
const conPaciente = await q(
  `SELECT i.number, p.first_name, p.last_name
     FROM ${esquema}.invoices i JOIN ${esquema}.patients p ON p.id = i.patient_id`,
);

// ── La comprobación: ¿acierta la columna en las que YA sabemos la respuesta? ─
const control = { miradas: 0, coinciden: 0, difieren: 0, sinFila: 0 };
for (const i of conPaciente) {
  const f = deOrganizate.get(norm(i.number));
  if (!f) {
    control.sinFila++;
    continue;
  }
  control.miradas++;
  if (mismasPalabras(f.paciente, `${i.first_name} ${i.last_name}`)) control.coinciden++;
  else control.difieren++;
}

// ── El cruce de las que faltan ──────────────────────────────────────────────
const cuenta = { exacta: 0, mismasPalabras: 0, porNombreDePila: 0 };
const fallos = { sinFilaEnOrganizate: 0, familiaSinPacientes: 0, nadieCuadra: 0, variosCuadran: 0 };
const aEscribir = [];
const ejemplos = [];

for (const inv of sinPaciente) {
  const f = deOrganizate.get(norm(inv.number));
  if (!f) {
    fallos.sinFilaEnOrganizate++;
    continue;
  }
  const hermanos = porFamilia.get(inv.client_id) ?? [];
  if (!hermanos.length) {
    fallos.familiaSinPacientes++;
    continue;
  }

  const exactas = hermanos.filter((h) => norm(h.completo) === norm(f.paciente));
  const iguales = exactas.length ? exactas : hermanos.filter((h) => mismasPalabras(h.completo, f.paciente));
  const via = exactas.length ? "exacta" : iguales.length ? "mismasPalabras" : "porNombreDePila";
  const candidatos = iguales.length ? iguales : hermanos.filter((h) => contieneNombreDePila(h.pila, f.paciente));

  if (candidatos.length === 1) {
    cuenta[via]++;
    aEscribir.push({ id: inv.id, patientId: candidatos[0].id });
  } else if (candidatos.length > 1) {
    fallos.variosCuadran++;
    if (ejemplos.length < 20) ejemplos.push(`varios  ${inv.number}  «${f.paciente}»`);
  } else {
    fallos.nadieCuadra++;
    if (ejemplos.length < 20) ejemplos.push(`ninguno ${inv.number}  «${f.paciente}»  vs  ${hermanos.map((h) => h.completo).join(" / ")}`);
  }
}

const atan = cuenta.exacta + cuenta.mismasPalabras + cuenta.porNombreDePila;

/*
 * El reparto: si TODAS las facturas de una familia se fueran al mismo hermano,
 * el cruce estaría acertando el apellido y no el nombre, que es justo el fallo
 * que se quiere evitar. Se mira antes de escribir.
 */
const porFamiliaEscritas = new Map();
const familiaDeFactura = new Map(sinPaciente.map((i) => [i.id, i.client_id]));
for (const w of aEscribir) {
  const fam = familiaDeFactura.get(w.id);
  if (!porFamiliaEscritas.has(fam)) porFamiliaEscritas.set(fam, new Set());
  porFamiliaEscritas.get(fam).add(w.patientId);
}
const reparto = { familias: porFamiliaEscritas.size, repartidas: 0, aUnSoloHijo: 0 };
for (const [fam, hijos] of porFamiliaEscritas) {
  const cuantos = (porFamilia.get(fam) ?? []).length;
  if (hijos.size > 1) reparto.repartidas++;
  else if (cuantos > 1) reparto.aUnSoloHijo++;
}

console.log(`\n── COMPROBACIÓN sobre las ${conPaciente.length} que ya tienen paciente ────────`);
console.log(`  el nombre de Organízate coincide          ${n(control.coinciden)}   ${((control.coinciden / Math.max(1, control.miradas)) * 100).toFixed(1)} %`);
console.log(`  difiere (la columna trae al pagador)      ${n(control.difieren)}`);
console.log(`  sin fila en la exportación                ${n(control.sinFila)}`);

console.log(`\n── LAS ${sinPaciente.length} SIN PACIENTE ──────────────────────────────────`);
console.log(`  nombre completo igual                     ${n(cuenta.exacta)}`);
console.log(`  mismas palabras, otro orden               ${n(cuenta.mismasPalabras)}`);
console.log(`  desempatadas por el nombre de pila        ${n(cuenta.porNombreDePila)}`);
console.log(`  ────────────────────────────────────────────────`);
console.log(`  SE ATAN                                   ${n(atan)}`);
console.log(`  sin fila en Organízate                    ${n(fallos.sinFilaEnOrganizate)}`);
console.log(`  la familia no tiene pacientes             ${n(fallos.familiaSinPacientes)}`);
console.log(`  ningún hermano cuadra con el nombre       ${n(fallos.nadieCuadra)}`);
console.log(`  cuadran varios (no se desempata)          ${n(fallos.variosCuadran)}`);

console.log(`\n── EL REPARTO ENTRE HERMANOS ─────────────────────────────────`);
console.log(`  familias tocadas                          ${n(reparto.familias)}`);
console.log(`  · con facturas para más de un hijo        ${n(reparto.repartidas)}`);
console.log(`  · todo a un solo hijo, teniendo hermanos  ${n(reparto.aUnSoloHijo)}`);

if (DETALLE && ejemplos.length) {
  console.log(`\n  Casos que se quedan fuera (${Math.min(20, ejemplos.length)} de ${fallos.nadieCuadra + fallos.variosCuadran}):`);
  ejemplos.forEach((e) => console.log(`    ${e}`));
}

// ── Escribir ────────────────────────────────────────────────────────────────
if (CONFIRMAR && aEscribir.length) {
  const t = await sequelize.transaction();
  try {
    for (const w of aEscribir) {
      await sequelize.query(
        `UPDATE ${esquema}.invoices
            SET patient_id = :pid,
                custom_fields = COALESCE(custom_fields, '{}'::jsonb) || jsonb_build_object('pacienteDeOrganizate', :marca),
                updated_at = NOW()
          WHERE id = :id AND patient_id IS NULL`,
        { replacements: { pid: w.patientId, id: w.id, marca: MARCA }, transaction: t },
      );
    }
    await t.commit();
  } catch (e) {
    await t.rollback();
    throw e;
  }
  console.log(`\n  ✓ ${aEscribir.length} facturas atadas a su paciente`);

  // Auditoría: solo el resumen. Ni un nombre ni un id de paciente en master.
  await auditar({
    tenantId: tenant.id,
    action: "billing.invoices_patient_backfill_organizate",
    entity: "invoice",
    after: { atadas: aEscribir.length, ...cuenta, ...fallos, marca: MARCA },
  });
}

const [despues] = await q(
  `SELECT COUNT(*) FILTER (WHERE patient_id IS NULL)::int sin_paciente,
          COUNT(*)::int total,
          SUM(total)::numeric suma
     FROM ${esquema}.invoices`,
);
console.log(`\n  quedan sin paciente                       ${n(despues.sin_paciente)}   de ${despues.total} facturas, ${Number(despues.suma).toLocaleString("es-ES", { minimumFractionDigits: 2 })} €`);
if (!CONFIRMAR) console.log("\n  (ensayo: no se ha escrito nada. Para hacerlo, --confirm)");

await closeAllConnections();
await db.close();
