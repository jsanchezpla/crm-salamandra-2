/**
 * podar-buzon.js — retención de los avisos que nos mandan los clientes.
 *
 * QUÉ RESUELVE, Y POR QUÉ NO ES OPCIONAL. `master.buzon_avisos` guarda TEXTO
 * LIBRE escrito por usuarios de todos los clientes, en la base compartida. Eso
 * es una excepción deliberada a la regla que prohíbe duplicar datos personales
 * en master (`docs/base/db-conventions.md` §6.2), y una excepción sin fecha de
 * caducidad deja de ser una excepción: por mucho que el formulario pida que no
 * se escriban nombres de pacientes, alguien acabará escribiendo uno. Este script
 * es el tercer freno, junto al aviso del formulario y a que la auditoría nunca
 * guarde el cuerpo.
 *
 * QUÉ SE LLEVA: solo avisos RESUELTOS y con más de dos años. Nunca uno abierto,
 * por viejo que sea: si sigue abierto es que sigue sin arreglarse. Y con cada
 * aviso se van su hilo (cascada de la BD) y sus capturas del disco — que no las
 * borra nadie más, porque `borrar-tenant.js` no toca `uploads/`.
 *
 * SIMULA POR DEFECTO. Sin `--confirm` cuenta lo que se llevaría y no borra nada.
 *
 * Uso:
 *   node --env-file=.env.local scripts/podar-buzon.js            (simula)
 *   docker exec crm-salamandra-app-1 node scripts/podar-buzon.js --confirm
 */

import { Sequelize } from "sequelize";

import { borrarCarpeta } from "../lib/buzon/buzonStorage.js";

const CONFIRM = process.argv.includes("--confirm");

// Suelo de un año, igual que la auditoría: si alguien pasa un plazo más corto
// por variable, se ignora. Un aviso es la prueba de una conversación con un
// cliente y no se tira a la ligera.
const DIAS = Math.max(365, Number(process.env.RETENCION_BUZON_DIAS) || 730);

function log(m) { process.stdout.write(`  ${m}\n`); }

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Falta DATABASE_URL");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { logging: false });

  process.stdout.write(`\n▶ Buzón · enviados al Registro hace más de ${DIAS} días${CONFIRM ? "" : "  (SIMULACRO)"}\n`);

  let candidatos;
  try {
    const [filas] = await s.query(`
      -- Cerrado = enviado al Registro (02/09/2026). La fecha: cuándo se envió;
      -- en lo anterior al botón, cuándo se resolvió; y si no hay ninguna de
      -- las dos (lo que marcó /mailbox a mano), la última vez que se tocó.
      SELECT id, numero, tenant_slug,
             COALESCE(registro_enviado_at, resuelto_at, updated_at) AS cerrado_at
        FROM master.buzon_avisos
       WHERE estado = 'enviado'
         AND COALESCE(registro_enviado_at, resuelto_at, updated_at) < now() - interval '${DIAS} days'
       ORDER BY cerrado_at ASC
    `);
    candidatos = filas;
  } catch (err) {
    if ((err?.parent?.code ?? err?.original?.code) === "42P01") {
      log("La tabla no existe todavía: nada que podar.");
      await s.close();
      return;
    }
    throw err;
  }

  if (!candidatos.length) {
    log("Nada que podar.");
    await s.close();
    return;
  }

  const [[{ n: adjuntos }]] = await s.query(
    `SELECT count(*)::int AS n FROM master.buzon_adjuntos WHERE aviso_id IN (:ids)`,
    { replacements: { ids: candidatos.map((c) => c.id) } }
  ).then((r) => [r[0]]);

  log(`${candidatos.length} aviso(s) y ${adjuntos} captura(s).`);
  for (const c of candidatos.slice(0, 10)) {
    log(`  · AV-${String(c.numero).padStart(4, "0")} (${c.tenant_slug}) cerrado el ${new Date(c.cerrado_at).toISOString().slice(0, 10)}`);
  }
  if (candidatos.length > 10) log(`  · … y ${candidatos.length - 10} más`);

  if (!CONFIRM) {
    log("");
    log("Simulacro: no se ha borrado nada. Repite con --confirm.");
    await s.close();
    return;
  }

  // Primero el disco y después la fila: al revés, un fallo a mitad dejaría
  // ficheros que ya no apunta nadie y que nadie va a encontrar nunca.
  for (const c of candidatos) {
    await borrarCarpeta(c.tenant_slug, c.id);
  }
  const [, meta] = await s.query(`DELETE FROM master.buzon_avisos WHERE id IN (:ids)`, {
    replacements: { ids: candidatos.map((c) => c.id) },
  });

  log(`Podados ${meta?.rowCount ?? candidatos.length} aviso(s), con su hilo y sus capturas.`);
  await s.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
