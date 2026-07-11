// Local-only: fija una password conocida al admin del sandbox para capturar el dossier.
// Uso: node --env-file=.env.local scripts/_dossier-setpw.mjs
import bcrypt from "bcrypt";
import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";

if (/prod|production/i.test(process.env.DATABASE_URL || "")) {
  console.error("DATABASE_URL parece de producción. Abortando.");
  process.exit(1);
}
getMasterDb();
const { User } = getMasterModels();
const email = "admin@sandbox.local";
const pw = process.argv[2] || "dossier2026";
const user = await User.findOne({ where: { email } });
if (!user) { console.error("No existe", email); process.exit(1); }
await user.update({ passwordHash: await bcrypt.hash(pw, 12) });
console.log("OK password fijada para", email);
process.exit(0);
