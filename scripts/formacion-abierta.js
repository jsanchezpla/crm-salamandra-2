/**
 * formacion-abierta.js — enciende o apaga el interruptor «formación abierta»
 * de un cliente (18/08/2026).
 *
 * Es el peldaño 3 de la regla #16 (CLAUDE.md): un «esto sí / esto no» del
 * módulo Formación que vive en `tenant_modules.feature_flags` y que leen la
 * portada de /formacion y el menú lateral (`lib/training/formacionAbierta.js`).
 * Encendido, el centro deja de ver Empresas, Cuestionarios y el botón de
 * sincronizar con WordPress: es un centro que vende cursos a personas, una a
 * una (Aumenta). Apagado —lo normal— ve la portada completa (Retorika, Laura).
 *
 * Sin código, sin despliegue: la caché del tenant se invalida aquí y la
 * portada lo lee en la siguiente carga.
 *
 * USO
 *   node --env-file=.env.local scripts/formacion-abierta.js <slug>             (solo enseña)
 *   node --env-file=.env.local scripts/formacion-abierta.js <slug> --encender
 *   node --env-file=.env.local scripts/formacion-abierta.js <slug> --apagar
 *
 * En el VPS:
 *   docker exec crm-salamandra-app-1 node scripts/formacion-abierta.js <slug> --encender
 */

import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { invalidateTenantCache } from "../lib/tenant/tenantResolver.js";
import { FLAG_FORMACION_ABIERTA } from "../lib/training/formacionAbierta.js";

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const [slug] = argv.filter((a) => !a.startsWith("--"));

function die(msg) {
  process.stderr.write(`\n✗ ${msg}\n\n`);
  process.exit(1);
}

if (!slug) die("Falta el slug.\n  Uso: node --env-file=.env.local scripts/formacion-abierta.js <slug> [--encender|--apagar]");
if (flags.has("--encender") && flags.has("--apagar")) die("--encender y --apagar a la vez no tiene sentido.");

const db = getMasterDb();
const { Tenant, TenantModule } = getMasterModels();

const tenant = await Tenant.findOne({ where: { slug } });
if (!tenant) die(`No existe el tenant "${slug}"`);

const training = await TenantModule.findOne({ where: { tenantId: tenant.id, moduleKey: "training" } });
if (!training) die(`"${slug}" no tiene el módulo training. Primero: scripts/enable-module.js ${slug} training`);

const actual = training.featureFlags?.[FLAG_FORMACION_ABIERTA] === true;
process.stdout.write(`\n${slug} · training · formación abierta: ${actual ? "ENCENDIDA" : "apagada"}\n`);

const quiere = flags.has("--encender") ? true : flags.has("--apagar") ? false : null;
if (quiere === null) {
  process.stdout.write("  (solo enseño; --encender o --apagar para cambiarlo)\n\n");
} else if (quiere === actual) {
  process.stdout.write(`  Ya estaba ${quiere ? "encendida" : "apagada"}. Nada que hacer.\n\n`);
} else {
  const nuevos = { ...(training.featureFlags ?? {}) };
  if (quiere) nuevos[FLAG_FORMACION_ABIERTA] = true;
  else delete nuevos[FLAG_FORMACION_ABIERTA];
  training.featureFlags = nuevos;
  training.changed("featureFlags", true);
  await training.save();
  invalidateTenantCache(slug);
  process.stdout.write(`  ✓ Ahora ${quiere ? "ENCENDIDA" : "apagada"}. La portada y el menú lo leen en la siguiente carga.\n\n`);
}

await db.close();
