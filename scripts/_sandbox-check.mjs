// Diagnóstico solo lectura del acceso al tenant sandbox en local.
// Uso: node --env-file=.env.local scripts/_sandbox-check.mjs [passwordAProbar]
import bcrypt from "bcrypt";
import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";

const EMAIL = "admin@sandbox.local";
const test = process.argv[2] || null;

getMasterDb();
const { User, Tenant, TenantModule } = getMasterModels();

const user = await User.scope("withPassword").findOne({ where: { email: EMAIL } });
if (!user) {
  console.log(`✗ NO existe el usuario ${EMAIL} en master.users`);
  process.exit(0);
}
console.log(`✓ Usuario: ${user.email}`);
console.log(`  role: ${user.role} · tenantId: ${user.tenantId}`);
console.log(`  moduleAccess: ${JSON.stringify(user.moduleAccess)}`);
console.log(`  lastLoginAt: ${user.lastLoginAt}`);
console.log(`  hash presente: ${user.passwordHash ? "sí" : "NO"}`);

const tenant = await Tenant.findByPk(user.tenantId);
if (!tenant) console.log("✗ El tenant del usuario NO existe");
else {
  console.log(`✓ Tenant: ${tenant.name} (slug: ${tenant.slug}) · status: ${tenant.status}`);
  if (tenant.status !== "active") console.log("  ⚠ status != 'active' → el login lo rechaza");
  const mods = await TenantModule.findAll({ where: { tenantId: tenant.id } });
  console.log(`  módulos activos: ${mods.filter((m) => m.enabled).length}/${mods.length}`);
}

if (test) {
  const ok = await bcrypt.compare(test, user.passwordHash);
  console.log(`\n${ok ? "✓" : "✗"} La contraseña probada ${ok ? "COINCIDE" : "NO coincide"}`);
}
process.exit(0);
