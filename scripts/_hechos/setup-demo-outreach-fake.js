/**
 * setup-demo-outreach-fake.js — deja el tenant `demo` listo para DEMOSTRAR
 * Captación sin gastar API ni enviar correos reales.
 *
 * Fija en settings.integrations (cifrado, igual que la app):
 *   - anthropicApiKey = clave FICTICIA → habilita el botón "Analizar con IA".
 *     (Con OUTREACH_FAKE_AI=1 el análisis lo hace el proveedor falso: 0 coste.)
 *   - resendApiKey = "dry-run" → habilita "Enviar correo" en modo SIMULADO
 *     (resendClient detecta dry-run y NO envía nada).
 *   - resendFromEmail = remitente de demo (evita el error de "from" vacío).
 *
 * Solo toca el tenant demo. Idempotente. NO usar en producción (son claves falsas).
 * Uso: node --env-file=.env.local scripts/setup-demo-outreach-fake.js
 */
import { Sequelize } from "sequelize";
import { encryptSecret } from "../lib/crypto/secretBox.js";

const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

async function main() {
  const [rows] = await s.query(`SELECT id, settings FROM master.tenants WHERE slug = 'demo'`);
  if (!rows.length) throw new Error("tenant demo no encontrado");
  const settings = rows[0].settings || {};
  const integrations = settings.integrations || {};

  const merged = {
    ...settings,
    integrations: {
      ...integrations,
      anthropicApiKey: encryptSecret("sk-ant-demo-FAKE-no-real-key"),
      resendApiKey: encryptSecret("dry-run"),
      resendFromEmail: integrations.resendFromEmail || "captacion@demo.salamandra",
    },
  };

  await s.query(`UPDATE master.tenants SET settings = $1::jsonb, updated_at = now() WHERE slug = 'demo'`, {
    bind: [JSON.stringify(merged)],
  });

  process.stdout.write("\n✓ Demo listo para Captación simulada:\n");
  process.stdout.write("  · Anthropic: clave FICTICIA (botón Analizar habilitado; IA falsa por OUTREACH_FAKE_AI=1)\n");
  process.stdout.write("  · Resend: 'dry-run' (botón Enviar habilitado; envío SIMULADO, no manda nada)\n");
  process.stdout.write("  · Remitente: captacion@demo.salamandra\n");
  process.stdout.write("\n  (la config del tenant se cachea 60s; reinicio del server o esperar 1 min)\n\n");
  await s.close();
  process.exit(0);
}

main().catch(async (e) => {
  process.stderr.write(`\n✗ Error: ${e.message}\n${e.stack}\n`);
  await s.close();
  process.exit(1);
});
