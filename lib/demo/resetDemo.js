/**
 * lib/demo/resetDemo.js — demos auto-restaurables ("toqueteables sin miedo").
 *
 * Las demos son públicas: cualquiera entra como admin y puede crear/borrar
 * datos. Para que siempre estén presentables, cada RECARGA DURA del dashboard
 * de una demo restaura `crm_{slug}` desde su foto dorada `crm_{slug}_golden`
 * (creada con scripts/demo-golden-snapshot.js). Como en cualquier demo de CRM:
 * tocas lo que quieras y al recargar vuelve el estado original.
 *
 * Diseño (motivo de crear fichero en /lib, regla #2 — lo llama el layout del
 * dashboard, que es server component):
 *  - Si NO existe la foto dorada → no hace nada (feature dormida). Así en
 *    entornos sin foto la demo se comporta como siempre.
 *  - Kill-switch: DEMO_RESET_DISABLED=1 (p. ej. para sembrar datos en local
 *    sin que la recarga los pise mientras trabajas).
 *  - Throttle en memoria (60 s) + advisory lock transaccional: dos recargas a
 *    la vez no lanzan dos restores.
 *  - Todo dentro de UNA transacción (TRUNCATE + INSERT): ningún visitante ve
 *    la demo a medio restaurar. session_replication_role=replica desactiva las
 *    FKs durante la carga (mismo truco que scripts/reset-demo-tenant.js); el
 *    usuario de BD es el del contenedor, superuser, como en el reset de QA.
 *  - Solo restaura tablas y columnas que existen en AMBOS schemas: una
 *    migración posterior a la foto no rompe el restore (las columnas nuevas
 *    quedan con su default; re-haz la foto tras migrar para cubrirlas).
 *
 * ⚠️ PERO EL TRUNCATE ES **CASCADE**, Y ESO NO RESPETA ESA LISTA (13/08/2026).
 * Una tabla que la foto NO tiene no se restaura —correcto— pero SÍ se vacía si
 * apunta con una clave ajena a alguna de las que sí están. Pasó con el módulo
 * Fichaje recién estrenado: `fichajes.team_member_id → team_members`, así que
 * cada recarga de la demo se llevaba por delante el mes sembrado, en silencio y
 * sin que el restore lo mencionara.
 *
 * O sea: **estrenar un módulo con tablas nuevas en una demo obliga a re-hacer
 * su foto** (`scripts/demo-golden-snapshot.js <slug>`), no solo a sembrar. Si
 * no, el escaparate está vacío justo cuando alguien lo enseña. `--comprobar`
 * lo canta: «N tabla(s) que la foto no tiene».
 *  - Nunca lanza: un fallo aquí no puede tumbar el dashboard.
 *
 * ── UNA POR DEMO (13/08/2026) ───────────────────────────────────────────────
 * `crm_demo` y `crm_demo_golden` estaban escritos aquí como constantes. Con
 * cuatro demos eso significaba que las tres nuevas se restauraban desde la foto
 * de la general —o sea, que se llenaban de los datos de otro oficio— o, más
 * probable, que no se restauraban nunca. El throttle también era una variable
 * suelta: una recarga de la demo de nutrición dejaba a la de clínica sin
 * restaurar durante el minuto siguiente, sin que nada lo dijera.
 *
 * ── LOS TIPOS ENUM: por qué el restore se abandonaba en silencio ────────────
 * El restore copia SOLO las columnas comunes, pero el TIPO de una columna común
 * puede haber cambiado: `enum_bookings_payment_status` tenía nueve valores en
 * `crm_demo` y cinco en la foto (backlog, 10/08). Una fila con un valor nuevo
 * revienta el INSERT, la transacción entera se deshace y el `catch` de abajo se
 * lo traga: la demo seguía en pie, sucia, sin un solo error visible.
 *
 * Eso no se arregla desde aquí —la foto se saca con `CREATE TABLE AS`, que se
 * lleva los datos y no el tipo—, se arregla al SACARLA: desde el 13/08 el
 * snapshot copia los enums al schema dorado. Lo que sí se hace aquí es DEJAR
 * RASTRO: `ultimoFallo()` guarda el último error por demo y el snapshot lo
 * comprueba. Un fallo silencioso que nadie puede ver es el que dura tres meses.
 */

import { getMasterDb } from "../db/masterDb.js";
import { esSlugDemo, schemaDorado } from "./demos.js";

// Frecuencia MÍNIMA entre restauraciones. El restore es un TRUNCATE CASCADE +
// INSERT de ~79 tablas (locks ACCESS EXCLUSIVE) en la MISMA instancia Postgres
// que sirve a los tenants reales, y se dispara desde el render del dashboard:
// con 3 s, un bucle de recargas de un visitante anónimo lo encadenaba sin parar
// y degradaba la BD compartida (y dejaba la demo inservible para los demás).
// 60 s es igual de válido para una demo comercial: quien la abre encuentra los
// datos originales, y quien está trasteando no ve su trabajo borrado cada 3 s.
const THROTTLE_MS = 60_000;

/** Último intento POR DEMO: una no puede bloquear a las otras. */
const ultimoIntento = new Map();
/** Último fallo por demo, para que no sea invisible. */
const fallos = new Map();

/** Qué le pasó a la última restauración de cada demo (diagnóstico). */
export function ultimoFallo(slug) {
  return fallos.get(slug) ?? null;
}

export async function maybeResetDemo(slug) {
  if (!esSlugDemo(slug)) return;
  if (process.env.DEMO_RESET_DISABLED === "1") return;
  const now = Date.now();
  if (now - (ultimoIntento.get(slug) ?? 0) < THROTTLE_MS) return;
  ultimoIntento.set(slug, now);

  const SCHEMA = `crm_${slug}`;
  const GOLDEN = schemaDorado(slug);

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
        `SELECT pg_try_advisory_xact_lock(hashtext('${SCHEMA}_reset')) AS ok`
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
    fallos.delete(slug);
    if (process.env.NODE_ENV !== "production") {
      console.log(`[demo-reset] ${slug} restaurada desde su foto dorada en ${Date.now() - t0} ms`);
    }
  } catch (err) {
    // Sigue sin lanzar —la demo en pie y sucia es mejor que un 500—, pero ya no
    // se pierde: queda en memoria para `scripts/comprobar-demos.js` y sale por
    // consola SIEMPRE, también en producción. Antes el console.error existía;
    // lo que faltaba era poder preguntar después.
    fallos.set(slug, { cuando: new Date().toISOString(), mensaje: err.message });
    console.error(`[demo-reset] ${slug}: fallo (ignorado, la demo sigue): ${err.message}`);
  }
}
