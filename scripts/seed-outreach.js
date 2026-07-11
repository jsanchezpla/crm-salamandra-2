/**
 * seed-outreach.js — Datos de muestra del módulo Outreach para un tenant.
 *
 * Siembra: líneas de negocio, ajustes del módulo y unos cuantos leads captados
 * (con contactos y algún análisis de ejemplo) para poder ver el módulo
 * funcionando sin haber ejecutado todavía scraping ni IA.
 *
 * Los análisis sembrados llevan `model: 'demo'`: NO los ha generado la IA, son
 * datos de muestra. Los reales llegarán en la Fase 3.
 *
 * Requiere haber ejecutado antes:
 *   node --env-file=.env.local scripts/enable-outreach.js <slug>
 *   node --env-file=.env.local scripts/migrate-outreach-sprint-1.js
 *
 * Uso: node --env-file=.env.local scripts/seed-outreach.js <slug>
 */

import { getTenantDb, closeAllConnections } from "../lib/db/tenantDb.js";

const slug = process.argv[2];
if (!slug) {
  process.stderr.write("\n✗ Falta el slug.\n  Uso: node --env-file=.env.local scripts/seed-outreach.js <slug>\n\n");
  process.exit(1);
}

const BUSINESS_LINES = [
  {
    key: "solutions",
    name: "Salamandra Solutions",
    description:
      "Desarrollo de landings, webs completas y apps a medida, más la infraestructura informática (incluido CRM) que recoge y gestiona el embudo generado por la Agencia.",
    scoringUp: [
      "No tiene web, o es muy antigua",
      "Web sin conversión: sin formularios, CTAs ni analítica",
      "Sin reservas, pedidos o citas online cuando el negocio lo pide",
      "Procesos manuales evidentes (WhatsApp, teléfono, Excel)",
      "Va a recibir tráfico de campañas y necesita dónde convertirlo",
      "Depende solo de plataformas de terceros, sin canal propio",
      "Empresa en crecimiento o con varias sedes",
      "Necesita portal privado o área de cliente",
    ],
    scoringDown: [
      "Ya tiene web moderna, rápida y que convierte",
      "Negocio tan pequeño y local que con Google Maps le basta",
      "Sector donde la digitalización aporta poco valor",
    ],
    sortOrder: 0,
  },
  {
    key: "agencia",
    name: "Agencia Salamandra",
    description:
      "Social media, funnels de captación punto a punto, lanzamiento de campañas de publicidad y producción de videopromos.",
    scoringUp: [
      "Redes sociales flojas o inexistentes",
      "Contenido pobre o amateur, sin línea gráfica",
      "Nada de vídeo, o vídeo de mala calidad",
      "No hacen campañas de publicidad",
      "Producto vendible en imagen (restauración, estética, moda, eventos)",
      "Competencia con mejor presencia digital",
      "Lanzamiento, apertura o novedad reciente",
      "Ticket medio o margen alto",
    ],
    scoringDown: [
      "Ya trabajan con otra agencia y se nota",
      "B2B muy de nicho donde las redes aportan poco",
      "Microempresa sin capacidad de inversión",
    ],
    sortOrder: 1,
  },
];

const SETTINGS = {
  aiModel: "claude-opus-4-8",
  companyContext:
    "Salamandra es un grupo con dos empresas que se complementan: una agencia de marketing y una consultora de desarrollo de software.",
  chainingRule:
    "Las dos líneas se encadenan, no compiten. Si un lead puntúa alto en Agencia Y tiene capacidad real de inversión sostenida, sube también su score de Solutions: lanzar campañas sin una web o landing que convierta es tirar el dinero. El doble score alto SOLO aplica si el lead puede costear las dos patas. Si el presupuesto parece justo, no fuerces el doble score. A falta de datos de capacidad de inversión, sé conservador.",
};

