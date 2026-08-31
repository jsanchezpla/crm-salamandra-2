/**
 * seed-conceptos-aumenta.js — los conceptos habituales de Aumenta en su
 * catálogo (31/08/2026).
 *
 * La lista la dictó Rodrigo en la formación de facturación del 31/08 (está
 * también en la tarea del Registro), más las 4 cuotas vivas del Organízate
 * (Cursos → Gestión, leídas ese día). Todo exento de IVA (art. 20 LIVA);
 * el importe va como BASE (= total, con la exención).
 *
 * SOLO tenant aumenta. En seco por defecto: enseña qué crearía y cuántos ya
 * existen (por nombre). Escribe únicamente con --confirm, y NUNCA duplica:
 * un nombre que ya está se salta.
 *
 * Uso VPS:  docker exec crm-salamandra-app-1 node scripts/seed-conceptos-aumenta.js [--confirm]
 */

import { Sequelize } from "sequelize";

const CONCEPTOS = [
  // Cuotas mensuales de terapia
  { name: "Terapia 30 min semanales", description: "Sesión de Terapia de 30 minutos semanales", unitPrice: 105, periodicity: "mensual", category: "Cuotas de terapia" },
  { name: "Terapia 45 min semanales", description: "Sesión de Terapia de 45 minutos semanales", unitPrice: 145, periodicity: "mensual", category: "Cuotas de terapia" },
  { name: "Terapia 1 h semanal", description: "Sesión de Terapia de 1 hora semanal", unitPrice: 190, periodicity: "mensual", category: "Cuotas de terapia" },
  { name: "2 sesiones de 45 min semanales", description: "2 Sesiones de Terapia de 45 minutos semanales", unitPrice: 290, periodicity: "mensual", category: "Cuotas de terapia" },
  { name: "2 sesiones de 1 h semanales", description: "2 Sesiones de Terapia de 1 hora semanales", unitPrice: 380, periodicity: "mensual", category: "Cuotas de terapia" },
  // Sesiones sueltas
  { name: "Sesión suelta 45 min", description: "Sesión de Terapia de 45 minutos", unitPrice: 45, periodicity: null, category: "Sesiones sueltas" },
  { name: "Sesión suelta 1 h", description: "Sesión de Terapia de 1 hora", unitPrice: 60, periodicity: null, category: "Sesiones sueltas" },
  // Grupales
  { name: "Grupal 1 h semanal", description: "Sesión de Terapia de 1 hora semanal grupal", unitPrice: 80, periodicity: "mensual", category: "Terapia grupal" },
  { name: "Grupal 1 h 30 semanales", description: "Sesión de Terapia de 1 hora y 30 minutos semanales grupal", unitPrice: 120, periodicity: "mensual", category: "Terapia grupal" },
  { name: "Taller de Estimulación Cognitiva", description: "Taller de Estimulación Cognitiva", unitPrice: 50, periodicity: "mensual", category: "Terapia grupal" },
  { name: "Grupal: 1 sesión semanal de 1 h", description: "1 sesión semanal de 1 hora de Terapia grupal", unitPrice: 55, periodicity: "mensual", category: "Terapia grupal" },
  { name: "Grupal: 2 sesiones semanales de 1 h", description: "2 sesiones semanales de 1 hora de Terapia grupal", unitPrice: 85, periodicity: "mensual", category: "Terapia grupal" },
  { name: "Grupal: 3 sesiones semanales de 1 h", description: "3 sesiones semanales de 1 hora de Terapia grupal", unitPrice: 120, periodicity: "mensual", category: "Terapia grupal" },
  // Bonos
  { name: "Bono 5 sesiones de 45 min", description: "Bono de 5 sesiones de Terapia de 45 minutos cada una", unitPrice: 200, periodicity: null, category: "Bonos" },
  { name: "Bono 5 sesiones de 1 h", description: "Bono de 5 sesiones de Terapia de 1 hora cada una", unitPrice: 250, periodicity: null, category: "Bonos" },
  // Otros servicios
  { name: "Tutorización de alumno en prácticas", description: "Tutorización de alumno en prácticas — alumno: ", unitPrice: 0, periodicity: null, category: "Otros servicios" }, // precio a confirmar; el nombre del alumno se completa en la línea
  { name: "Reserva de plaza", description: "Reserva de plaza", unitPrice: 30, periodicity: null, category: "Otros servicios" },
  { name: "Descuento reserva ya abonada", description: "Descuento por reserva de plaza ya abonada", unitPrice: -30, periodicity: null, category: "Descuentos" },
  { name: "Diagnóstico Completo", description: "Servicio de Diagnóstico Completo", unitPrice: 650, periodicity: null, category: "Diagnóstico" },
  { name: "Diagnóstico Simple", description: "Servicio de Diagnóstico Simple", unitPrice: 350, periodicity: null, category: "Diagnóstico" },
  { name: "Sesión de Asesoramiento", description: "Sesión de Asesoramiento", unitPrice: 75, periodicity: null, category: "Otros servicios" },
  { name: "Sesión de Programa de Conducta", description: "Sesión de Programa de Conducta", unitPrice: 75, periodicity: null, category: "Otros servicios" },
  { name: "Entrevista Inicial", description: "Entrevista Inicial", unitPrice: 50, periodicity: null, category: "Otros servicios" },
  { name: "Informe extra", description: "Informe extra", unitPrice: 50, periodicity: null, category: "Otros servicios" },
  // Las 4 cuotas vivas del Organízate (Cursos → Gestión, 31/08/2026)
  { name: "Cuota Logopedia 60x2", description: "Sesiones Logopedia 1 hora de duración 2 veces semana", unitPrice: 370, periodicity: "mensual", category: "Cuotas del Organízate" },
  { name: "Cuota Refuerzo / TT.EE. 4 días", description: "Cuota Refuerzo / Técnicas de Estudio, 4 días por semana", unitPrice: 0, periodicity: "mensual", category: "Cuotas del Organízate" }, // importe no visible en la lista del Organízate: completar
  { name: "Curso Fisioterapia 30", description: "Curso de Fisioterapia, sesiones de 30 minutos", unitPrice: 0, periodicity: "mensual", category: "Cuotas del Organízate" }, // importe: completar
  { name: "Curso Psicología 2x45", description: "Curso de Psicología, 2 sesiones de 45 minutos por semana", unitPrice: 0, periodicity: "mensual", category: "Cuotas del Organízate" }, // importe: completar
];

