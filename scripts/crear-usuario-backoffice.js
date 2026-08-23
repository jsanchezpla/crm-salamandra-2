// @vivo — Herramienta genérica por email para crear/marcar (`soloBackoffice`) o desmarcar (`--quitar`) la cuenta que entra a admin.salamandrasolutions.com,… (leído el 19/08/2026; ver scripts/_hechos/README.md)
/**
 * crear-usuario-backoffice.js — la cuenta con la que se entra al panel interno.
 *
 * Crea (o marca) un usuario que SOLO sirve para admin.salamandrasolutions.com.
 * Con la marca `solo_backoffice` puesta, esa cuenta deja de valer en el CRM y
 * las del CRM dejan de valer en el back-office.
 *
 * ── LA CONTRASEÑA NO PASA POR LA LÍNEA DE COMANDOS ───────────────────────────
 * Se lee de la variable de entorno `BACKOFFICE_PASSWORD`, nunca de un argumento:
 * los argumentos quedan en el historial del shell y en la lista de procesos,
 * donde los ve cualquiera con acceso a la máquina. Tampoco se imprime en ningún
 * momento (regla #14).
 *
 * Si no se pasa ninguna, el script GENERA una fuerte y la escribe en un fichero
 * solo accesible por root, diciendo únicamente la ruta. Así la contraseña no
 * aparece en ninguna terminal compartida ni en el registro de nadie.
 *
 * Uso (en el VPS, dentro del contenedor):
 *   docker compose exec -T app node scripts/crear-usuario-backoffice.js salamandra@salamandrasolutions.com
 *
 *   # reutilizando una contraseña que ya tienes:
 *   BACKOFFICE_PASSWORD='...' docker compose exec -T -e BACKOFFICE_PASSWORD app \
 *     node scripts/crear-usuario-backoffice.js salamandra@salamandrasolutions.com
 *
 * Para QUITARLE la marca a una cuenta (que vuelva a ser del CRM):
 *   node scripts/crear-usuario-backoffice.js <email> --quitar
 *
 * Idempotente: si la cuenta ya existe, solo le pone la marca y —si le das
 * contraseña— se la cambia.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import bcrypt from "bcrypt";
import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";

const TENANT = "salamandra_solutions";
const FICHERO_CLAVE = "/root/.backoffice-password";
/** El mismo coste que usa el resto del CRM. Regla de seguridad del proyecto. */
const BCRYPT_ROUNDS = 12;

function log(m) { process.stdout.write(`  ${m}\n`); }

/** Contraseña larga y sin ambigüedades visuales (nada de l/I/0/O). */
function generarClave() {
  const abc = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(crypto.randomFillSync(new Uint32Array(24)))
    .map((n) => abc[n % abc.length])
    .join("");
}

async function main() {
  const args = process.argv.slice(2);
  const email = (args.find((a) => !a.startsWith("--")) || "").trim().toLowerCase();
  const quitar = args.includes("--quitar");

  process.stdout.write("\n▶ Cuenta del panel interno\n");

  if (!email) {
    process.stderr.write("\n✗ Falta el email.\n  Uso: crear-usuario-backoffice.js <email> [--quitar]\n\n");
    process.exit(1);
  }

  getMasterDb();
  const { Tenant, User } = getMasterModels();

  const tenant = await Tenant.findOne({ where: { slug: TENANT } });
  if (!tenant) {
    process.stderr.write(`\n✗ No existe el tenant "${TENANT}".\n\n`);
    process.exit(1);
  }

  const existente = await User.findOne({ where: { email } });

  // ── Quitar la marca ──────────────────────────────────────────────────────
  if (quitar) {
    if (!existente) {
      process.stderr.write(`\n✗ No hay ningún usuario con ese email.\n\n`);
      process.exit(1);
    }
    await existente.update({ soloBackoffice: false });
    log(`✓ ${email} vuelve a ser una cuenta normal del CRM`);
    log("  (y deja de poder entrar al panel interno)");
    process.exit(0);
  }

  // ── Contraseña ───────────────────────────────────────────────────────────
  const dada = (process.env.BACKOFFICE_PASSWORD || "").trim();
  let clave = dada;
  let generada = false;

  if (!clave) {
    if (existente) {
      // Ya existe y no se pide cambiarla: se respeta la que tenga.
      clave = null;
    } else {
      clave = generarClave();
      generada = true;
    }
  } else if (clave.length < 12) {
    process.stderr.write("\n✗ Esa contraseña es demasiado corta (mínimo 12).\n\n");
    process.exit(1);
  }

  // ── Crear o actualizar ───────────────────────────────────────────────────
  if (existente) {
    const cambios = { soloBackoffice: true };
    if (clave) cambios.passwordHash = await bcrypt.hash(clave, BCRYPT_ROUNDS);
    await existente.update(cambios);
    log(`✓ ${email} marcada como cuenta del panel interno`);
    if (clave) log("  · contraseña actualizada");
  } else {
    await User.create({
      email,
      passwordHash: await bcrypt.hash(clave, BCRYPT_ROUNDS),
      role: "admin",
      tenantId: tenant.id,
      moduleAccess: ["all"],
      soloBackoffice: true,
    });
    log(`✓ ${email} creada como cuenta del panel interno`);
  }

  if (generada) {
    // Preferido: dejarla donde solo root puede leerla, sin pasar por ninguna
    // pantalla. Pero este script suele correr DENTRO del contenedor, que va como
    // usuario `nextjs` y no puede escribir en /root — y aunque pudiera, sería el
    // sistema de ficheros del contenedor, que desaparece al recrearlo.
    //
    // Si no se puede escribir, se enseña UNA vez, que es lo que ya hace el alta
    // de clientes del panel. Es peor que un fichero, pero mucho mejor que
    // fallar dejando una cuenta con una contraseña que nadie conoce.
    let guardada = false;
    try {
      fs.writeFileSync(FICHERO_CLAVE, `${email}\n${clave}\n`, { mode: 0o600 });
      guardada = true;
    } catch {
      /* sin permiso: se enseña abajo */
    }

    log("");
    if (guardada) {
      log(`· Contraseña generada y guardada en ${FICHERO_CLAVE} (solo root)`);
      log("  Léela con:  cat /root/.backoffice-password");
      log("  Guárdala en tu gestor de contraseñas y borra el fichero.");
    } else {
      log("· Contraseña generada. SE ENSEÑA UNA SOLA VEZ:");
      log("");
      log(`      ${clave}`);
      log("");
      log("  Cópiala a tu gestor de contraseñas AHORA y limpia la pantalla");
      log("  (en la terminal: clear && history -c).");
    }
  }

  log("");
  log("Esta cuenta SOLO entra por admin.salamandrasolutions.com.");
  log("Las cuentas normales del CRM ya no entran ahí.");
  process.stdout.write("\n");
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ ${err.message}\n\n`);
  process.exit(1);
});
