/**
 * _smoke-lead-conversion-fix.js (NO commit — script efímero)
 *
 * Smoke test del fix de conversión Lead→Cliente (mini-sprint 2026-06-16).
 *
 * Para cada tenant (nutri_laura, spain_enzymes):
 *   1. Crear lead "Test Conversion B {slug}" (stage="new").
 *   2. Simular la conversión usando los modelos Sequelize tal como hace el
 *      frontend nuevo:
 *      a) Crear Client con customFields.leadId y customFields.origin="lead".
 *      b) Update Lead con { stage, clientId } en un solo paso.
 *   3. Verificar invariantes:
 *      - lead.clientId === client.id
 *      - lead.stage === expected
 *      - client.customFields.leadId === lead.id
 *      - client.customFields.origin === "lead"
 *   4. Re-ejecutar la conversión sobre el mismo lead. El guard
 *      `if (lead.clientId) return` debe abortar antes de crear cliente.
 *      Verificar que el número de clientes con ese leadId sigue siendo 1.
 *   5. Imprimir SQL de limpieza (NO se ejecuta automáticamente).
 *
 * Uso: node --env-file=.env.local scripts/_smoke-lead-conversion-fix.js
 */

import { getTenantDb, closeAllConnections } from "../lib/db/tenantDb.js";
import { ALLOWED_STAGES } from "../lib/leads/stages.js";

const SCENARIOS = [
  {
    slug: "nutri_laura",
    expectedStage: "paciente",
    leadBody: {
      name: "Test Conversion B nutri",
      email: "test-conv-b-nutri@example.com",
      phone: "600000001",
      stage: "new",
      notes: "Smoke test 2026-06-16",
      customFields: { edad: "33", motivo: "Smoke test", info_adicional: "—" },
    },
    // Replica del body que el override de nutri-laura envía a POST /api/clients
    buildClientBody(lead) {
      return {
        name: lead.name,
        email: lead.email,
        phone: lead.phone,
        type: "individual",
        notes: lead.notes || null,
        origin: "lead",
        leadId: lead.id,
        status: "new",
        customFields: {
          edad: lead.customFields?.edad ?? null,
          motivo: lead.customFields?.motivo ?? null,
          info_adicional: lead.customFields?.info_adicional ?? null,
        },
      };
    },
  },
  {
    slug: "spain_enzymes",
    expectedStage: "won",
    leadBody: {
      name: "Test Conversion B spain",
      email: "test-conv-b-spain@example.com",
      phone: "600000002",
      stage: "new",
      notes: "Smoke test 2026-06-16",
      customFields: { empresa: "AcmeTest", pais: "ES", ciudad: "Madrid", asunto: "Smoke" },
    },
    buildClientBody(lead) {
      return {
        name: lead.name,
        email: lead.email,
        phone: lead.phone,
        company: lead.customFields?.empresa,
        country: lead.customFields?.pais,
        city: lead.customFields?.ciudad,
        topic: lead.customFields?.asunto,
        origin: "lead",
        leadId: lead.id,
        status: "new",
      };
    },
  },
];

// Replica de la lógica del endpoint POST /api/clients (route.js)
async function simulatePostClients(tenantModels, body) {
  const { Client } = tenantModels;
  if (!body.name?.trim()) throw new Error("El nombre es obligatorio");

  const extraCustom =
    body.customFields && typeof body.customFields === "object" ? body.customFields : {};
  const customFields = {
    ...extraCustom,
    company: body.company?.trim() || null,
    country: body.country?.trim() || null,
    city: body.city?.trim() || null,
    topic: body.topic?.trim() || null,
    interestedProduct: body.interestedProduct?.trim() || null,
    origin: body.origin || "manual",
    leadId: body.leadId || null,
    seStatus: body.status || "new",
  };

  return Client.create({
    name: body.name.trim(),
    type: body.type === "individual" ? "individual" : "company",
    email: body.email?.trim().toLowerCase() || null,
    phone: body.phone?.trim() || null,
    notes: body.notes?.trim() || null,
    taxId: body.taxId?.trim() || null,
    fiscalName: body.fiscalName?.trim() || null,
    fiscalAddress: body.fiscalAddress?.trim() || null,
    fiscalCity: body.fiscalCity?.trim() || null,
    fiscalZip: body.fiscalZip?.trim() || null,
    fiscalCountry: body.fiscalCountry?.trim()?.toUpperCase() || "ES",
    customFields,
  });
}

// Replica de la lógica del endpoint PATCH /api/leads/[id] (route.js)
// — limitada a los campos que envía el flujo de conversión: { stage, clientId }
async function simulatePatchLead(tenantModels, leadId, body) {
  const { Lead, Client } = tenantModels;
  const lead = await Lead.findByPk(leadId);
  if (!lead) throw new Error(`Lead ${leadId} no encontrado`);

  const allowed = ["stage", "clientId"];
  const updates = {};
  for (const key of allowed) if (key in body) updates[key] = body[key];

  if (updates.stage && !ALLOWED_STAGES.includes(updates.stage)) delete updates.stage;

  if ("clientId" in updates) {
    if (updates.clientId === null || updates.clientId === "") {
      updates.clientId = null;
    } else {
      const exists = await Client.findByPk(updates.clientId, { attributes: ["id"] });
      if (!exists) delete updates.clientId;
    }
  }

  await lead.update(updates);
  return lead;
}

