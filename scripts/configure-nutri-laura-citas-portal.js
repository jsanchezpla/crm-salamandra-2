// @vivo — Slug a fuego (`const SLUG = "nutri_laura"`) y ya sustituido por `configure-portal-citas.js <slug>`, cuya cabecera lo dice textualmente; citas.md y… (leído el 19/08/2026; ver scripts/_hechos/README.md)
/**
 * configure-nutri-laura-citas-portal.js
 *
 * Activa el portal público "Mis citas" (SSO WordPress) para nutri_laura.
 * Setea `tenant.settings.widget.sso = { enabled: true }` (merge, preservando
 * `widget.auth` del widget de reserva).
 *
 * IMPORTANTE: el flag NO es el secreto. Los secretos viven SOLO en env (regla #14):
 *   - WIDGET_SSO_SECRETS='{"nutri_laura":"<hex 32B>"}'  (compartido con WordPress)
 *   - CITAS_PORTAL_SESSION_SECRET='<hex 32B distinto>'   (sessionToken del CRM)
 * Sin ellos, POST /citas-portal/session responde 403 (secreto WP ausente) o 500.
 *
 * Idempotente.
 *
 * Uso local: node --env-file=.env.local scripts/configure-nutri-laura-citas-portal.js
 * Uso VPS:   docker compose exec app node scripts/configure-nutri-laura-citas-portal.js
 */

import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { invalidateTenantCache } from "../lib/tenant/tenantResolver.js";

const SLUG = "nutri_laura";

async function main() {
  process.stdout.write("\n▶ Activando portal 'Mis citas' (SSO) para nutri_laura...\n");

  getMasterDb();
  const { Tenant } = getMasterModels();

  const tenant = await Tenant.findOne({ where: { slug: SLUG } });
  if (!tenant) {
    process.stderr.write(`  ✗ Tenant "${SLUG}" no encontrado.\n`);
    process.exit(1);
  }

  const settings = {
    ...(tenant.settings || {}),
    widget: {
      ...(tenant.settings?.widget || {}),
      sso: { ...(tenant.settings?.widget?.sso || {}), enabled: true },
    },
  };
  await tenant.update({ settings });

  invalidateTenantCache(SLUG);

  process.stdout.write("  ✓ settings.widget.sso.enabled = true\n");
  process.stdout.write(
    `  · WIDGET_SSO_SECRETS presente: ${process.env.WIDGET_SSO_SECRETS ? "sí" : "NO — configúralo"}\n`
  );
  process.stdout.write(
    `  · CITAS_PORTAL_SESSION_SECRET presente: ${process.env.CITAS_PORTAL_SESSION_SECRET ? "sí" : "NO — configúralo"}\n`
  );
  process.stdout.write(
    "\n  · Falta: pegar el MISMO secreto de WIDGET_SSO_SECRETS[nutri_laura] en el snippet PHP de WordPress\n" +
      "    (ver docs/modules/citas-portal-wordpress-snippet.php).\n\n"
  );
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
