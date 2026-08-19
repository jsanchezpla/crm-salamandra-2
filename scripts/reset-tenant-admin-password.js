// @vivo — Herramienta de mantenimiento genérica por `<email>`: «Resetea la password de un usuario admin en master.users. (leído el 19/08/2026; ver scripts/_hechos/README.md)
/**
 * reset-tenant-admin-password.js
 *
 * Resetea la password de un usuario admin en `master.users`. Genera una
 * password aleatoria de 12 chars (base64), la hashea con bcrypt 12 rounds
 * y actualiza la fila. Imprime la nueva password UNA SOLA VEZ en stdout.
 *
 * Uso:
 *   node scripts/reset-tenant-admin-password.js <email>
 *
 *   # Dentro del container en VPS:
 *   docker compose exec app node scripts/reset-tenant-admin-password.js admin@nutri-laura.es
 *
 * Captura la nueva password con `tee` y NO la pegues en chats — los
 * secrets de producción no salen del entorno seguro (regla 14 CLAUDE.md).
 */

import crypto from "node:crypto";
import bcrypt from "bcrypt";
import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";

async function main() {
  const email = process.argv[2];
  if (!email) {
    process.stderr.write("\n✗ Falta argumento: email del usuario.\n");
    process.stderr.write("  Uso: node scripts/reset-tenant-admin-password.js <email>\n\n");
    process.exit(1);
  }

  getMasterDb();
  const { User } = getMasterModels();

  const user = await User.findOne({ where: { email: email.toLowerCase() } });
  if (!user) {
    process.stderr.write(`\n✗ Usuario no encontrado: ${email}\n\n`);
    process.exit(1);
  }

  const rawPassword = crypto.randomBytes(9).toString("base64").slice(0, 12);
  const passwordHash = await bcrypt.hash(rawPassword, 12);

  // tokenVersion++ invalida los refresh tokens existentes del usuario,
  // forzando re-login en cualquier sesión activa.
  await user.update({ passwordHash, tokenVersion: (user.tokenVersion ?? 0) + 1 });

  process.stdout.write("\n════════════════════════════════════════\n");
  process.stdout.write(" Password reseteada\n");
  process.stdout.write("════════════════════════════════════════\n");
  process.stdout.write(` Email:    ${user.email}\n`);
  process.stdout.write(` Password: ${rawPassword}\n`);
  process.stdout.write("════════════════════════════════════════\n");
  process.stdout.write(" Guárdala ahora; no se volverá a mostrar.\n");
  process.stdout.write(" Sesiones activas invalidadas (tokenVersion++).\n");
  process.stdout.write("════════════════════════════════════════\n\n");

  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
