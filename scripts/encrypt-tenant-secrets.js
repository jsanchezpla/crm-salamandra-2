/**
 * encrypt-tenant-secrets.js — Cifra EN REPOSO las API keys de IA ya guardadas
 * en master.tenants.settings.integrations (anthropicApiKey, googlePlacesApiKey).
 *
 * Idempotente: salta las que ya están cifradas (prefijo enc:v1:). Requiere que
 * SETTINGS_ENCRYPTION_KEY esté configurada (es lo que se usa para cifrar).
 *
 * Ejecutar UNA vez tras activar el cifrado, para blindar las claves que se
 * hubieran guardado antes en claro. Las nuevas ya se guardan cifradas solas.
 *
 * Uso local:  node --env-file=.env.local scripts/encrypt-tenant-secrets.js
 * Uso VPS:    docker exec crm-salamandra-app-1 node scripts/encrypt-tenant-secrets.js
 */

import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { invalidateTenantCache } from "../lib/tenant/tenantResolver.js";
import { encryptSecret, isEncrypted } from "../lib/crypto/secretBox.js";

if (!process.env.SETTINGS_ENCRYPTION_KEY?.trim()) {
  process.stderr.write("\n✗ SETTINGS_ENCRYPTION_KEY no configurada. Ponla antes de cifrar.\n\n");
  process.exit(1);
}

const FIELDS = ["anthropicApiKey", "googlePlacesApiKey", "resendApiKey"];

getMasterDb();
const { Tenant } = getMasterModels();
const tenants = await Tenant.findAll();

let changed = 0;
let alreadyEnc = 0;

for (const t of tenants) {
  const settings = t.settings ? { ...t.settings } : {};
  if (!settings.integrations) continue;
  const integ = { ...settings.integrations };
  let dirty = false;

  for (const f of FIELDS) {
    const v = integ[f];
    if (typeof v !== "string" || !v.trim()) continue;
    if (isEncrypted(v)) {
      alreadyEnc++;
    } else {
      integ[f] = encryptSecret(v.trim());
      dirty = true;
    }
  }

  if (dirty) {
    settings.integrations = integ;
    await t.update({ settings });
    invalidateTenantCache(t.slug);
    changed++;
    process.stdout.write(`  ✓ ${t.slug}: claves cifradas\n`);
  }
}

process.stdout.write(`\n✓ Hecho. Claves cifradas ahora: ${changed} · ya estaban cifradas: ${alreadyEnc}.\n\n`);
process.exit(0);
