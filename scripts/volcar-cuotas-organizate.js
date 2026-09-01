/**
 * volcar-cuotas-organizate.js — de qué cuota es cada familia, volcado del
 * Organízate (01/09/2026, con el sí de Rodrigo: «vuelques todo, quieren que
 * todo esté automatizado»).
 *
 * Entrada: el JSON extraído de las fichas del Organízate (pestaña «Grupos de
 * cursos», input lst_grupos[]): { grupos: {id: nombre}, pacientes: [{id, n
 * (nombre), a (apellidos), g (ids de grupo marcados)}] }.
 *
 * Hace DOS cosas, EN SECO por defecto (--confirm para escribir):
 *
 *   1. Da de alta en el catálogo los conceptos de cuota que falten (por
 *      nombre; nunca duplica). La tabla grupo→concepto+precio está AQUÍ,
 *      escrita una vez: precios de la tarifa nueva donde la dosis es exacta
 *      (30'→105, 45'→145, 60'→190, 2×45'→290), 370 para 60x2 (el precio que
 *      el propio Organízate tenía apuntado, leído el 31/08), y 0 € «importe a
 *      completar» donde no hay precio conocido — NADA de inventar dinero: los
 *      completan en Configuración → Conceptos.
 *
 *   2. Rellena clients.cuota_concept_ids casando cada paciente del volcado
 *      con el del CRM por nombre normalizado (sin tildes ni mayúsculas): la
 *      cuota de la familia es la suma de las de sus hijos (duplicados
 *      legítimos: dos hermanos, misma cuota). SOLO toca fichas con la cuota a
 *      NULL — lo que un cobro real ya enseñó no se pisa nunca.
 *
 * Solo grupos CUOTA*: talleres, campus, bonos, prácticas y reservas de plaza
 * no son la cuota mensual. Un nombre que casa con DOS pacientes de familias
 * distintas es ambiguo: se salta y se cuenta. Con --detalle, los no casados y
 * ambiguos salen listados (para revisarlos a mano en el centro).
 *
 * Uso VPS (docker cp del script y del JSON al contenedor):
 *   docker exec crm-salamandra-app-1 node scripts/volcar-cuotas-organizate.js scripts/organizate-grupos-cuota.json [--confirm] [--detalle]
 */

import { readFileSync } from "node:fs";
import { Sequelize } from "sequelize";

const SCHEMA = "crm_aumenta"; // el volcado ES de Aumenta: su Organízate, sus fichas

// Grupo del Organízate → [nombre del concepto en el CRM, precio | null].
// null = sin precio conocido → 0 € y «importe a completar».
const CUOTA_A_CONCEPTO = {
  "CUOTA LOGOPEDIA 30X1": ["Cuota Logopedia 30x1", 105],
  "CUOTA LOGOPEDIA 45X1": ["Cuota Logopedia 45x1", 145],
  "CUOTA LOGOPEDIA 60X1": ["Cuota Logopedia 60x1", 190],
  "CUOTA LOGOPEDIA 45X2": ["Cuota Logopedia 45x2", 290],
  "CUOTA LOGOPEDIA 45X3": ["Cuota Logopedia 45x3", null],
  "CUOTA LOGOPEDIA 60X2": ["Cuota Logopedia 60x2", 370], // ya existe en el catálogo
  "CUOTA PEDAGOGIA 45X1": ["Cuota Pedagogía 45x1", 145],
  "CUOTA PEDAGOGIA 45X2": ["Cuota Pedagogía 45x2", 290],
  "CUOTA PEDAGOGIA 60X1": ["Cuota Pedagogía 60x1", 190],
  "CUOTA PEDAGOGIA 60x2": ["Cuota Pedagogía 60x2", 370],
  "CUOTA PSICOLOGIA 45X1": ["Cuota Psicología 45x1", 145],
  "CUOTA PSICOLOGIA 45X2": ["Cuota Psicología 45x2", 290],
  "CUOTA PSICOLOGIA 60X1": ["Cuota Psicología 60x1", 190],
  "CUOTA PSICOLOGIA 60X2": ["Cuota Psicología 60x2", 370],
  "CUOTA T.O. 30X1": ["Cuota T.O. 30x1", 105],
  "CUOTA T.O. 45X1": ["Cuota T.O. 45x1", 145],
  "CUOTA T.O. 45X2": ["Cuota T.O. 45x2", 290],
  "CUOTA T.O. 60X1": ["Cuota T.O. 60x1", 190],
  "CUOTA T.O. 60X2": ["Cuota T.O. 60x2", 370],
  "CUOTA T.O. 60+45": ["Cuota T.O. 60+45", null],
  "CUOTA REFUERZO 1 DIA": ["Cuota Refuerzo / TT.EE. 1 día", null],
  "CUOTA REFUERZO 2 DIAS": ["Cuota Refuerzo / TT.EE. 2 días", null],
  "CUOTA REFUERZO 3 DIAS": ["Cuota Refuerzo / TT.EE. 3 días", null],
  "CUOTA REFUERZO 4 DIAS": ["Cuota Refuerzo / TT.EE. 4 días", null], // ya existe (0, a completar)
  "CUOTA H.H.S.S.": ["Cuota HHSS", null],
  "CUOTA HHSS 1H 30": ["Cuota HHSS 1h 30", null],
};