async function main() {
  const confirm = process.argv.includes("--confirm");
  if (!process.env.DATABASE_URL) {
    process.stderr.write("✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }
  const s = new Sequelize(process.env.DATABASE_URL, { dialect: "postgres", logging: false });

  const schema = "crm_aumenta";
  const [t] = await s.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = :schema AND table_name = 'billing_concepts'`,
    { replacements: { schema } }
  );
  if (!t.length) { process.stderr.write(`✗ ${schema}.billing_concepts no existe (¿migración corrida?)\n`); process.exit(1); }

  const [existentes] = await s.query(`SELECT name FROM "${schema}"."billing_concepts"`);
  const nombres = new Set(existentes.map((r) => r.name));
  const nuevos = CONCEPTOS.filter((c) => !nombres.has(c.name));

  process.stdout.write(`\nCatálogo de aumenta: ${existentes.length} conceptos ya dados de alta.\n`);
  process.stdout.write(`Entrarían ${nuevos.length} de ${CONCEPTOS.length} (los repetidos por nombre se saltan):\n`);
  for (const c of nuevos) {
    process.stdout.write(`  + ${c.name} — ${c.unitPrice} € ${c.periodicity ? "/" + c.periodicity : ""} [${c.category}]${c.unitPrice === 0 ? "  ⚠ importe a completar" : ""}\n`);
  }
  if (!confirm) {
    process.stdout.write("\n(EN SECO: nada escrito. Repite con --confirm para darlos de alta.)\n");
    await s.close();
    return;
  }

  let orden = existentes.length;
  for (const c of nuevos) {
    await s.query(
      `INSERT INTO "${schema}"."billing_concepts" (name, description, unit_price, vat_rate, category, periodicity, sort_order)
       VALUES (:name, :description, :unitPrice, 0, :category, :periodicity, :sortOrder)`,
      { replacements: { ...c, sortOrder: ++orden } }
    );
  }
  process.stdout.write(`\n✓ ${nuevos.length} conceptos dados de alta en ${schema}.\n`);
  await s.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
