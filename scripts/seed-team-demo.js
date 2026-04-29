/**
 * seed-team-demo.js — Seed del módulo Equipo (#6) para tenant `demo`.
 *
 * - Reutiliza los TeamMember existentes (Ana García, Carlos López,
 *   Laura Martínez, Miguel Sánchez) y enriquece con email / phone /
 *   hourlyCost / hourlyRate / startDate / notes.
 * - Añade un 5º miembro inactivo: Sara Romero.
 * - Vincula Ana García al User admin del demo (admin@demo.salamandra)
 *   por userId si aún no está vinculada.
 *
 * Idempotente: si ya existe un miembro con el mismo displayName, lo
 * actualiza en lugar de duplicarlo. Si los campos ya están rellenos no
 * los pisa con valores idénticos (no-op de Sequelize).
 *
 * Uso: npm run db:seed:team
 */

import { Op } from "sequelize";
import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb } from "../lib/db/tenantDb.js";

const DEMO_SLUG = "demo";
const DEMO_ADMIN_EMAIL = "admin@demo.salamandra";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

const MEMBERS = [
  {
    displayName: "Ana García",
    email: "ana.garcia@demo.local",
    role: "Empleado Senior",
    department: "Infantil",
    phone: "+34 611 200 301",
    hourlyCost: 22.5,
    hourlyRate: 65,
    currency: "EUR",
    startDate: "2024-03-01",
    status: "active",
    notes: "Líder de la línea Infantil.",
    linkToAdmin: true, // se vinculará al User admin del demo
  },
  {
    displayName: "Carlos López",
    email: "carlos.lopez@demo.local",
    role: "Empleado Senior",
    department: "Adultos",
    phone: "+34 612 200 302",
    hourlyCost: 25,
    hourlyRate: 70,
    currency: "EUR",
    startDate: "2023-09-15",
    status: "active",
    notes: null,
  },
  {
    displayName: "Laura Martínez",
    email: "laura.martinez@demo.local",
    role: "Empleado Senior",
    department: "Neuropsicología",
    phone: "+34 613 200 303",
    hourlyCost: 28,
    hourlyRate: 80,
    currency: "EUR",
    startDate: "2024-01-10",
    status: "active",
    notes: "Especialista en evaluaciones.",
  },
  {
    displayName: "Miguel Sánchez",
    email: "miguel.sanchez@demo.local",
    role: "Empleado Junior",
    department: "Familia",
    phone: "+34 614 200 304",
    hourlyCost: 18,
    hourlyRate: 45,
    currency: "EUR",
    startDate: "2025-06-01",
    status: "active",
    notes: null,
  },
  {
    displayName: "Sara Romero",
    email: "sara.romero@demo.local",
    role: "Empleado Junior",
    department: "Administración",
    phone: "+34 615 200 305",
    hourlyCost: 16,
    hourlyRate: 40,
    currency: "EUR",
    startDate: "2024-11-15",
    status: "inactive",
    notes: "Causó baja en marzo de 2026.",
  },
];

async function main() {
  process.stdout.write("\n════════════════════════════════════════\n");
  process.stdout.write(" Demo — Seed del módulo Equipo          \n");
  process.stdout.write("════════════════════════════════════════\n");

  // 1. Comprobar tenant + admin
  header("Verificando tenant demo y usuario admin...");
  getMasterDb();
  const { Tenant, User } = getMasterModels();
  const tenant = await Tenant.findOne({ where: { slug: DEMO_SLUG } });
  if (!tenant) {
    process.stderr.write("\n✗ Tenant demo no encontrado. Ejecuta npm run db:sync primero.\n");
    process.exit(1);
  }
  log(`✓ Tenant: ${tenant.name}`);

  const adminUser = await User.findOne({ where: { email: DEMO_ADMIN_EMAIL } });
  if (!adminUser) {
    log(`· Usuario ${DEMO_ADMIN_EMAIL} no encontrado — se omite vínculo userId`);
  } else {
    log(`✓ Admin: ${DEMO_ADMIN_EMAIL} (id: ${adminUser.id})`);
  }

  // 2. Modelos del tenant
  const { models } = getTenantDb(DEMO_SLUG);
  const { TeamMember } = models;

  // 3. UPSERT por displayName: si existe, actualizar campos; si no, crear
  header("Sembrando miembros del equipo...");
  let created = 0;
  let updated = 0;

  for (const m of MEMBERS) {
    const fields = {
      displayName: m.displayName,
      email: m.email,
      position: m.role,
      department: m.department,
      phone: m.phone,
      hourlyCost: m.hourlyCost,
      hourlyRate: m.hourlyRate,
      currency: m.currency,
      hiredAt: m.startDate,
      status: m.status,
      notes: m.notes,
    };

    let member = await TeamMember.findOne({ where: { displayName: m.displayName } });

    if (member) {
      await member.update(fields);
      updated++;
      log(`· actualizado · ${m.displayName}`);
    } else {
      member = await TeamMember.create({ ...fields, customFields: {} });
      created++;
      log(`✓ creado     · ${m.displayName}`);
    }

    // Vincular este miembro al admin: idempotente y robusto frente a un
    // userId random heredado o a otro miembro previamente vinculado.
    if (m.linkToAdmin && adminUser) {
      const otherLinked = await TeamMember.findOne({
        where: { userId: adminUser.id, id: { [Op.ne]: member.id } },
        attributes: ["id", "displayName"],
      });
      if (otherLinked) {
        await otherLinked.update({ userId: null });
        log(`  · desvinculado admin de "${otherLinked.displayName}"`);
      }
      if (member.userId !== adminUser.id) {
        await member.update({ userId: adminUser.id });
        log(`  ✓ vinculado al User admin`);
      } else {
        log(`  · ya estaba vinculado al User admin`);
      }
    }
  }

  process.stdout.write("\n════════════════════════════════════════\n");
  process.stdout.write(" ¡Seed completado!\n");
  process.stdout.write("════════════════════════════════════════\n");
  process.stdout.write(`  Creados:      ${created}\n`);
  process.stdout.write(`  Actualizados: ${updated}\n`);
  process.stdout.write(`  Total:        ${MEMBERS.length}\n`);
  process.stdout.write("════════════════════════════════════════\n\n");

  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