const norm = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

async function main() {
  const args = process.argv.slice(2);
  const confirm = args.includes("--confirm");
  const detalle = args.includes("--detalle");
  const rutaJson = args.find((a) => !a.startsWith("--"));
  if (!rutaJson) { process.stderr.write("Uso: node scripts/volcar-cuotas-organizate.js <json> [--confirm] [--detalle]\n"); process.exit(1); }
  if (!process.env.DATABASE_URL) { process.stderr.write("✗ DATABASE_URL no configurada\n"); process.exit(1); }

  const volcado = JSON.parse(readFileSync(rutaJson, "utf8"));
  const nombreDeGrupo = new Map(Object.entries(volcado.grupos).map(([id, n]) => [Number(id), n]));

  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  // ── 1. Qué conceptos de cuota hacen falta (solo de grupos CON miembros) ──
  const usoPorGrupo = new Map();
  for (const p of volcado.pacientes) {
    for (const g of p.g) usoPorGrupo.set(g, (usoPorGrupo.get(g) ?? 0) + 1);
  }
  const gruposCuotaUsados = [...usoPorGrupo.keys()]
    .filter((g) => CUOTA_A_CONCEPTO[nombreDeGrupo.get(g) ?? ""])
    .sort((a, b) => a - b);

  const [conceptosExistentes] = await s.query(`SELECT id, name FROM "${SCHEMA}"."billing_concepts"`);
  const conceptoPorNombre = new Map(conceptosExistentes.map((c) => [c.name, c.id]));

  const aCrear = [];
  for (const g of gruposCuotaUsados) {
    const [nombre, precio] = CUOTA_A_CONCEPTO[nombreDeGrupo.get(g)];
    if (!conceptoPorNombre.has(nombre) && !aCrear.some((x) => x.nombre === nombre)) {
      aCrear.push({ nombre, precio, grupo: nombreDeGrupo.get(g) });
    }
  }

  process.stdout.write(`\nGrupos de cuota con miembros en el volcado: ${gruposCuotaUsados.length}\n`);
  for (const g of gruposCuotaUsados) {
    process.stdout.write(`  · ${nombreDeGrupo.get(g)} → ${CUOTA_A_CONCEPTO[nombreDeGrupo.get(g)][0]} (${usoPorGrupo.get(g)} paciente/s)\n`);
  }
  process.stdout.write(`\nConceptos que faltan en el catálogo: ${aCrear.length}\n`);
  for (const c of aCrear) {
    process.stdout.write(`  + ${c.nombre} — ${c.precio ?? 0} €/mensual${c.precio == null ? "  ⚠ importe a completar" : ""}\n`);
  }

  // ── 2. Casar pacientes del volcado con los del CRM ──────────────────────
  const [pacientesCrm] = await s.query(
    `SELECT id, client_id, first_name, last_name FROM "${SCHEMA}"."patients"`
  );
  const porNombre = new Map();
  for (const p of pacientesCrm) {
    const clave = norm(`${p.first_name ?? ""} ${p.last_name ?? ""}`);
    if (!clave) continue;
    (porNombre.get(clave) ?? porNombre.set(clave, []).get(clave)).push(p);
  }

  const cuotaPorCliente = new Map(); // clientId → [nombres de concepto, en orden]
  const noCasados = [];
  const ambiguos = [];
  const sinFamilia = [];
  let conCuota = 0;

  for (const p of volcado.pacientes) {
    const gruposCuota = p.g.filter((g) => CUOTA_A_CONCEPTO[nombreDeGrupo.get(g) ?? ""]);
    if (!gruposCuota.length) continue; // solo talleres/reservas: no es cuota mensual
    conCuota++;
    const clave = norm(`${p.n} ${p.a}`);
    const candidatos = porNombre.get(clave) ?? [];
    const familias = new Set(candidatos.map((c) => c.client_id).filter(Boolean));
    if (!candidatos.length) { noCasados.push(`${p.n} ${p.a}`); continue; }
    if (familias.size > 1) { ambiguos.push(`${p.n} ${p.a}`); continue; }
    if (!familias.size) { sinFamilia.push(`${p.n} ${p.a}`); continue; }
    const clientId = [...familias][0];
    const lista = cuotaPorCliente.get(clientId) ?? [];
    for (const g of gruposCuota.sort((a, b) => a - b)) {
      lista.push(CUOTA_A_CONCEPTO[nombreDeGrupo.get(g)][0]);
    }
    cuotaPorCliente.set(clientId, lista);
  }

  // Solo fichas con la cuota a NULL: lo aprendido por un cobro no se pisa.
  const ids = [...cuotaPorCliente.keys()];
  let virgenes = [];
  if (ids.length) {
    const [filas] = await s.query(
      `SELECT id FROM "${SCHEMA}"."clients" WHERE id IN (:ids) AND cuota_concept_ids IS NULL`,
      { replacements: { ids } }
    );
    virgenes = filas.map((f) => f.id);
  }

  process.stdout.write(`\nPacientes del volcado con cuota: ${conCuota}\n`);
  process.stdout.write(`  · casados con su familia del CRM: ${conCuota - noCasados.length - ambiguos.length - sinFamilia.length}\n`);
  process.stdout.write(`  · sin casar por nombre: ${noCasados.length}\n`);
  process.stdout.write(`  · ambiguos (mismo nombre, familias distintas): ${ambiguos.length}\n`);
  process.stdout.write(`  · casados pero sin familia enganchada en el CRM: ${sinFamilia.length}\n`);
  process.stdout.write(`Familias a rellenar: ${virgenes.length} (de ${ids.length} casadas; el resto ya tiene cuota puesta y no se toca)\n`);
  if (detalle) {
    for (const n of noCasados) process.stdout.write(`    ? sin casar: ${n}\n`);
    for (const n of ambiguos) process.stdout.write(`    ! ambiguo: ${n}\n`);
    for (const n of sinFamilia) process.stdout.write(`    ~ sin familia: ${n}\n`);
  }

  if (!confirm) {
    process.stdout.write("\n(EN SECO: nada escrito. Repite con --confirm para volcar.)\n");
    await s.close();
    return;
  }

  // ── Escribir: primero los conceptos, luego las fichas ───────────────────
  const [maxOrden] = await s.query(`SELECT COALESCE(MAX(sort_order), 0) AS m FROM "${SCHEMA}"."billing_concepts"`);
  let orden = Number(maxOrden[0].m);
  for (const c of aCrear) {
    const [fila] = await s.query(
      `INSERT INTO "${SCHEMA}"."billing_concepts" (name, description, unit_price, vat_rate, category, periodicity, sort_order)
       VALUES (:name, :description, :precio, 0, 'Cuotas del Organízate', 'mensual', :orden)
       RETURNING id`,
      {
        replacements: {
          name: c.nombre,
          description: `Cuota mensual (${c.grupo} en el Organízate)${c.precio == null ? " — importe: completar" : ""}`,
          precio: c.precio ?? 0,
          orden: ++orden,
        },
      }
    );
    conceptoPorNombre.set(c.nombre, fila[0].id);
  }

  let rellenadas = 0;
  const virgenSet = new Set(virgenes.map(String));
  for (const [clientId, nombres] of cuotaPorCliente) {
    if (!virgenSet.has(String(clientId))) continue;
    const conceptIds = nombres.map((n) => conceptoPorNombre.get(n)).filter(Boolean);
    if (!conceptIds.length) continue;
    await s.query(
      `UPDATE "${SCHEMA}"."clients" SET cuota_concept_ids = :ids::jsonb WHERE id = :clientId AND cuota_concept_ids IS NULL`,
      { replacements: { ids: JSON.stringify(conceptIds), clientId } }
    );
    rellenadas++;
  }

  process.stdout.write(`\n✓ ${aCrear.length} conceptos dados de alta y ${rellenadas} familias con su cuota rellenada.\n`);
  await s.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
