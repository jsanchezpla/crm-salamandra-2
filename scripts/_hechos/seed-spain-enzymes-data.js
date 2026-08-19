/**
 * seed-spain-enzymes-data.js — Rellena Spain Enzymes con datos de prueba
 *
 * Crea: 20 leads, 15 clientes, 30 productos de inventario
 * Requiere que el tenant ya exista (ejecutar seed-spain-enzymes.js primero)
 *
 * Uso local:  node --env-file=.env.local scripts/seed-spain-enzymes-data.js
 * Uso VPS:    docker compose exec app node scripts/seed-spain-enzymes-data.js
 */

import { getTenantDb, closeAllConnections } from "../../lib/db/tenantDb.js";

const SLUG = "spain_enzymes";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function rand(min, max, dec = 0) {
  const v = Math.random() * (max - min) + min;
  return dec ? +v.toFixed(dec) : Math.round(v);
}
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// ─── Datos maestros ───────────────────────────────────────────────────────────

const EMPRESAS = [
  "Biotech Pharma S.L.", "NutraLab Ibérica", "FermentaCorp",
  "Enzyme Solutions GmbH", "BioActive Portugal", "ProChem Italia",
  "Nordic Biotech", "AlphaEnzyme France", "Catalytica Química",
  "BioIndustrial México", "Pacific Enzymes", "Eastern BioTech",
  "Greenfield Bioprocessing", "ProteinTech AG", "NovaBio España",
];

const PAISES = [
  "España", "Portugal", "Francia", "Alemania", "Italia",
  "México", "Colombia", "Países Bajos", "Suecia", "Bélgica",
];

const CIUDADES = {
  "España": ["Madrid", "Barcelona", "Valencia", "Bilbao", "Sevilla"],
  "Portugal": ["Lisboa", "Oporto"],
  "Francia": ["París", "Lyon", "Marsella"],
  "Alemania": ["Múnich", "Berlín", "Hamburgo"],
  "Italia": ["Milán", "Roma", "Turín"],
  "México": ["Ciudad de México", "Guadalajara", "Monterrey"],
  "Colombia": ["Bogotá", "Medellín"],
  "Países Bajos": ["Ámsterdam", "Rotterdam"],
  "Suecia": ["Estocolmo", "Gotemburgo"],
  "Bélgica": ["Bruselas", "Amberes"],
};

const ASUNTOS = [
  "Consulta sobre enzimas para procesado de cereales",
  "Solicitud de muestras de lipasa",
  "Interés en proteasa para industria cárnica",
  "Preguntas sobre celulasa en biocombustibles",
  "Pedido de fitasa para pienso animal",
  "Información técnica sobre lactasa",
  "Aplicación de amilasa en panadería industrial",
  "Consulta enzimas para tratamiento de aguas residuales",
  "Propuesta proyecto enzimas textil",
  "Cotización para lote de glucoamilasa",
];

const NOTAS_LEAD = [
  "Contactó a través de la web. Muy interesado.",
  "Referido por cliente existente en Alemania.",
  "Asistió a la feria Alimentaria 2026.",
  "Solicita ficha técnica y COA del producto.",
  "Requiere certificado kosher para el mercado israelí.",
  "Interesado en grandes volúmenes a partir de Q3.",
  "Tiene un competidor actual con el que está insatisfecho.",
  "Primera toma de contacto, pendiente de llamada de seguimiento.",
  "Ha pedido muestra de 500g para ensayos en laboratorio.",
  null,
];