const LEADS = [
  {
    name: "Clínica Dental Aurora",
    sector: "Clínicas dentales",
    location: "Salamanca",
    website: "https://dentalaurora.example",
    phone: "+34 923 112 233",
    email: "info@dentalaurora.example",
    source: "paginas_amarillas",
    rawData: { redes: { instagram: null, facebook: "abandonado" }, reservas_online: false },
    contacts: [
      { name: "Marta Iglesias", role: "Gerente", email: "marta@dentalaurora.example", mobile: "+34 611 220 331", isDecisionMaker: true },
      { name: "Recepción", role: "Recepción", phone: "+34 923 112 233" },
    ],
    analyses: [
      { line: "solutions", score: 84, reasonWhy: "Web antigua y sin reserva de cita online, en un sector donde la cita previa es el 80% del negocio.", needs: ["Web nueva y responsive", "Reserva de cita online", "Integración con su agenda"], pitch: "Entrar por la reserva online: es lo que más les duele y lo que más rápido se ve." },
      { line: "agencia", score: 71, reasonWhy: "Instagram sin publicar desde hace meses y competencia local con presencia mucho más fuerte.", needs: ["Plan de contenidos", "Videopromo de la clínica"], pitch: "Enseñar el perfil de su competidor directo y proponer un plan de tres meses." },
    ],
  },
  {
    name: "Restaurante El Zaguán",
    sector: "Restaurantes",
    location: "Salamanca",
    website: null,
    phone: "+34 923 445 566",
    email: null,
    source: "google_maps",
    rawData: { redes: { instagram: "activo" }, web: null, reparto: "solo Just Eat" },
    contacts: [{ name: "Luis Prieto", role: "Propietario", mobile: "+34 622 118 447", isDecisionMaker: true }],
    analyses: [
      { line: "solutions", score: 78, reasonWhy: "No tiene web propia y todo su canal de pedidos depende de Just Eat, que se lleva la comisión.", needs: ["Web con carta", "Pedido online propio"], pitch: "Calcular lo que pagan en comisiones al año. Ese número vende solo." },
      { line: "agencia", score: 45, reasonWhy: "Instagram activo y con buen contenido; el margen de mejora es menor.", needs: ["Campañas puntuales de temporada"], pitch: "Segunda ronda. Hoy no es prioridad." },
    ],
  },
  {
    name: "Gimnasio Vértice",
    sector: "Gimnasios y centros deportivos",
    location: "Valladolid",
    website: "https://verticefit.example",
    phone: "+34 983 221 100",
    email: "hola@verticefit.example",
    source: "google_maps",
    rawData: { redes: { instagram: "activo", tiktok: null }, campanas: false },
    contacts: [{ name: "Nerea Campos", role: "Directora", email: "nerea@verticefit.example", isDecisionMaker: true }],
    analyses: [
      { line: "agencia", score: 88, reasonWhy: "Producto muy vendible en imagen, sin campañas activas y con la competencia anunciándose en Meta.", needs: ["Funnel de captación de socios", "Videopromo", "Campañas Meta"], pitch: "Ir con un funnel de prueba gratuita de una semana." },
      { line: "solutions", score: 62, reasonWhy: "Tienen web, pero no aguanta tráfico de campaña: sin landing ni formulario.", needs: ["Landing de campaña", "Alta de socio online"], pitch: "Encadenar con la propuesta de Agencia: sin landing, la campaña se pierde." },
    ],
  },
  {
    name: "Asesoría Ledesma & Asociados",
    sector: "Asesorías / gestorías",
    location: "Zamora",
    website: "https://ledesma-asesores.example",
    phone: "+34 980 334 455",
    email: "contacto@ledesma-asesores.example",
    source: "paginas_amarillas",
    rawData: { redes: {}, portal_cliente: false },
    contacts: [{ name: "Alberto Ledesma", role: "Socio director", isDecisionMaker: true }],
    analyses: [],
  },
  {
    name: "Nórdica Muebles",
    sector: "Mueblerías y decoración",
    location: "León",
    website: "https://nordicamuebles.example",
    phone: "+34 987 556 677",
    email: "tienda@nordicamuebles.example",
    source: "linkedin",
    rawData: { redes: { instagram: "activo", pinterest: "activo" } },
    contacts: [
      { name: "Cristina Vega", role: "Responsable de marketing", email: "cristina@nordicamuebles.example", linkedin: "in/cristinavega", isDecisionMaker: false },
      { name: "Ramón Nieto", role: "Gerente", isDecisionMaker: true },
    ],
    analyses: [],
  },
  {
    name: "Centro de Fisioterapia Bienestar",
    sector: "Clínicas de fisioterapia / rehabilitación",
    location: "Ávila",
    website: null,
    phone: "+34 920 445 112",
    email: null,
    source: "paginas_amarillas",
    rawData: { redes: {}, web: null, reservas_online: false },
    contacts: [{ name: "Elena Ruiz", role: "Fisioterapeuta y propietaria", mobile: "+34 655 200 118", isDecisionMaker: true }],
    analyses: [],
  },
];

