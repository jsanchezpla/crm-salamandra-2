/**
 * correo-solo-oficina.js — pone o quita el interruptor «aquí el correo lo manda
 * oficina» de un centro (10/09/2026, ticket de Raquel Torralbo por Rodrigo).
 *
 * Es el peldaño 3 de la regla #16 (CLAUDE.md): un «esto sí / esto no» que vive
 * en `tenant_modules.feature_flags` de la fila `clients` y que leen el menú, la
 * pantalla /correo y los siete endpoints de `/api/correo/*`
 * (`lib/correo/quienEscribe.js`).
 *
 * PUESTO, la pantalla de Correo —escribir a muchas familias de una vez— es de
 * dirección y de quien lleve Facturación. QUITADO —lo de siempre—, la usa
 * cualquiera que tenga a quién escribir (`clients` o `outreach`).
 *
 * Nace de abrirle Clientes a las terapeutas de Aumenta: Correo no tiene módulo
 * propio, así que dárselo les habría puesto de propina la pantalla para
 * escribirle a las 1.083 familias.
 *
 * Sin código, sin despliegue: la caché del tenant se invalida aquí y las
 * pantallas lo leen en la siguiente carga.
 *
 * USO
 *   node --env-file=.env.local scripts/correo-solo-oficina.js <slug>            (solo enseña)
 *   node --env-file=.env.local scripts/correo-solo-oficina.js <slug> --poner
 *   node --env-file=.env.local scripts/correo-solo-oficina.js <slug> --quitar
 *
 * En el VPS:
 *   docker exec crm-salamandra-app-1 node scripts/correo-solo-oficina.js <slug> --poner
 */

import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { invalidateTenantCache } from "../lib/tenant/tenantResolver.js";
import { FLAG_CORREO_SOLO_OFICINA, MODULO_CORREO } from "../lib/correo/quienEscribe.js";

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const [slug] = argv.filter((a) => !a.startsWith("--"));

function die(msg) {
  process.stderr.write(`\n✗ ${msg}\n\n`);
  process.exit(1);
}

if (!slug) die("Falta el slug.\n  Uso: node --env-file=.env.local scripts/correo-solo-oficina.js <slug> [--poner|--quitar]");
if (flags.has("--poner") && flags.has("--quitar")) die("--poner y --quitar a la vez no tiene sentido.");

const db = getMasterDb();
const { Tenant, TenantModule } = getMasterModels();

const tenant = await Tenant.findOne({ where: { slug } });
if (!tenant) die(`No existe el tenant "${slug}"`);

const fila = await TenantModule.findOne({ where: { tenantId: tenant.id, moduleKey: MODULO_CORREO } });
if (!fila) die(`"${slug}" no tiene el módulo ${MODULO_CORREO}, que es donde vive la bandera.`);

const tiene = fila.featureFlags?.[FLAG_CORREO_SOLO_OFICINA] === true;
process.stdout.write(
  `\n${slug} · el correo a varias personas lo manda: ${tiene ? "SOLO OFICINA (dirección o quien lleve Facturación)" : "cualquiera con fichas o captación (lo normal)"}\n`
);

const quiere = flags.has("--poner") ? true : flags.has("--quitar") ? false : null;
if (quiere === null) {
  process.stdout.write("  (solo enseño; --poner o --quitar para cambiarlo)\n\n");
} else if (quiere === tiene) {
  process.stdout.write(`  Ya estaba ${quiere ? "puesto" : "quitado"}. Nada que hacer.\n\n`);
} else {
  const nuevos = { ...(fila.featureFlags ?? {}) };
  if (quiere) nuevos[FLAG_CORREO_SOLO_OFICINA] = true;
  else delete nuevos[FLAG_CORREO_SOLO_OFICINA];
  fila.featureFlags = nuevos;
  fila.changed("featureFlags", true);
  await fila.save();
  invalidateTenantCache(slug);
  process.stdout.write(
    `  ✓ Ahora Correo ${quiere ? "es de dirección y de quien lleve Facturación" : "lo usa cualquiera que tenga a quién escribir"}. Las pantallas lo leen en la siguiente carga.\n\n`
  );
}

await db.close();