const NOTAS_INTERACCION = [
  "Llamada de presentación, muy receptivo. Enviamos dossier técnico.",
  "Enviado presupuesto por email. Pendiente respuesta.",
  "Reunión por videollamada. Quieren prueba piloto en planta.",
  "Confirman interés en pedido inicial de 50kg.",
  "Solicitan ajuste en precio para pedido anual.",
  "Visita a sus instalaciones. Proceso muy interesante.",
  "Aclaramos dudas sobre ficha de seguridad y COA.",
];

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════\n");
  process.stdout.write("   Spain Enzymes — Seed de datos de prueba      \n");
  process.stdout.write("════════════════════════════════════════════════\n");

  const { models } = getTenantDb(SLUG);
  const { Lead, Client, Interaction } = models;

  // ── 1. Leads ──────────────────────────────────────────────────────────────
  header("Creando leads...");

  const STAGES = ["new", "contacted", "qualified", "won", "lost"];
  const PRIORIDADES = ["alta", "media", "baja", null];
  const NOMBRES = [
    "Carlos García", "Ana Müller", "Jean Dupont", "Sofia Rossi", "Miguel Ferreira",
    "Emma Lindqvist", "Pieter van den Berg", "María López", "Thomas Schmidt",
    "Isabelle Martin", "Alejandro Torres", "Katarzyna Kowalski", "David Chen",
    "Amelia Johnson", "Roberto Bianchi", "Fatima El Amrani", "Hans Weber",
    "Camille Bernard", "Luca Ferrari", "Valentina Cruz",
  ];

  const leadsCreados = [];
  for (let i = 0; i < NOMBRES.length; i++) {
    const pais = pick(PAISES);
    const ciudad = pick(CIUDADES[pais] || ["—"]);
    const empresa = EMPRESAS[i % EMPRESAS.length];
    const stage = i < 4 ? "new" : i < 8 ? "contacted" : i < 12 ? "qualified" : i < 16 ? "won" : "lost";
    const lead = await Lead.create({
      name: NOMBRES[i],
      email: `${NOMBRES[i].split(" ")[0].toLowerCase()}.${NOMBRES[i].split(" ")[1]?.toLowerCase() ?? "x"}@${empresa.split(" ")[0].toLowerCase().replace(/[^a-z]/g, "")}.com`,
      phone: `+${rand(1, 99)}${rand(100000000, 999999999)}`,
      stage,
      source: pick(["web", "feria", "referido", "linkedin", "email"]),
      notes: pick(NOTAS_LEAD),
      customFields: {
        empresa,
        pais,
        ciudad,
        asunto: pick(ASUNTOS),
        prioridad: pick(PRIORIDADES),
      },
    });
    leadsCreados.push(lead);
  }
  log(`✓ ${leadsCreados.length} leads creados`);

  // ── 2. Clientes ───────────────────────────────────────────────────────────
  header("Creando clientes con interacciones...");

  const SE_STATUSES = ["new", "contacted", "following", "converted", "discarded"];
  const NOMBRES_CLIENTE = [
    "BioFerm Solutions", "AgroProtein S.A.", "Fermenta España",
    "NutraProcess GmbH", "CereAlpha Biotech", "DairyEnzyme Ltd.",
    "TextileProcess S.L.", "WasteWater Bio", "PaperMill Catalysts",
    "BrewEnzyme Prague", "OleoChemicals BV", "FruitProcess Portugal",
    "MeatTech Ibérica", "BakeryPro Italia", "AquaFeed Mexico",
  ];

  const PRODUCTOS_INTERES = [
    "Proteasa alcalina", "Lipasa fúngica", "Celulasa termófila",
    "Amilasa bacteriana", "Fitasa granulada", "Lactasa líquida",
    "Xilanasa purificada", null,
  ];

  const TEMAS = [
    "Procesado de cereales", "Industria láctea", "Biocombustibles",
    "Pienso animal", "Textil enzimático", "Cervecería",
    "Tratamiento de aguas", "Panificación", "Industria cárnica",
  ];

  const clientesCreados = [];
  for (let i = 0; i < NOMBRES_CLIENTE.length; i++) {
    const pais = pick(PAISES);
    const ciudad = pick(CIUDADES[pais] || ["—"]);
    const seStatus = i < 3 ? "new" : i < 6 ? "contacted" : i < 10 ? "following" : i < 13 ? "converted" : "discarded";
    const wonLead = seStatus === "converted" && leadsCreados[i] ? leadsCreados[i] : null;

    const client = await Client.create({
      name: pick(["Laura", "Pedro", "Marta", "Juan", "Elena"]) + " " + pick(["García", "Müller", "Rossi", "Ferreira", "López"]),
      email: `contacto@${NOMBRES_CLIENTE[i].split(" ")[0].toLowerCase().replace(/[^a-z]/g, "")}.com`,
      phone: `+34 9${rand(10, 99)} ${rand(100, 999)} ${rand(100, 999)}`,
      notes: i % 3 === 0 ? "Cliente estratégico. Potencial de crecimiento alto." : null,
      customFields: {
        company: NOMBRES_CLIENTE[i],
        country: pais,
        city: ciudad,
        topic: pick(TEMAS),
        interestedProduct: pick(PRODUCTOS_INTERES),
        origin: wonLead ? "lead" : pick(["manual", "feria", "referido"]),
        leadId: wonLead ? wonLead.id : null,
        seStatus,
      },
    });
    clientesCreados.push(client);

    // Interacciones (2–4 por cliente)
    const numInt = rand(2, 4);
    for (let j = 0; j < numInt; j++) {
      await Interaction.create({
        clientId: client.id,
        type: pick(["call", "email", "meeting", "note"]),
        content: pick(NOTAS_INTERACCION),
        date: daysAgo(rand(1, 120)),
        createdBy: pick(["Jorge", "María", "Antonio", null]),
      });
    }
  }
  log(`✓ ${clientesCreados.length} clientes creados con interacciones`);

  // ── Resumen ──────────────────────────────────────────────────────────────
  process.stdout.write("\n════════════════════════════════════════════════\n");
  process.stdout.write(" ¡Datos de prueba cargados correctamente!\n");
  process.stdout.write("════════════════════════════════════════════════\n");
  process.stdout.write(`  Tenant:     ${SLUG}\n`);
  process.stdout.write(`  Leads:      ${leadsCreados.length}\n`);
  process.stdout.write(`  Clientes:   ${clientesCreados.length} (con interacciones)\n`);
  process.stdout.write("════════════════════════════════════════════════\n\n");

  await closeAllConnections();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
