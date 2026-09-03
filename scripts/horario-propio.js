/**
 * horario-propio.js — quita o devuelve el horario propio por persona a un
 * cliente (03/09/2026).
 *
 * Es el peldaño 3 de la regla #16 (CLAUDE.md): un «esto sí / esto no» del
 * módulo Citas que vive en `tenant_modules.feature_flags` y que leen el menú
 * lateral, la ficha de Equipo, `/api/team` y la agenda pública
 * (`lib/citas/horarioPropio.js`). QUITADO, el centro deja de ver «Mi horario»
 * y el bloque «Horario de trabajo» de cada ficha, y los avisos de «no tiene su
 * horario puesto» no salen: es un equipo sin hora fija de entrada ni salida al
 * que las citas se las coloca administración (Aumenta). Con horario propio
 * —lo normal— todo sigue como siempre (Laura, cuyas pacientes reservan solas).
 *
 * Sin código, sin despliegue: la caché del tenant se invalida aquí y el menú
 * lo lee en la siguiente carga. Los horarios guardados no se tocan.
 *
 * USO
 *   node --env-file=.env.local scripts/horario-propio.js <slug>              (solo enseña)
 *   node --env-file=.env.local scripts/horario-propio.js <slug> --quitar
 *   node --env-file=.env.local scripts/horario-propio.js <slug> --devolver
 *
 * En el VPS:
 *   docker exec crm-salamandra-app-1 node scripts/horario-propio.js <slug> --quitar
 */

import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { invalidateTenantCache } from "../lib/tenant/tenantResolver.js";
import { FLAG_SIN_HORARIO_PROPIO, MODULO_HORARIO_PROPIO } from "../lib/citas/horarioPropio.js";

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const [slug] = argv.filter((a) => !a.startsWith("--"));

function die(msg) {
  process.stderr.write(`\n✗ ${msg}\n\n`);
  process.exit(1);
}

if (!slug) die("Falta el slug.\n  Uso: node --env-file=.env.local scripts/horario-propio.js <slug> [--quitar|--devolver]");
if (flags.has("--quitar") && flags.has("--devolver")) die("--quitar y --devolver a la vez no tiene sentido.");

const db = getMasterDb();
const { Tenant, TenantModule } = getMasterModels();

const tenant = await Tenant.findOne({ where: { slug } });
if (!tenant) die(`No existe el tenant "${slug}"`);

const citas = await TenantModule.findOne({ where: { tenantId: tenant.id, moduleKey: MODULO_HORARIO_PROPIO } });
if (!citas) die(`"${slug}" no tiene el módulo ${MODULO_HORARIO_PROPIO}. Primero: scripts/enable-module.js ${slug} ${MODULO_HORARIO_PROPIO}`);

// La bandera dice «SIN horario propio»; aquí se habla en positivo.
const tiene = citas.featureFlags?.[FLAG_SIN_HORARIO_PROPIO] !== true;
process.stdout.write(`\n${slug} · ${MODULO_HORARIO_PROPIO} · horario propio por persona: ${tiene ? "SÍ (lo normal)" : "quitado"}\n`);

const quiere = flags.has("--quitar") ? false : flags.has("--devolver") ? true : null;
if (quiere === null) {
  process.stdout.write("  (solo enseño; --quitar o --devolver para cambiarlo)\n\n");
} else if (quiere === tiene) {
  process.stdout.write(`  Ya estaba ${quiere ? "con horario propio" : "quitado"}. Nada que hacer.\n\n`);
} else {
  const nuevos = { ...(citas.featureFlags ?? {}) };
  if (quiere) delete nuevos[FLAG_SIN_HORARIO_PROPIO];
  else nuevos[FLAG_SIN_HORARIO_PROPIO] = true;
  citas.featureFlags = nuevos;
  citas.changed("featureFlags", true);
  await citas.save();
  invalidateTenantCache(slug);
  process.stdout.write(`  ✓ Ahora ${quiere ? "CON horario propio: vuelven «Mi horario» y el editor de la ficha" : "SIN horario propio: «Mi horario» y el editor de la ficha dejan de ofrecerse"}. El menú lo lee en la siguiente carga.\n\n`);
}

await db.close();
