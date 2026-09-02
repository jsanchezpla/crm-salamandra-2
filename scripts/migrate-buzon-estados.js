/**
 * scripts/migrate-buzon-estados.js — los estados viejos del Buzón, al
 * vocabulario del 02/09/2026 (Rodrigo: «tiene que pasar de Nuevo a Enviado al
 * registro»).
 *
 *   en_curso  → enviado   (era lo que marcaba /mailbox al apuntar la tarea)
 *   esperando → nuevo     (habíamos contestado; en qué tejado está la pelota
 *                          ya lo dicen las fechas, no el estado)
 *
 * Ensayo por defecto: cuenta y dice qué haría. Con `--confirm` escribe.
 * Es DATOS, no estructura, por eso no va dentro de `migrate-buzon.js`: aquel
 * se lanza sin mirar en cada despliegue y este se lanza una vez, con permiso.
 * Mientras no se lance, la app lee las filas viejas igual (`estadoActual` en
 * `lib/buzon/buzon.js`): no hay prisa, hay orden.
 *
 *   local:  node --env-file=.env.local scripts/migrate-buzon-estados.js [--confirm]
 *   VPS:    docker exec crm-salamandra-app-1 node scripts/migrate-buzon-estados.js [--confirm]
 *
 * Idempotente: la segunda vez no encuentra nada que cambiar.
 */

import { Sequelize, QueryTypes } from "sequelize";

const CAMBIOS = [
  { de: "en_curso", a: "enviado" },
  { de: "esperando", a: "nuevo" },
];

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Falta DATABASE_URL");
    process.exit(1);
  }
  const confirmar = process.argv.includes("--confirm");
  const s = new Sequelize(process.env.DATABASE_URL, { logging: false });

  const antes = await s.query(
    `SELECT estado, count(*)::int AS n FROM master.buzon_avisos GROUP BY estado ORDER BY estado`,
    { type: QueryTypes.SELECT }
  );
  console.log("Antes:", antes.map((f) => `${f.estado}=${f.n}`).join("  ") || "(sin avisos)");

  let tocados = 0;
  for (const { de, a } of CAMBIOS) {
    const n = antes.find((f) => f.estado === de)?.n ?? 0;
    if (!n) continue;
    tocados += n;
    if (!confirmar) {
      console.log(`[ensayo] ${n} aviso(s) pasarían de «${de}» a «${a}».`);
      continue;
    }
    await s.query(`UPDATE master.buzon_avisos SET estado = :a WHERE estado = :de`, {
      replacements: { a, de },
    });
    console.log(`✓ ${n} aviso(s): «${de}» → «${a}».`);
  }

  if (!tocados) console.log("Nada que cambiar: no queda ningún estado viejo.");
  else if (!confirmar) console.log("Para hacerlo de verdad: --confirm");

  if (confirmar && tocados) {
    const despues = await s.query(
      `SELECT estado, count(*)::int AS n FROM master.buzon_avisos GROUP BY estado ORDER BY estado`,
      { type: QueryTypes.SELECT }
    );
    console.log("Después:", despues.map((f) => `${f.estado}=${f.n}`).join("  "));
  }
  await s.close();
}

main().catch((err) => {
  console.error(err?.message ?? err);
  process.exit(1);
});