// Replica del handleConvertToClient del frontend (con guard de idempotencia)
async function convertLeadToClient(tenantModels, scenario, leadInstance) {
  // GUARD DE IDEMPOTENCIA (replica el `if (lead.clientId) return` del frontend)
  if (leadInstance.clientId) {
    return { skipped: true, reason: "lead.clientId ya seteado", clientId: leadInstance.clientId };
  }

  const clientBody = scenario.buildClientBody(leadInstance);
  const client = await simulatePostClients(tenantModels, clientBody);

  const patched = await simulatePatchLead(tenantModels, leadInstance.id, {
    stage: scenario.expectedStage,
    clientId: client.id,
  });

  return { skipped: false, client, lead: patched };
}

function log(...args) {
  process.stdout.write(args.join(" ") + "\n");
}
function header(msg) {
  process.stdout.write(`\n══ ${msg} ${"═".repeat(Math.max(0, 60 - msg.length))}\n`);
}

async function runScenario(scenario) {
  header(`Tenant: ${scenario.slug}`);
  const { models: tenantModels, sequelize } = getTenantDb(scenario.slug);
  const { Lead, Client } = tenantModels;

  // ── Limpieza pre-run idempotente (por si quedó algo de runs anteriores) ──
  const stale = await Lead.findAll({ where: { email: scenario.leadBody.email } });
  for (const l of stale) {
    if (l.clientId) await Client.destroy({ where: { id: l.clientId } });
    await l.destroy();
  }
  await Client.destroy({ where: { email: scenario.leadBody.email } });

  // ── 1. Crear lead ───────────────────────────────────────────────────────
  const lead = await Lead.create(scenario.leadBody);
  log(`  · Lead creado:        id=${lead.id} stage=${lead.stage} clientId=${lead.clientId}`);

  // ── 2. Primera conversión (debe crear cliente + setear lead.clientId) ────
  const first = await convertLeadToClient(tenantModels, scenario, lead);
  if (first.skipped) throw new Error("Primera conversión skip — inesperado");
  log(`  · Cliente creado:     id=${first.client.id} origin=${first.client.customFields?.origin}`);
  log(`  · Lead post-update:   stage=${first.lead.stage} clientId=${first.lead.clientId}`);

  // ── 3. Verificar invariantes ────────────────────────────────────────────
  const reloaded = await Lead.findByPk(lead.id);
  const reloadedClient = await Client.findByPk(first.client.id);

  const assertions = [
    [`lead.clientId === client.id`, reloaded.clientId === first.client.id],
    [`lead.stage === "${scenario.expectedStage}"`, reloaded.stage === scenario.expectedStage],
    [
      `client.customFields.leadId === lead.id`,
      reloadedClient.customFields?.leadId === lead.id,
    ],
    [`client.customFields.origin === "lead"`, reloadedClient.customFields?.origin === "lead"],
  ];
  let allOk = true;
  for (const [label, ok] of assertions) {
    log(`  ${ok ? "✓" : "✗"} ${label}`);
    if (!ok) allOk = false;
  }

  // ── 4. Reintento (guard de idempotencia) ─────────────────────────────────
  const before = await Client.count({
    where: sequelize.literal(
      `custom_fields->>'leadId' = ${sequelize.escape(lead.id)}`
    ),
  });
  const second = await convertLeadToClient(tenantModels, scenario, reloaded);
  const after = await Client.count({
    where: sequelize.literal(
      `custom_fields->>'leadId' = ${sequelize.escape(lead.id)}`
    ),
  });
  log(`  · Reintento:          skipped=${second.skipped} reason="${second.reason || "—"}"`);
  log(`  · Clientes con leadId=${lead.id}: antes=${before}, después=${after}`);
  const idempotent = second.skipped === true && before === 1 && after === 1;
  log(`  ${idempotent ? "✓" : "✗"} Idempotencia: guard aborta y no crea segundo cliente`);
  if (!idempotent) allOk = false;

  // ── 5. SQL de limpieza (NO se ejecuta) ───────────────────────────────────
  log(`\n  -- Cleanup SQL (manual; NO ejecutado por este script):`);
  log(`  -- DELETE FROM crm_${scenario.slug}.leads WHERE id = '${lead.id}';`);
  log(`  -- DELETE FROM crm_${scenario.slug}.clients WHERE id = '${first.client.id}';`);

  log(`\n  Resultado: ${allOk ? "PASS ✓" : "FAIL ✗"}`);
  return allOk;
}

async function main() {
  let allPass = true;
  for (const sc of SCENARIOS) {
    try {
      const ok = await runScenario(sc);
      if (!ok) allPass = false;
    } catch (err) {
      process.stderr.write(`\n✗ Error en escenario ${sc.slug}: ${err.message}\n${err.stack}\n`);
      allPass = false;
    }
  }
  header("Resumen");
  log(`  Estado global: ${allPass ? "PASS ✓" : "FAIL ✗"}`);
  await closeAllConnections();
  process.exit(allPass ? 0 : 1);
}

main();
