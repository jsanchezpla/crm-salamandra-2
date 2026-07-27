/**
 * lib/demo/resetDemo.js — demo auto-restaurable ("toqueteable sin miedo").
 *
 * La demo es pública: cualquiera entra como admin y puede crear/borrar datos.
 * Para que siempre esté presentable, cada RECARGA DURA del dashboard del tenant
 * demo restaura crm_demo desde la foto dorada crm_demo_golden (creada con
 * scripts/demo-golden-snapshot.js). Como en cualquier demo de CRM: tocas lo que
 * quieras y al recargar vuelve el estado original.
 *
 * Diseño (motivo de crear fichero en /lib, regla #2 — lo llama el layout del
 * dashboard, que es server component):
 *  - Si NO existe crm_demo_golden → no hace nada (feature dormida). Así en
 *    entornos sin foto la demo se comporta como siempre.
 *  - Kill-switch: DEMO_RESET_DISABLED=1 (p. ej. para sembrar datos en local
 *    sin que la recarga los pise mientras trabajas).
 *  - Throttle en memoria (3 s) + advisory lock transaccional: dos recargas a la
 *    vez no lanzan dos restores.
 *  - Todo dentro de UNA transacción (TRUNCATE + INSERT): ningún visitante ve
 *    la demo a medio restaurar. session_replication_role=replica desactiva las
 *    FKs durante la carga (mismo truco que scripts/reset-demo-tenant.js); el
 *    usuario de BD es el del contenedor, superuser, como en el reset de QA.
 *  - Solo restaura tablas y columnas que existen en AMBOS schemas: una
 *    migración posterior a la foto no rompe el restore (las columnas nuevas
 *    quedan con su default; re-haz la foto tras migrar para cubrirlas).
 *  - Nunca lanza: un fallo aquí no puede tumbar el dashboard.
 */

import { getMasterDb } from "../db/masterDb.js";

const SCHEMA = "crm_demo";
const GOLDEN = "crm_demo_golden";
const THROTTLE_MS = 3000;

let lastAttemptAt = 0;

export async function maybeResetDemo(slug) {
  if (slug !== "demo") return;
  if (process.env.DEMO_RESET_DISABLED === "1") return;
  const now = Date.now();
  if (now - lastAttemptAt < THROTTLE_MS) return;
  lastAttemptAt = now;

  const s = getMasterDb();
  try {
    const [golden] = await s.query(
      `SELECT 1 FROM information_schema.schemata WHERE schema_name = '${GOLDEN}'`
    );
    if (!golden.length) return; // sin foto dorada → dormido

    // Tablas presentes en ambos schemas (alias AS tn: quirk Sequelize-PG).
    const [tables] = await s.query(
      `SELECT d.table_name AS tn
       FROM information_schema.tables d
       JOIN information_schema.tables g
         ON g.table_schema = '${GOLDEN}' AND g.table_name = d.table_name
        AND g.table_type = 'BASE TABLE'
       WHERE d.table_schema = '${SCHEMA}' AND d.table_type = 'BASE TABLE'
         AND d.table_name <> '_snapshot_meta'
       ORDER BY d.table_name`
    );
    if (!tables.length) return;

    // Columnas comunes por tabla (soporta migraciones posteriores a la foto).
    const [cols] = await s.query(
      `SELECT d.table_name AS tn, d.column_name AS cn
       FROM information_schema.columns d
       JOIN information_schema.columns g
         ON g.table_schema = '${GOLDEN}' AND g.table_name = d.table_name
        AND g.column_name = d.column_name
       WHERE d.table_schema = '${SCHEMA}'
       ORDER BY d.table_name, d.ordinal_position`
    );
    const colsByTable = {};
    for (const c of cols) (colsByTable[c.tn] ??= []).push(`"${c.cn}"`);

    const t0 = Date.now();
    await s.transaction(async (t) => {
      const q = (sql) => s.query(sql, { transaction: t });
      const [[lock]] = await q(
        `SELECT pg_try_advisory_xact_lock(hashtext('crm_demo_reset')) AS ok`
      );
      if (!lock.ok) return; // otro proceso ya está restaurando

      await q(`SET LOCAL session_replication_role = replica`);
      const list = tables.map((r) => `"${SCHEMA}"."${r.tn}"`).join(", ");
      await q(`TRUNCATE TABLE ${list} CASCADE`);
      for (const r of tables) {
        const cl = (colsByTable[r.tn] || []).join(", ");
        if (!cl) continue;
        await q(
          `INSERT INTO "${SCHEMA}"."${r.tn}" (${cl}) SELECT ${cl} FROM "${GOLDEN}"."${r.tn}"`
        );
      }
    });
    if (process.env.NODE_ENV !== "production") {
      console.log(`[demo-reset] demo restaurada desde la foto dorada en ${Date.now() - t0} ms`);
    }
  } catch (err) {
    console.error(`[demo-reset] fallo (ignorado, la demo sigue): ${err.message}`);
  }
}
