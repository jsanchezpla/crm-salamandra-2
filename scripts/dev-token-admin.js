/**
 * dev-token-admin.js — firma una sesión de admin para probar el CRM en local.
 *
 * Es el equivalente para el panel de lo que `dev-mint-wpsso.js` es para el
 * widget: permite abrir pantallas que exigen sesión sin tener que teclear una
 * contraseña en ningún sitio.
 *
 * NO crea usuarios ni toca contraseñas: firma un token para un usuario que YA
 * existe, exactamente como hace el login DESPUÉS de haber comprobado la suya.
 *
 * ── SOLO DESARROLLO ──────────────────────────────────────────────────────────
 * Se niega a funcionar si `JWT_SECRET` no está o si detecta que apunta a una
 * base de datos de producción. Un token firmado es una sesión: en producción
 * esto sería una puerta trasera, no una herramienta.
 *
 * Uso:
 *   node --env-file=.env.local scripts/dev-token-admin.js nutri_laura
 */

import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { signAccessToken } from "../lib/auth/jwt.js";

const SLUG = process.argv[2];

async function main() {
  if (!SLUG) {
    process.stderr.write("\n✗ Falta el slug.\n  Uso: dev-token-admin.js <slug>\n\n");
    process.exit(1);
  }
  if (!process.env.JWT_SECRET) {
    process.stderr.write("\n✗ Sin JWT_SECRET no se puede firmar nada.\n\n");
    process.exit(1);
  }

  // Cortafuegos: este script no debe poder usarse contra producción ni por
  // accidente (un --env-file equivocado).
  const url = process.env.DATABASE_URL || "";
  const esLocal = /localhost|127\.0\.0\.1|::1/.test(url);
  if (!esLocal) {
    process.stderr.write(
      "\n✗ DATABASE_URL no apunta a localhost. Este script es SOLO para desarrollo.\n\n"
    );
    process.exit(1);
  }

  getMasterDb();
  const { Tenant, User } = getMasterModels();
  const tenant = await Tenant.findOne({ where: { slug: SLUG } });
  if (!tenant) {
    process.stderr.write(`\n✗ Tenant "${SLUG}" no existe.\n\n`);
    process.exit(1);
  }
  const admin = await User.findOne({ where: { tenantId: tenant.id, role: "admin" } });
  if (!admin) {
    process.stderr.write(`\n✗ "${SLUG}" no tiene ningún usuario admin.\n\n`);
    process.exit(1);
  }

  const token = await signAccessToken({
    userId: admin.id, email: admin.email, role: admin.role, tenantSlug: SLUG,
  });

  process.stdout.write(
    `\n▶ Sesión de ${admin.email} (${SLUG}), válida unos minutos\n\n` +
    `  Pégalo en la consola del navegador estando en http://localhost:3000 :\n\n` +
    `document.cookie="access_token=${token}; path=/"\n\n`
  );
  process.exit(0);
}

main().catch((e) => {
  process.stderr.write(`\n✗ ${e?.message ?? e}\n\n`);
  process.exit(1);
});
