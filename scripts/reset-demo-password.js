// @vivo — Utilidad de desarrollo local de 36 líneas: devuelve al admin de la demo (`admin@demo.salamandra`) la contraseña canónica `Admin1234!` que ponen… (leído el 19/08/2026; ver scripts/_hechos/README.md)
/**
 * reset-demo-password.js — Resetea la contraseña del admin del tenant demo
 *
 * Uso: node --env-file=.env.local scripts/reset-demo-password.js
 */

import bcrypt from "bcrypt";
import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";

const EMAIL = "admin@demo.salamandra";
const NEW_PASSWORD = "Admin1234!";

async function main() {
  getMasterDb();
  const { User } = getMasterModels();

  const user = await User.findOne({ where: { email: EMAIL } });
  if (!user) {
    process.stderr.write(`✗ Usuario "${EMAIL}" no encontrado. Ejecuta seed-demo.js primero.\n`);
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(NEW_PASSWORD, 12);
  await user.update({ passwordHash });

  process.stdout.write(`\n✓ Contraseña reseteada\n`);
  process.stdout.write(`  Email:      ${EMAIL}\n`);
  process.stdout.write(`  Contraseña: ${NEW_PASSWORD}\n\n`);
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
