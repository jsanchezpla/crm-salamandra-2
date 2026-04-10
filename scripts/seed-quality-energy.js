/**
 * seed-quality-energy.js — Inicializa el tenant Quality Energy Consulting
 *
 * 1. Crea schema crm_quality_energy
 * 2. Crea el tenant, usuario y módulo de leads
 * 3. Siembra 40 leads realistas distribuidos en todos los estados
 *
 * Uso: node --env-file=.env.local scripts/seed-quality-energy.js
 */

import { Sequelize } from "sequelize";
import bcrypt from "bcrypt";
import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb } from "../lib/db/tenantDb.js";

const SLUG = "quality_energy";
const SCHEMA = `crm_${SLUG}`;
const USER_EMAIL = "admin@qualityholding.com";
const USER_PASSWORD = "Qe#7829!Solar";

function log(msg) {
  process.stdout.write(`  ${msg}\n`);
}
function header(msg) {
  process.stdout.write(`\n▶ ${msg}\n`);
}

// ─── Datos realistas de leads energéticos ─────────────────────────────────────

const LEADS_DATA = [
  // Nuevo lead (12)
  { name: "Marcos Delgado Ruiz", phone: "612 341 872", email: "marcos.delgado@gmail.com", stage: "new", experience: "experienced", zone: "Madrid" },
  { name: "Elena Vázquez Prieto", phone: "623 458 931", email: "elena.vazquez@hotmail.com", stage: "new", experience: "other_sector", zone: "Cataluña" },
  { name: "Javier Mora Castillo", phone: "634 512 047", email: "j.mora.castillo@gmail.com", stage: "new", experience: "freelancer", zone: "Andalucía" },
  { name: "Laura Serrano Gil", phone: "645 623 158", email: "laura.serrano@outlook.com", stage: "new", experience: "experienced", zone: "Valencia" },
  { name: "Pablo Fuentes Navarro", phone: "656 734 269", email: "pablo.fuentes@gmail.com", stage: "new", experience: "other_sector", zone: "País Vasco" },
  { name: "Carmen Ortega Blanco", phone: "667 845 370", email: "c.ortega.blanco@gmail.com", stage: "new", experience: "freelancer", zone: "Aragón" },
  { name: "Rodrigo Herrera Nieto", phone: "678 956 481", email: "rodrigo.herrera@gmail.com", stage: "new", experience: "experienced", zone: "Galicia" },
  { name: "Ana Molina Campos", phone: "689 012 592", email: "ana.molina.campos@yahoo.es", stage: "new", experience: "other_sector", zone: "Murcia" },
  { name: "David Ramos Pizarro", phone: "610 123 603", email: "d.ramos.pizarro@gmail.com", stage: "new", experience: "freelancer", zone: "Castilla-La Mancha" },
  { name: "Nuria Santos Iglesias", phone: "621 234 714", email: "nuria.santos@gmail.com", stage: "new", experience: "experienced", zone: "Asturias" },
  { name: "Francisco Peña Lozano", phone: "632 345 825", email: "f.pena.lozano@gmail.com", stage: "new", experience: "other_sector", zone: "Extremadura" },
  { name: "Beatriz Rubio Márquez", phone: "643 456 936", email: "beatriz.rubio@outlook.com", stage: "new", experience: "freelancer", zone: "Canarias" },

  // Contactado (9)
  { name: "Alberto Jiménez Soler", phone: "654 567 047", email: "alberto.jimenez@gmail.com", stage: "contacted", experience: "experienced", zone: "Madrid", utmSource: "facebook", utmCampaign: "energia_mar26" },
  { name: "Silvia Guerrero Medina", phone: "665 678 158", email: "silvia.guerrero@gmail.com", stage: "contacted", experience: "freelancer", zone: "Cataluña", utmSource: "google", utmMedium: "cpc", utmCampaign: "leads_abril" },
  { name: "Tomás Vargas Montoya", phone: "676 789 269", email: "t.vargas.montoya@hotmail.com", stage: "contacted", experience: "other_sector", zone: "Andalucía", utmSource: "instagram", utmCampaign: "energia_mar26" },
  { name: "Isabel Cruz Romero", phone: "687 890 370", email: "isabel.cruz@gmail.com", stage: "contacted", experience: "experienced", zone: "Valencia", utmSource: "facebook", utmCampaign: "energia_mar26" },
  { name: "Miguel Ángel León Torres", phone: "698 901 481", email: "ma.leon.torres@gmail.com", stage: "contacted", experience: "freelancer", zone: "Murcia", utmSource: "google", utmMedium: "organic" },
  { name: "Patricia Mendoza Reyes", phone: "609 012 592", email: "p.mendoza.reyes@gmail.com", stage: "contacted", experience: "other_sector", zone: "País Vasco", utmSource: "instagram", utmCampaign: "energia_mar26" },
  { name: "Sergio Cabrera Alonso", phone: "620 123 603", email: "sergio.cabrera@gmail.com", stage: "contacted", experience: "experienced", zone: "Galicia", utmSource: "facebook", utmMedium: "social", utmCampaign: "leads_abril" },
  { name: "Rocío Domínguez Vega", phone: "631 234 714", email: "rocio.dominguez@outlook.com", stage: "contacted", experience: "freelancer", zone: "Aragón", utmSource: "google", utmMedium: "cpc" },
  { name: "Gonzalo Bermejo Pardo", phone: "642 345 825", email: "g.bermejo.pardo@gmail.com", stage: "contacted", experience: "other_sector", zone: "Castilla y León", utmSource: "facebook", utmCampaign: "energia_mar26" },

  // En seguimiento (11)
  { name: "Verónica Salas Espinosa", phone: "653 456 936", email: "veronica.salas@gmail.com", stage: "qualified", experience: "experienced", zone: "Madrid", utmSource: "google", utmMedium: "cpc", utmCampaign: "leads_abril", notes: "Muy interesada. Tiene cartera de 30 clientes autónomos. Llamar el jueves." },
  { name: "Adrián Calvo Paredes", phone: "664 567 047", email: "adrian.calvo@gmail.com", stage: "qualified", experience: "freelancer", zone: "Cataluña", utmSource: "instagram", utmCampaign: "energia_mar26", notes: "Asesor independiente. Quiere combinar con su actividad actual." },
  { name: "Marta Iglesias Soto", phone: "675 678 158", email: "marta.iglesias@hotmail.com", stage: "qualified", experience: "experienced", zone: "Valencia", utmSource: "facebook", utmCampaign: "energia_mar26", notes: "Ex-comercial de Endesa. Muy cualificada. Pendiente de enviar contrato." },
  { name: "Héctor Vargas Romero", phone: "686 789 269", email: "h.vargas.romero@gmail.com", stage: "qualified", experience: "other_sector", zone: "Andalucía", utmSource: "google", utmMedium: "organic", notes: "Trabaja en sector seguros, busca diversificar. Reunión el martes." },
  { name: "Cristina Méndez Fuentes", phone: "697 890 370", email: "cristina.mendez@gmail.com", stage: "qualified", experience: "experienced", zone: "País Vasco", utmSource: "facebook", utmMedium: "social", utmCampaign: "leads_abril", notes: "Alta motivación. Tiene red de contactos en empresas industriales." },
  { name: "Fernando Ríos Aguilar", phone: "608 901 481", email: "f.rios.aguilar@gmail.com", stage: "qualified", experience: "freelancer", zone: "Aragón", utmSource: "instagram", utmCampaign: "energia_mar26" },
  { name: "Susana Lara Herrero", phone: "619 012 592", email: "susana.lara@gmail.com", stage: "qualified", experience: "other_sector", zone: "Murcia", utmSource: "google", utmMedium: "cpc" },
  { name: "Ramón Santana Cano", phone: "630 123 603", email: "ramon.santana@outlook.com", stage: "qualified", experience: "experienced", zone: "Galicia", utmSource: "facebook", utmCampaign: "energia_mar26" },
  { name: "Amparo Torres Blanco", phone: "641 234 714", email: "amparo.torres@gmail.com", stage: "qualified", experience: "freelancer", zone: "Canarias", utmSource: "instagram", utmCampaign: "energia_mar26", notes: "Autónoma en hostelería. Interesada en ampliar ingresos. Follow-up pendiente." },
  { name: "Carlos Rubio Sánchez", phone: "652 345 825", email: "carlos.rubio.s@gmail.com", stage: "qualified", experience: "other_sector", zone: "Extremadura", utmSource: "google", utmMedium: "organic" },
  { name: "Dolores Pinto García", phone: "663 456 936", email: "d.pinto.garcia@gmail.com", stage: "qualified", experience: "experienced", zone: "Castilla-La Mancha", utmSource: "facebook", utmCampaign: "leads_abril", notes: "Responsable de compras en empresa. Candidata de alto valor." },

  // Convertido (5)
  { name: "Ignacio Blanco Molina", phone: "674 567 047", email: "ignacio.blanco@gmail.com", stage: "won", experience: "experienced", zone: "Madrid", utmSource: "google", utmMedium: "cpc", utmCampaign: "energia_mar26", notes: "Onboarding completado el 2/04. Primera venta ya registrada." },
  { name: "Pilar Cano Vidal", phone: "685 678 158", email: "pilar.cano.vidal@gmail.com", stage: "won", experience: "freelancer", zone: "Cataluña", utmSource: "instagram", utmCampaign: "leads_abril", notes: "Activada el 28/03. Muy proactiva en la formación inicial." },
  { name: "Roberto Parra Díaz", phone: "696 789 269", email: "roberto.parra@hotmail.com", stage: "won", experience: "experienced", zone: "Andalucía", utmSource: "facebook", utmCampaign: "energia_mar26", notes: "Firmó contrato el 5/04. Zona de alto potencial." },
  { name: "Lucía Morales Castillo", phone: "607 890 370", email: "lucia.morales@gmail.com", stage: "won", experience: "other_sector", zone: "Valencia", utmSource: "google", utmMedium: "cpc", notes: "Convertida el 1/04. Perfil atípico pero muy resolutiva." },
  { name: "Manuel Serrano Fuentes", phone: "618 901 481", email: "m.serrano.fuentes@gmail.com", stage: "won", experience: "experienced", zone: "País Vasco", utmSource: "facebook", utmMedium: "social", utmCampaign: "leads_abril", notes: "Primer trimestre con 8 contratos cerrados. Top performer." },

  // Descartado (3)
  { name: "Inmaculada Reyes Pérez", phone: "629 012 592", email: "inma.reyes@gmail.com", stage: "lost", experience: "other_sector", zone: "Murcia", notes: "No cumple perfil. Buscaba empleo por cuenta ajena, no autoempleo." },
  { name: "Óscar Velasco Ortega", phone: "640 123 603", email: "oscar.velasco@outlook.com", stage: "lost", experience: "freelancer", zone: "Aragón", notes: "No responde tras 3 intentos de contacto. Cerrado por inactividad." },
  { name: "Raquel Aguado Llorente", phone: "651 234 714", email: "raquel.aguado@gmail.com", stage: "lost", experience: "experienced", zone: "Castilla y León", notes: "Se incorporó a empresa de la competencia. Descartado el 3/04." },
];

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  process.stdout.write("\n════════════════════════════════════════════\n");
  process.stdout.write(" Quality Energy Consulting — Seed inicial  \n");
  process.stdout.write("════════════════════════════════════════════\n");

  // ── 1. Crear schema ────────────────────────────────────────────────────────
  header("Creando schema PostgreSQL...");
  const rawDb = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });
  await rawDb.query(`CREATE SCHEMA IF NOT EXISTS "${SCHEMA}"`);
  await rawDb.close();
  log(`✓ Schema "${SCHEMA}" listo`);

  // ── 2. Tablas master ────────────────────────────────────────────────────────
  header("Sincronizando tablas master...");
  getMasterDb();

  // ── 3. Tablas del tenant ────────────────────────────────────────────────────
  header(`Sincronizando tablas de ${SCHEMA}...`);
  const { sequelize: tenantSeq } = getTenantDb(SLUG);
  await tenantSeq.sync({ alter: true });
  log(`✓ Tablas en ${SCHEMA} actualizadas`);

  // ── 4. Tenant ───────────────────────────────────────────────────────────────
  header("Creando tenant Quality Energy Consulting...");
  const { Tenant, User, TenantModule } = getMasterModels();

  const [tenant, tenantCreated] = await Tenant.findOrCreate({
    where: { slug: SLUG },
    defaults: {
      name: "Quality Energy Consulting",
      slug: SLUG,
      dbName: "salamandra",
      plan: "pro",
      status: "active",
      settings: {
        brand: {
          primaryColor: "#43712D",
          secondaryColor: "#1a2e12",
          logoUrl: null,
        },
      },
    },
  });
  log(`${tenantCreated ? "✓ Creado" : "· Ya existía"} tenant "${SLUG}" (id: ${tenant.id})`);

  // ── 5. Usuario ──────────────────────────────────────────────────────────────
  header("Creando usuario administrador...");
  const passwordHash = await bcrypt.hash(USER_PASSWORD, 12);
  const [user, userCreated] = await User.findOrCreate({
    where: { email: USER_EMAIL },
    defaults: {
      email: USER_EMAIL,
      passwordHash,
      role: "admin",
      tenantId: tenant.id,
      moduleAccess: ["leads"],
    },
  });
  log(`${userCreated ? "✓ Creado" : "· Ya existía"} usuario "${USER_EMAIL}"`);

  // ── 6. Módulo leads ─────────────────────────────────────────────────────────
  header("Registrando módulo de leads...");
  const [mod, modCreated] = await TenantModule.findOrCreate({
    where: { tenantId: tenant.id, moduleKey: "leads" },
    defaults: {
      tenantId: tenant.id,
      moduleKey: "leads",
      enabled: true,
      version: "1.0.0",
      uiOverride: "quality-energy/LeadsModule",
      schemaExtensions: {
        experience: { type: "enum", values: ["experienced", "other_sector", "freelancer"] },
        zone: { type: "string" },
        utmSource: { type: "string" },
        utmMedium: { type: "string" },
        utmCampaign: { type: "string" },
      },
      logicOverrides: {},
      featureFlags: {},
    },
  });
  log(`${modCreated ? "✓ Creado" : "· Ya existía"} módulo "leads" (uiOverride: quality-energy/LeadsModule)`);

  // ── 7. Leads de prueba ──────────────────────────────────────────────────────
  header(`Sembrando ${LEADS_DATA.length} leads de prueba...`);
  const { models } = getTenantDb(SLUG);
  const { Lead } = models;

  // Distribuir fechas de creación en los últimos 45 días
  const now = new Date("2026-04-09");
  let created = 0;

  for (let i = 0; i < LEADS_DATA.length; i++) {
    const d = LEADS_DATA[i];
    const daysAgo = Math.floor((LEADS_DATA.length - i) * (45 / LEADS_DATA.length));
    const createdAt = new Date(now);
    createdAt.setDate(createdAt.getDate() - daysAgo);

    const [, wasCreated] = await Lead.findOrCreate({
      where: { email: d.email },
      defaults: {
        name: d.name,
        phone: d.phone,
        email: d.email,
        title: d.name,
        stage: d.stage,
        notes: d.notes ?? null,
        customFields: {
          experience: d.experience,
          zone: d.zone,
          ...(d.utmSource ? { utmSource: d.utmSource } : {}),
          ...(d.utmMedium ? { utmMedium: d.utmMedium } : {}),
          ...(d.utmCampaign ? { utmCampaign: d.utmCampaign } : {}),
        },
        createdAt,
        updatedAt: createdAt,
      },
    });
    if (wasCreated) created++;
  }
  log(`✓ ${created} leads creados, ${LEADS_DATA.length - created} ya existían`);

  // ── 8. Resumen ──────────────────────────────────────────────────────────────
  const byStage = LEADS_DATA.reduce((acc, l) => { acc[l.stage] = (acc[l.stage] ?? 0) + 1; return acc; }, {});

  process.stdout.write("\n════════════════════════════════════════════\n");
  process.stdout.write(" ¡Listo! Accede con estas credenciales:\n");
  process.stdout.write("════════════════════════════════════════════\n");
  process.stdout.write(`  URL:         http://localhost:3000/login\n`);
  process.stdout.write(`  Tenant:      x-tenant: ${SLUG}\n`);
  process.stdout.write(`  Email:       ${USER_EMAIL}\n`);
  process.stdout.write(`  Contraseña:  ${USER_PASSWORD}\n`);
  process.stdout.write("────────────────────────────────────────────\n");
  process.stdout.write(`  Leads totales: ${LEADS_DATA.length}\n`);
  process.stdout.write(`    Nuevo lead:     ${byStage.new ?? 0}\n`);
  process.stdout.write(`    Contactado:     ${byStage.contacted ?? 0}\n`);
  process.stdout.write(`    En seguimiento: ${byStage.qualified ?? 0}\n`);
  process.stdout.write(`    Convertido:     ${byStage.won ?? 0}\n`);
  process.stdout.write(`    Descartado:     ${byStage.lost ?? 0}\n`);
  process.stdout.write("════════════════════════════════════════════\n\n");

  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