async function main() {
  const { models } = getTenantDb(slug);
  const { OutreachBusinessLine, OutreachSettings, OutreachLead, OutreachContact, OutreachAnalysis } = models;

  process.stdout.write(`\n▶ Sembrando Outreach en el tenant "${slug}"...\n`);

  // 1) Líneas de negocio
  const lineByKey = {};
  for (const bl of BUSINESS_LINES) {
    const [row] = await OutreachBusinessLine.findOrCreate({ where: { key: bl.key }, defaults: bl });
    lineByKey[bl.key] = row;
  }
  process.stdout.write(`  ✓ ${Object.keys(lineByKey).length} líneas de negocio\n`);

  // 2) Ajustes (fila única)
  const existing = await OutreachSettings.findOne();
  if (!existing) await OutreachSettings.create(SETTINGS);
  process.stdout.write(`  ✓ ajustes del módulo (modelo: ${SETTINGS.aiModel})\n`);

  // 3) Leads + contactos + análisis de muestra
  let nLeads = 0, nContacts = 0, nAnalyses = 0;
  for (const l of LEADS) {
    const { contacts = [], analyses = [], ...leadData } = l;
    const [lead, created] = await OutreachLead.findOrCreate({
      where: { name: leadData.name, location: leadData.location, source: leadData.source },
      defaults: { ...leadData, analyzed: analyses.length > 0 },
    });
    if (!created) continue;
    nLeads++;

    for (const c of contacts) {
      await OutreachContact.create({ ...c, outreachLeadId: lead.id });
      nContacts++;
    }
    for (const a of analyses) {
      const line = lineByKey[a.line];
      if (!line) continue;
      await OutreachAnalysis.create({
        outreachLeadId: lead.id,
        businessLineId: line.id,
        score: a.score,
        reasonWhy: a.reasonWhy,
        needs: a.needs,
        pitch: a.pitch,
        analyzedAt: new Date(),
        model: "demo", // datos de muestra, NO generados por IA
      });
      nAnalyses++;
    }
  }
  process.stdout.write(`  ✓ ${nLeads} leads · ${nContacts} contactos · ${nAnalyses} análisis (demo)\n`);

  // 4) Verificación: leer de vuelta con asociaciones
  const check = await OutreachLead.findOne({
    where: { name: "Clínica Dental Aurora" },
    include: [
      { model: OutreachContact, as: "contacts" },
      { model: OutreachAnalysis, as: "analyses", include: [{ model: OutreachBusinessLine, as: "businessLine" }] },
    ],
    order: [[{ model: OutreachAnalysis, as: "analyses" }, "score", "DESC"]],
  });

  process.stdout.write("\n▶ Verificación (lectura con asociaciones):\n");
  process.stdout.write(`  ${check.name} — ${check.sector} (${check.location})\n`);
  process.stdout.write(`  contactos: ${check.contacts.map((c) => `${c.name}${c.isDecisionMaker ? " ★decisor" : ""}`).join(", ")}\n`);
  for (const a of check.analyses) {
    process.stdout.write(`  ${a.businessLine.name}: score ${a.score} · ${a.needs.length} necesidades\n`);
  }

  await closeAllConnections();
  process.stdout.write("\n✓ Seed completado\n\n");
  process.exit(0);
}

main().catch(async (err) => {
  process.stderr.write(`\n✗ ${err.message}\n${err.stack}\n`);
  try { await closeAllConnections(); } catch {}
  process.exit(1);
});
