/**
 * configure-nutri-laura-widget-auth.js
 *
 * Activa el gate de WordPress en el widget público de citas de nutri_laura.
 *
 * Con esta config, /widget/c/nutri_laura solo permite reservar si la URL
 * incluye ?wpa=1 (lo añade WordPress cuando is_user_logged_in() es true).
 * El widget guarda ese flag en sessionStorage para que sobreviva a la
 * navegación interna (selección → /book).
 *
 * Si no hay flag, el widget muestra una pantalla pidiendo iniciar sesión
 * o registrarse, con CTAs hacia loginUrl/registerUrl.
 *
 * Idempotente.
 *
 * Uso local:  node --env-file=.env.local scripts/configure-nutri-laura-widget-auth.js
 * Uso VPS:    docker compose exec app node scripts/configure-nutri-laura-widget-auth.js
 */

import { getMasterDb, getMasterModels } from "../../lib/db/masterDb.js";
import { invalidateTenantCache } from "../../lib/tenant/tenantResolver.js";

const SLUG = "nutri_laura";

const WIDGET_AUTH = {
  required: true,
  loginUrl: "https://tunutrilaura.com/login/",
  registerUrl: "https://tunutrilaura.com/registro-de-estudiante/",
};

async function main() {
  process.stdout.write("\n▶ Activando gate de WordPress en el widget de nutri_laura...\n");

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
      auth: { ...WIDGET_AUTH },
    },
  };
  await tenant.update({ settings });

  invalidateTenantCache(SLUG);

  process.stdout.write(`  ✓ Gate activado en settings.widget.auth:\n`);
  for (const [k, v] of Object.entries(WIDGET_AUTH)) {
    process.stdout.write(`      ${k}: ${v}\n`);
  }
  process.stdout.write(
    "\n  · El widget bloqueará la reserva hasta que el iframe se cargue con ?wpa=1.\n" +
      "  · Falta añadir el snippet PHP en WordPress (ver instrucciones).\n\n"
  );
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
