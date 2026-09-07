/**
 * alta-por-paciente.js — pone o quita a un cliente el alta que empieza por el
 * paciente (07/09/2026, AV-0051 de Aumenta por Rodrigo).
 *
 * Es el peldaño 3 de la regla #16 (CLAUDE.md): un «esto sí / esto no» del
 * módulo Pacientes que vive en `tenant_modules.feature_flags` y que lee la
 * página de Clientes en servidor (`lib/clients/altaPorPaciente.js`). PUESTO,
 * el alta de Clientes pregunta primero por el paciente y después por la
 * familia («Padre, madre o tutor que abre la ficha»); QUITADO —lo normal—, el
 * alta de siempre, que empieza por la familia. Lo que se guarda es lo mismo.
 *
 * Sin código, sin despliegue: la caché del tenant se invalida aquí y la
 * pantalla lo lee en la siguiente carga.
 *
 * USO
 *   node --env-file=.env.local scripts/alta-por-paciente.js <slug>            (solo enseña)
 *   node --env-file=.env.local scripts/alta-por-paciente.js <slug> --poner
 *   node --env-file=.env.local scripts/alta-por-paciente.js <slug> --quitar
 *
 * En el VPS:
 *   docker exec crm-salamandra-app-1 node scripts/alta-por-paciente.js <slug> --poner
 */

import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { invalidateTenantCache } from "../lib/tenant/tenantResolver.js";
import { FLAG_ALTA_POR_PACIENTE, MODULO_ALTA_POR_PACIENTE } from "../lib/clients/altaPorPaciente.js";

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const [slug] = argv.filter((a) => !a.startsWith("--"));

function die(msg) {
  process.stderr.write(`\n✗ ${msg}\n\n`);
  process.exit(1);
}

if (!slug) die("Falta el slug.\n  Uso: node --env-file=.env.local scripts/alta-por-paciente.js <slug> [--poner|--quitar]");
if (flags.has("--poner") && flags.has("--quitar")) die("--poner y --quitar a la vez no tiene sentido.");

const db = getMasterDb();
const { Tenant, TenantModule } = getMasterModels();

const tenant = await Tenant.findOne({ where: { slug } });
if (!tenant) die(`No existe el tenant "${slug}"`);

const fila = await TenantModule.findOne({ where: { tenantId: tenant.id, moduleKey: MODULO_ALTA_POR_PACIENTE } });
if (!fila) die(`"${slug}" no tiene el módulo ${MODULO_ALTA_POR_PACIENTE}. Primero: scripts/enable-module.js ${slug} ${MODULO_ALTA_POR_PACIENTE}`);

const tiene = fila.featureFlags?.[FLAG_ALTA_POR_PACIENTE] === true;
process.stdout.write(`\n${slug} · ${MODULO_ALTA_POR_PACIENTE} · el alta empieza por el paciente: ${tiene ? "SÍ" : "no (lo normal: empieza por la familia)"}\n`);

const quiere = flags.has("--poner") ? true : flags.has("--quitar") ? false : null;
if (quiere === null) {
  process.stdout.write("  (solo enseño; --poner o --quitar para cambiarlo)\n\n");
} else if (quiere === tiene) {
  process.stdout.write(`  Ya estaba ${quiere ? "puesto" : "quitado"}. Nada que hacer.\n\n`);
} else {
  const nuevos = { ...(fila.featureFlags ?? {}) };
  if (quiere) nuevos[FLAG_ALTA_POR_PACIENTE] = true;
  else delete nuevos[FLAG_ALTA_POR_PACIENTE];
  fila.featureFlags = nuevos;
  fila.changed("featureFlags", true);
  await fila.save();
  invalidateTenantCache(slug);
  process.stdout.write(`  ✓ Ahora ${quiere ? "el alta de Clientes empieza por el paciente" : "el alta vuelve a empezar por la familia"}. La pantalla lo lee en la siguiente carga.\n\n`);
}

await db.close();
