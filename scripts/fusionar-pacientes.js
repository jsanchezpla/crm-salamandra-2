/**
 * fusionar-pacientes.js — dos fichas de paciente que son la misma persona
 * pasan a ser una (11/09/2026, AV-0111 de Aumenta: «te adjunto captura para
 * que los pacientes duplicados los unifique»).
 *
 * ⚠️ SIMULA POR DEFECTO. Sin `--confirm` no escribe nada.
 *
 * ── QUÉ HACE ───────────────────────────────────────────────────────────────
 * Todo lo que cuelga de la ficha que SE VA (citas, sesiones, informes,
 * documentos, cobros, cuotas, bonos, incidencias, inscripciones a talleres,
 * terapeutas, bloqueos reservados, contactos externos, planes, facturas…)
 * pasa a colgar de la ficha que SE QUEDA. Las tablas no se listan a mano: se
 * leen de `information_schema` (toda columna `patient_id` del schema), así que
 * una tabla nueva mañana entra sola. Después, los huecos de la que se queda
 * se rellenan con lo que tuviera la que se va (fecha de nacimiento, DNI,
 * centro escolar, motivo, terapeuta de referencia…; lo que ya tiene NUNCA se
 * pisa), y la que se va se borra: ya no cuelga nada de ella.
 *
 * ── QUIÉN SE QUEDA ─────────────────────────────────────────────────────────
 * Lo dice quien lanza el script (`--dejar` / `--quitar`). La regla que se
 * siguió el 11/09/2026: se queda la que tiene FAMILIA (`client_id`), porque
 * sin familia no hay a quién cobrar ni a quién escribir; la otra suele ser un
 * alta a medias hecha minutos después.
 *
 * ── LO QUE NO SE PIERDE ────────────────────────────────────────────────────
 * Antes de tocar nada se escribe en `/tmp` (o donde diga `--copia`) un JSON
 * con las dos fichas enteras y los ids de cada fila que se mueve, por tabla.
 * Con eso se deshace a mano. Y en `master.audit_logs` queda una línea
 * (`pacientes.fusionados`) con los dos ids y el recuento por tabla, sin
 * nombres.
 *
 * Uso:
 *   node --env-file=.env.local scripts/fusionar-pacientes.js --tenant aumenta --dejar UUID --quitar UUID
 *   docker exec crm-salamandra-app-1 node scripts/fusionar-pacientes.js --tenant aumenta --dejar UUID --quitar UUID --confirm
 */

import { writeFileSync } from "node:fs";
import { getTenantDb } from "../lib/db/tenantDb.js";
import { getMasterDb } from "../lib/db/masterDb.js";
import { auditar } from "../lib/utils/auditoria.js";

const args = process.argv.slice(2);
const arg = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : null);
const CONFIRM = args.includes("--confirm");
const SLUG = arg("--tenant");
const DEJAR = arg("--dejar");
const QUITAR = arg("--quitar");
const COPIA = arg("--copia") ?? `/tmp/fusion-pacientes-${Date.now()}.json`;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

if (!SLUG || !UUID_RE.test(DEJAR ?? "") || !UUID_RE.test(QUITAR ?? "") || DEJAR === QUITAR) {
  console.error("uso: --tenant <slug> --dejar <uuid de la que se queda> --quitar <uuid de la que se va> [--confirm] [--copia ruta.json]");
  process.exit(1);
}

/** Columnas de `patients` que la que se va puede aportar si la que se queda las tiene vacías. */
const HEREDABLES = [
  "client_id", "care_type", "specialties", "birth_date", "age", "education_center", "education_level",
  "referral_reason", "referred_by", "objectives", "main_therapist_id", "enrollment_date",
  "attendance_frequency", "notes", "external_links", "dni", "address", "relationship", "consents",
  "contract_signed", "contract_file",
];

const vacio = (v) =>
  v == null || v === "" || v === false ||
  (Array.isArray(v) && v.length === 0) ||
  (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0);

