/**
 * backfill-correo-cuenta.js — aprovechar el correo que ya está en la ficha.
 *
 * (26/08/2026, Jorge: «quiero que se aproveche el correo que tienen asignado de
 * alguna manera algunas cuentas».)
 *
 * Hay cuentas que entran con un nombre de usuario —`nombre_aumenta`— y por eso
 * no hay a dónde escribirles si pierden la contraseña. Pero algunas de esas
 * personas SÍ tienen su correo puesto en su ficha de empleado, que es otro sitio
 * y nadie lo estaba mirando. Este script lo copia a `users.email_contacto`.
 *
 * ── QUÉ NO HACE, Y ES LO IMPORTANTE ─────────────────────────────────────────
 * NO toca `users.email`. Esa columna es el IDENTIFICADOR con el que se entra:
 * cambiarla le cambiaría el login a una persona que está trabajando, y de golpe
 * a trece a la vez en Aumenta. Solo rellena la columna nueva.
 *
 * Tampoco pisa un correo ya puesto, ni copia uno que ya esté en uso por otra
 * cuenta (el correo sirve para entrar: repetido, señalaría a dos personas).
 *
 * ── EN SECO POR DEFECTO ─────────────────────────────────────────────────────
 * Sin `--confirm` no escribe NADA: enseña qué haría y con qué números. Esto
 * toca datos de producción, así que va por su regla — se mide, se enseña, se
 * espera el sí, y se hace copia antes.
 *
 * Uso:
 *   node --env-file=.env.local scripts/backfill-correo-cuenta.js
 *   node --env-file=.env.local scripts/backfill-correo-cuenta.js --confirm
 *   docker exec crm-salamandra-app-1 node scripts/backfill-correo-cuenta.js [--confirm]
 */

import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { correoDeCuenta, esCorreo, normalizarCorreo } from "../lib/auth/correoCuenta.js";
import { correoLibre } from "../lib/auth/correoCuentaDb.js";

const CONFIRMAR = process.argv.includes("--confirm");

function log(m) { process.stdout.write(`  ${m}\n`); }

async function main() {
  process.stdout.write(`\n▶ Correo de cuenta desde la ficha de empleado${CONFIRMAR ? "" : "  (EN SECO)"}\n\n`);

  const db = getMasterDb();
  const { Tenant, User } = getMasterModels();

  // Los slugs se leen en tiempo de ejecución, nunca a mano. Y un backfill SÍ
  // mira el estado: no se siembra nada en un cliente apagado.
  const tenants = await Tenant.findAll({
    where: { status: "active" },
    attributes: ["id", "slug"],
    order: [["slug", "ASC"]],
  });

  let mirados = 0, yaTenian = 0, rellenables = 0, sinNada = 0, chocan = 0, escritos = 0;

  for (const t of tenants) {
    const usuarios = await User.findAll({
      where: { tenantId: t.id },
      attributes: ["id", "email", "emailContacto", "role"],
    });
    if (!usuarios.length) continue;

    // La tabla puede no existir: hay clientes sin el módulo de Equipo.
    const [[hayTabla]] = await db.query(
      `SELECT to_regclass('"crm_${t.slug}"."team_members"') IS NOT NULL AS existe`
    );

    const lineas = [];
    for (const u of usuarios) {
      mirados++;
      if (correoDeCuenta(u)) { yaTenian++; continue; }

      if (!hayTabla?.existe) { sinNada++; lineas.push(["—", "sin ficha de equipo en este cliente"]); continue; }

      const [[ficha]] = await db.query(
        `SELECT email FROM "crm_${t.slug}"."team_members" WHERE user_id = :uid LIMIT 1`,
        { replacements: { uid: u.id } }
      );
      const dela = normalizarCorreo(ficha?.email);
      if (!esCorreo(dela)) { sinNada++; lineas.push([u.email, "su ficha tampoco tiene correo"]); continue; }

      const ocupado = await correoLibre(User, dela, { exceptoId: u.id });
      if (ocupado) { chocan++; lineas.push([u.email, "el correo de su ficha ya lo usa otra cuenta"]); continue; }

      rellenables++;
      if (CONFIRMAR) {
        await u.update({ emailContacto: dela });
        escritos++;
        lineas.push([u.email, "correo puesto desde su ficha ✓"]);
      } else {
        lineas.push([u.email, "se le pondría el correo de su ficha"]);
      }
    }

    if (lineas.length) {
      log(`${t.slug}`);
      // Los identificadores sí se enseñan (son nombres de usuario, no datos de
      // nadie); las DIRECCIONES no se imprimen nunca.
      for (const [quien, que] of lineas) log(`   · ${String(quien).padEnd(28)} ${que}`);
      log("");
    }
  }

  log("─".repeat(60));
  log(`cuentas miradas: ${mirados}`);
  log(`ya tenían correo: ${yaTenian}`);
  log(`${CONFIRMAR ? "rellenadas" : "se rellenarían"}: ${CONFIRMAR ? escritos : rellenables}`);
  log(`sin correo en ninguna parte: ${sinNada}`);
  if (chocan) log(`descartadas porque su correo ya lo usa otra cuenta: ${chocan}`);

  if (!CONFIRMAR) {
    log("");
    log("Esto ha sido un ensayo. Para hacerlo de verdad: --confirm");
  }
  process.stdout.write("\n");
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ ${err.message}\n\n`);
  process.exit(1);
});
