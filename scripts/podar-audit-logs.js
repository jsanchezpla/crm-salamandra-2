/**
 * podar-audit-logs.js — retención del registro de auditoría.
 *
 * QUÉ RESUELVE: `master.audit_logs` es una tabla COMPARTIDA por todos los
 * clientes y solo crecía. Además la demo pública da sesión de administrador a
 * cualquier visitante anónimo, así que cada curioso que trastea deja filas ahí
 * dentro, mezcladas con el registro real de Aumenta o de Laura.
 *
 * DOS POLÍTICAS DISTINTAS, a propósito:
 *
 *   - DEMO: se poda agresivo (7 días por defecto). Son datos de juguete y su
 *     único valor es que la pantalla de Actividad tenga algo que enseñar.
 *
 *   - CLIENTES REALES: se conservan 3 años (1095 días). La norma del proyecto
 *     dice que los registros de auditoría no se borran, y para eso está el
 *     plazo largo: cubre de sobra cualquier revisión o reclamación, pero evita
 *     que la tabla crezca sin límite para siempre. NUNCA se poda por debajo de
 *     un año: si alguien pasa un plazo menor por variable, se ignora.
 *
 * Es SOLO borrado por antigüedad: jamás toca una fila reciente.
 *
 * Uso:
 *   node --env-file=.env.local scripts/podar-audit-logs.js            (simula)
 *   docker exec crm-salamandra-app-1 node scripts/podar-audit-logs.js --confirm
 */

import { Sequelize } from "sequelize";

const CONFIRM = process.argv.includes("--confirm");

const DIAS_DEMO = Math.max(1, Number(process.env.RETENCION_DEMO_DIAS) || 7);
// Suelo de un año para los clientes reales: proteger el registro es más
// importante que ahorrar espacio.
const DIAS_REALES = Math.max(365, Number(process.env.RETENCION_DIAS) || 1095);

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Falta DATABASE_URL");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { logging: false });

  header(`Poda del registro de auditoría${CONFIRM ? "" : " (SIMULACIÓN)"}`);
  log(`Demo: ${DIAS_DEMO} días · clientes reales: ${DIAS_REALES} días`);

  const [[{ total }]] = await s.query(`SELECT count(*)::int AS total FROM master.audit_logs`);
  log(`Filas ahora: ${total}`);

  // Tenants de juguete: la demo pública y su copia dorada.
  const [demos] = await s.query(
    `SELECT id, slug FROM master.tenants WHERE slug IN ('demo', 'demo_golden')`
  );
  const idsDemo = demos.map((d) => d.id);

  const cuenta = async (sql, bind) => {
    const [[fila]] = await s.query(sql, { bind });
    return Number(fila.n) || 0;
  };

  const nDemo = idsDemo.length
    ? await cuenta(
        `SELECT count(*)::int AS n FROM master.audit_logs
          WHERE tenant_id = ANY($1) AND created_at < now() - ($2 || ' days')::interval`,
        [idsDemo, String(DIAS_DEMO)]
      )
    : 0;

  const nReales = await cuenta(
    `SELECT count(*)::int AS n FROM master.audit_logs
      WHERE (tenant_id IS NULL OR NOT (tenant_id = ANY($1)))
        AND created_at < now() - ($2 || ' days')::interval`,
    [idsDemo.length ? idsDemo : ["00000000-0000-0000-0000-000000000000"], String(DIAS_REALES)]
  );

  log(`A podar de la demo (> ${DIAS_DEMO} días): ${nDemo}`);
  log(`A podar de clientes reales (> ${DIAS_REALES} días): ${nReales}`);

  if (!CONFIRM) {
    header("Simulación: no se ha borrado nada. Repite con --confirm.");
    await s.close();
    return;
  }

  if (nDemo && idsDemo.length) {
    await s.query(
      `DELETE FROM master.audit_logs
        WHERE tenant_id = ANY($1) AND created_at < now() - ($2 || ' days')::interval`,
      { bind: [idsDemo, String(DIAS_DEMO)] }
    );
    log(`✓ Demo: ${nDemo} fila(s) borradas`);
  }
  if (nReales) {
    await s.query(
      `DELETE FROM master.audit_logs
        WHERE (tenant_id IS NULL OR NOT (tenant_id = ANY($1)))
          AND created_at < now() - ($2 || ' days')::interval`,
      { bind: [idsDemo.length ? idsDemo : ["00000000-0000-0000-0000-000000000000"], String(DIAS_REALES)] }
    );
    log(`✓ Clientes reales: ${nReales} fila(s) borradas`);
  }

  const [[{ total: quedan }]] = await s.query(`SELECT count(*)::int AS total FROM master.audit_logs`);
  header(`Hecho. Quedan ${quedan} filas.`);
  await s.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