async function main() {
  const { sequelize } = getTenantDb(SLUG);
  const schema = `crm_${SLUG}`;
  const r = (sql, replacements) => sequelize.query(sql, { replacements });

  console.log(`\n${"═".repeat(66)}`);
  console.log(` FUSIONAR PACIENTES → tenant "${SLUG}"`);
  console.log(`${CONFIRM ? " ⚠️  MODO REAL: va a escribir" : " · SIMULACIÓN: no se escribe nada"}`);
  console.log(`${"═".repeat(66)}\n`);

  const [[dejar]] = await r(`select * from "${schema}".patients where id = :id`, { id: DEJAR });
  const [[quitar]] = await r(`select * from "${schema}".patients where id = :id`, { id: QUITAR });
  if (!dejar || !quitar) {
    console.error("Alguna de las dos fichas no existe.");
    process.exit(1);
  }
  const nombre = (p) => `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim();
  console.log(`Se queda : ${DEJAR.slice(0, 8)}… (${nombre(dejar).length} letras de nombre, familia ${dejar.client_id ? "sí" : "NO"}, alta ${String(dejar.created_at).slice(0, 10)})`);
  console.log(`Se va    : ${QUITAR.slice(0, 8)}… (familia ${quitar.client_id ? "sí" : "NO"}, alta ${String(quitar.created_at).slice(0, 10)})`);
  const llano = (t) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  const mismoNombre = llano(nombre(dejar)) === llano(nombre(quitar));
  if (!mismoNombre) {
    // Sin imprimir el nombre: solo en qué posición y qué códigos difieren, que
    // es lo que hace falta para ver si es un espacio raro o una letra.
    const x = llano(nombre(dejar));
    const y = llano(nombre(quitar));
    let i = 0;
    while (i < x.length && i < y.length && x[i] === y[i]) i += 1;
    const cod = (c) => (c == null ? "(fin)" : `U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`);
    console.error(`\n⚠️  Las dos fichas NO se llaman igual (largos ${x.length} y ${y.length}; difieren en la posición ${i}: ${cod(x[i])} frente a ${cod(y[i])}). Esto fusiona duplicados, no personas distintas. Parado.`);
    process.exit(2);
  }

  // Toda tabla del schema con columna patient_id, menos la propia `patients`.
  const [tablas] = await r(
    `select table_name from information_schema.columns where table_schema = :schema and column_name = 'patient_id' and table_name <> 'patients' order by 1`,
    { schema }
  );

  const movimiento = {};
  let total = 0;
  for (const { table_name: t } of tablas) {
    const [filas] = await r(`select id from "${schema}"."${t}" where patient_id = :id`, { id: QUITAR }).catch(async () => {
      // Tablas sin `id` (pivotes): se cuentan sin ids.
      const [[c]] = await r(`select count(*)::int n from "${schema}"."${t}" where patient_id = :id`, { id: QUITAR });
      return [Array.from({ length: c.n }, () => ({ id: null }))];
    });
    if (filas.length) {
      movimiento[t] = filas.map((f) => f.id);
      total += filas.length;
    }
  }

  console.log(`\nFilas que pasan de una ficha a la otra: ${total}`);
  for (const [t, ids] of Object.entries(movimiento)) console.log(`  · ${t}: ${ids.length}`);

  const heredado = [];
  for (const campo of HEREDABLES) {
    if (vacio(dejar[campo]) && !vacio(quitar[campo])) heredado.push(campo);
  }
  console.log(`\nHuecos de la que se queda que rellena la que se va: ${heredado.length ? heredado.join(", ") : "ninguno"}`);

  if (!CONFIRM) {
    console.log("\n· Simulación. Con --confirm se hace de verdad.\n");
    process.exit(0);
  }

  // La copia ANTES de tocar nada.
  writeFileSync(COPIA, JSON.stringify({ tenant: SLUG, dejar, quitar, movimiento, heredado, cuando: new Date().toISOString() }, null, 2));
  console.log(`\nCopia escrita en ${COPIA}`);

  const tx = await sequelize.transaction();
  const hecho = {};
  try {
    for (const t of Object.keys(movimiento)) {
      try {
        const [, meta] = await sequelize.query(`update "${schema}"."${t}" set patient_id = :dejar where patient_id = :quitar`, {
          replacements: { dejar: DEJAR, quitar: QUITAR }, transaction: tx,
        });
        hecho[t] = meta?.rowCount ?? movimiento[t].length;
      } catch (e) {
        // Un índice único (paciente + terapeuta, paciente + grupo…): la fila
        // que ya existe en la que se queda sobra en la que se va.
        if (e?.original?.code !== "23505" && e?.parent?.code !== "23505") throw e;
        let n = 0;
        for (const id of movimiento[t]) {
          if (!id) continue;
          try {
            await sequelize.query(`savepoint fila`, { transaction: tx });
            await sequelize.query(`update "${schema}"."${t}" set patient_id = :dejar where id = :id`, { replacements: { dejar: DEJAR, id }, transaction: tx });
            await sequelize.query(`release savepoint fila`, { transaction: tx });
            n += 1;
          } catch (e2) {
            if (e2?.original?.code !== "23505" && e2?.parent?.code !== "23505") throw e2;
            await sequelize.query(`rollback to savepoint fila`, { transaction: tx });
            await sequelize.query(`delete from "${schema}"."${t}" where id = :id`, { replacements: { id }, transaction: tx });
          }
        }
        hecho[t] = n;
      }
    }
    // Lo que colgaba de una ficha SIN familia no dice de qué familia es
    // (`client_id` a NULL): ahora que cuelga de la que sí la tiene, se le
    // pone la suya donde falte. Es la misma foto que toma un registro al
    // crearse (CLAUDE.md, «Conexión cliente/equipo»). Lo que ya tenía familia
    // no se toca.
    const familia = dejar.client_id ?? quitar.client_id ?? null;
    if (familia) {
      const [conFamilia] = await sequelize.query(
        `select table_name from information_schema.columns where table_schema = :schema and column_name = 'client_id' and table_name in (:tablas)`,
        { replacements: { schema, tablas: Object.keys(hecho).length ? Object.keys(hecho) : ["__ninguna__"] }, transaction: tx }
      );
      for (const { table_name: t } of conFamilia) {
        const [, meta] = await sequelize.query(
          `update "${schema}"."${t}" set client_id = :familia where patient_id = :dejar and client_id is null`,
          { replacements: { familia, dejar: DEJAR }, transaction: tx }
        );
        if (meta?.rowCount) hecho[`${t} (familia puesta)`] = meta.rowCount;
      }
    }
    if (heredado.length) {
      const sets = heredado.map((c) => `"${c}" = :${c}`).join(", ");
      const repl = Object.fromEntries(heredado.map((c) => [c, typeof quitar[c] === "object" && quitar[c] !== null && !(quitar[c] instanceof Date) ? JSON.stringify(quitar[c]) : quitar[c]]));
      await sequelize.query(`update "${schema}".patients set ${sets} where id = :id`, { replacements: { ...repl, id: DEJAR }, transaction: tx });
    }
    await sequelize.query(`delete from "${schema}".patients where id = :id`, { replacements: { id: QUITAR }, transaction: tx });
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    console.error("\n❌ Nada se ha escrito (transacción deshecha):", e.message);
    process.exit(1);
  }

  // Auditoría DESPUÉS y fuera de la transacción, con el recuento y sin nombres.
  try {
    const master = getMasterDb();
    const [[t]] = await master.query(`select id from master.tenants where slug = :slug`, { replacements: { slug: SLUG } });
    await auditar({
      tenantId: t?.id ?? null,
      userId: null,
      action: "pacientes.fusionados",
      entity: "Patient",
      entityId: DEJAR,
      before: { quitada: QUITAR },
      after: { movido: hecho, heredado, copia: COPIA },
    });
  } catch (e) {
    console.warn("(no se pudo auditar:", e.message, ")");
  }

  console.log("\n✅ Fusionadas.");
  for (const [t, n] of Object.entries(hecho)) console.log(`  · ${t}: ${n} movidas`);
  const [[queda]] = await r(`select count(*)::int n from "${schema}".patients where id in (:a, :b)`, { a: DEJAR, b: QUITAR });
  console.log(`Fichas que quedan de las dos: ${queda.n} (tiene que ser 1)\n`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
