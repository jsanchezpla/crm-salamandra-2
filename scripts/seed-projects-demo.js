/**
 * seed-projects-demo.js
 *
 * Sprint 1 Proyectos: datos demo coherentes para el tenant `demo`.
 *
 * Crea:
 *   - 4 proyectos (1 activo, 1 en pausa, 1 completado, 1 borrador) con
 *     fases, hitos, BoardColumns por defecto y miembros del equipo.
 *   - 2 plantillas globales: "Proyecto estándar" y "Proyecto express".
 *   - Vincula un lead existente como convertido a uno de los proyectos.
 *
 * Idempotente: usa marcador `customFields.seed = "projects-demo-v1"` en
 * proyectos y plantillas para no duplicar al re-ejecutar. Activa el
 * módulo `projects` en demo si está inactivo.
 *
 * Uso: npm run db:seed:projects-demo
 */

import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb } from "../lib/db/tenantDb.js";

const SLUG = "demo";
const SEED_MARKER = "projects-demo-v1";

function log(msg) { process.stdout.write(`  ${msg}\n`); }
function header(msg) { process.stdout.write(`\n▶ ${msg}\n`); }

async function activateProjectsModule() {
  const { Tenant, TenantModule } = getMasterModels();
  const tenant = await Tenant.findOne({ where: { slug: SLUG } });
  if (!tenant) throw new Error(`Tenant '${SLUG}' no encontrado en master.tenants`);

  const [mod, wasCreated] = await TenantModule.findOrCreate({
    where: { tenantId: tenant.id, moduleKey: "projects" },
    defaults: { tenantId: tenant.id, moduleKey: "projects", enabled: true },
  });
  if (!wasCreated && !mod.enabled) {
    await mod.update({ enabled: true });
    log(`✓ Módulo 'projects' activado en tenant ${SLUG}`);
  } else if (wasCreated) {
    log(`✓ Módulo 'projects' creado y activado en tenant ${SLUG}`);
  } else {
    log(`· Módulo 'projects' ya activo en tenant ${SLUG}`);
  }
}

async function ensureTemplates(models) {
  const { ProjectTemplate } = models;
  const templates = [
    {
      name: "Proyecto estándar",
      description: "Plantilla genérica con 4 fases para cualquier sector.",
      phases: [
        { name: "Análisis", order: 0, durationDays: 14, color: "#3B82F6" },
        { name: "Diseño", order: 1, durationDays: 14, color: "#8B5CF6" },
        { name: "Ejecución", order: 2, durationDays: 30, color: "#F59E0B" },
        { name: "Cierre", order: 3, durationDays: 7, color: "#10B981" },
      ],
      boardColumns: [
        { name: "Por hacer", order: 0, color: "#94A3B8", isDoneColumn: false },
        { name: "En curso", order: 1, color: "#3B82F6", isDoneColumn: false },
        { name: "En revisión", order: 2, color: "#F59E0B", isDoneColumn: false },
        { name: "Hecho", order: 3, color: "#10B981", isDoneColumn: true },
      ],
      defaultMilestones: [
        { name: "Inicio del proyecto", dueOffsetDays: 0 },
        { name: "Entrega beta", dueOffsetDays: 28 },
        { name: "Entrega final", dueOffsetDays: 60 },
      ],
      defaultTags: ["estándar"],
    },
    {
      name: "Proyecto express",
      description: "Plantilla corta de 2 fases para encargos de menos de 1 mes.",
      phases: [
        { name: "Definición", order: 0, durationDays: 3, color: "#3B82F6" },
        { name: "Entrega", order: 1, durationDays: 14, color: "#10B981" },
      ],
      boardColumns: [
        { name: "Por hacer", order: 0, color: "#94A3B8", isDoneColumn: false },
        { name: "En curso", order: 1, color: "#3B82F6", isDoneColumn: false },
        { name: "Hecho", order: 2, color: "#10B981", isDoneColumn: true },
      ],
      defaultMilestones: [
        { name: "Briefing recibido", dueOffsetDays: 0 },
        { name: "Entrega", dueOffsetDays: 14 },
      ],
      defaultTags: ["express"],
    },
  ];

  for (const t of templates) {
    const [, wasCreated] = await ProjectTemplate.findOrCreate({
      where: { name: t.name },
      defaults: t,
    });
    log(wasCreated ? `✓ Plantilla "${t.name}": creada` : `· Plantilla "${t.name}": ya existe`);
  }
}

async function ensureProjects(models) {
  const { Project, Phase, Milestone, BoardColumn, ProjectMember, TeamMember, Client, Lead } = models;

  // Recursos demo
  const teamMembers = await TeamMember.findAll({
    where: { status: "active" },
    order: [["displayName", "ASC"]],
    limit: 4,
  });
  if (teamMembers.length < 2) {
    log("· Solo se han encontrado <2 TeamMembers activos en demo. El seed continúa pero los proyectos quedarán con menos miembros.");
  }
  const tmAna = teamMembers[0];
  const tmCarlos = teamMembers[1];
  const tmLaura = teamMembers[2];
  const tmMiguel = teamMembers[3];

  const clients = await Client.findAll({ order: [["name", "ASC"]], limit: 2 });
  const client1 = clients[0];
  const client2 = clients[1];

  const projects = [
    {
      name: "Implantación CRM Quality Energy",
      code: "PRY-2026-0001",
      description: "Despliegue del CRM y migración de datos del sistema antiguo.",
      clientId: client1?.id ?? null,
      status: "active",
      priority: "high",
      startDate: "2026-04-01",
      dueDate: "2026-09-30",
      budgetAmount: 18000,
      tags: ["consultoría", "implantación"],
      phases: [
        { name: "Discovery", order: 0, color: "#3B82F6", startDate: "2026-04-01", endDate: "2026-04-21", completedAt: new Date("2026-04-21") },
        { name: "Configuración", order: 1, color: "#8B5CF6", startDate: "2026-04-22", endDate: "2026-06-30" },
        { name: "Migración", order: 2, color: "#F59E0B", startDate: "2026-07-01", endDate: "2026-08-31" },
        { name: "Go-live", order: 3, color: "#10B981", startDate: "2026-09-01", endDate: "2026-09-30" },
      ],
      milestones: [
        { name: "Kick-off firmado", dueDate: "2026-04-05", status: "completed", completedAt: new Date("2026-04-05") },
        { name: "Datos maestros migrados", dueDate: "2026-08-15", status: "pending" },
        { name: "Go-live", dueDate: "2026-09-30", status: "pending" },
      ],
      members: [
        { tm: tmAna, role: "lead" },
        { tm: tmCarlos, role: "member" },
        { tm: tmLaura, role: "member" },
      ].filter((m) => m.tm),
    },
    {
      name: "Auditoría energética anual",
      code: "PRY-2026-0002",
      description: "Auditoría anual y propuesta de mejoras de eficiencia.",
      clientId: client2?.id ?? null,
      status: "paused",
      priority: "medium",
      startDate: "2026-02-01",
      dueDate: "2026-06-30",
      budgetAmount: 4500,
      tags: ["auditoría"],
      phases: [
        { name: "Recogida de datos", order: 0, color: "#3B82F6" },
        { name: "Análisis", order: 1, color: "#F59E0B" },
        { name: "Informe", order: 2, color: "#10B981" },
      ],
      milestones: [
        { name: "Datos recibidos", dueDate: "2026-03-15", status: "completed", completedAt: new Date("2026-03-15") },
        { name: "Informe entregado", dueDate: "2026-06-15", status: "pending" },
      ],
      members: [
        { tm: tmCarlos, role: "lead" },
        { tm: tmAna, role: "viewer" },
      ].filter((m) => m.tm),
    },
    {
      name: "Web corporativa rediseño",
      code: "PRY-2026-0003",
      description: "Rediseño completo y migración a nuevo CMS.",
      clientId: client1?.id ?? null,
      status: "completed",
      priority: "medium",
      startDate: "2025-11-01",
      dueDate: "2026-02-28",
      completedAt: new Date("2026-02-25"),
      budgetAmount: 12000,
      tags: ["web", "diseño"],
      phases: [
        { name: "Wireframes", order: 0, color: "#3B82F6", completedAt: new Date("2025-11-30") },
        { name: "Diseño", order: 1, color: "#8B5CF6", completedAt: new Date("2025-12-31") },
        { name: "Desarrollo", order: 2, color: "#F59E0B", completedAt: new Date("2026-02-15") },
        { name: "Lanzamiento", order: 3, color: "#10B981", completedAt: new Date("2026-02-25") },
      ],
      milestones: [
        { name: "Aprobación de diseño", dueDate: "2025-12-31", status: "completed", completedAt: new Date("2025-12-30") },
        { name: "Lanzamiento", dueDate: "2026-02-28", status: "completed", completedAt: new Date("2026-02-25") },
      ],
      members: [
        { tm: tmLaura, role: "lead" },
        { tm: tmMiguel, role: "member" },
      ].filter((m) => m.tm),
    },
    {
      name: "Plan de comunicación 2026 Q3",
      code: "PRY-2026-0004",
      description: "Borrador inicial del plan de comunicación trimestral.",
      clientId: null,
      status: "draft",
      priority: "low",
      startDate: null,
      dueDate: null,
      budgetAmount: null,
      tags: ["interno", "comunicación"],
      phases: [],
      milestones: [],
      members: tmAna ? [{ tm: tmAna, role: "lead" }] : [],
    },
  ];

  const sequelize = Project.sequelize;
  for (const spec of projects) {
    const existing = await Project.findOne({ where: { code: spec.code } });
    if (existing && existing.customFields?.seed === SEED_MARKER) {
      log(`· Proyecto "${spec.name}" (${spec.code}): ya existe`);
      continue;
    }
    if (existing) {
      log(`· Proyecto código ${spec.code}: existe pero sin marcador, salto`);
      continue;
    }

    await sequelize.transaction(async (t) => {
      const project = await Project.create({
        name: spec.name,
        code: spec.code,
        description: spec.description,
        clientId: spec.clientId,
        status: spec.status,
        priority: spec.priority,
        startDate: spec.startDate,
        dueDate: spec.dueDate,
        completedAt: spec.completedAt ?? null,
        budgetAmount: spec.budgetAmount,
        budgetCurrency: "EUR",
        tags: spec.tags,
        customFields: { seed: SEED_MARKER },
      }, { transaction: t });

      // 4 columnas por defecto
      const defaultCols = [
        { name: "Por hacer", order: 0, color: "#94A3B8", isDoneColumn: false },
        { name: "En curso", order: 1, color: "#3B82F6", isDoneColumn: false },
        { name: "En revisión", order: 2, color: "#F59E0B", isDoneColumn: false },
        { name: "Hecho", order: 3, color: "#10B981", isDoneColumn: true },
      ];
      for (const c of defaultCols) {
        await BoardColumn.create({ projectId: project.id, ...c }, { transaction: t });
      }

      for (const ph of spec.phases) {
        await Phase.create({ projectId: project.id, ...ph }, { transaction: t });
      }
      for (const mi of spec.milestones) {
        await Milestone.create({ projectId: project.id, ...mi }, { transaction: t });
      }
      for (const m of spec.members) {
        await ProjectMember.create({
          projectId: project.id,
          teamMemberId: m.tm.id,
          role: m.role,
        }, { transaction: t });
      }
    });
    log(`✓ Proyecto "${spec.name}" (${spec.code}): creado con ${spec.phases.length} fases, ${spec.milestones.length} hitos, ${spec.members.length} miembros`);
  }

  // Vincular un lead como convertido al primer proyecto (solo si nunca se vinculó)
  const firstProject = await Project.findOne({ where: { code: "PRY-2026-0001" } });
  if (firstProject) {
    const alreadyLinked = await Lead.count({ where: { convertedProjectId: firstProject.id } });
    if (alreadyLinked > 0) {
      log(`· Lead ya vinculado a ${firstProject.code}, salto`);
      return;
    }
    const leadToConvert = await Lead.findOne({
      where: { convertedProjectId: null },
      order: [["createdAt", "DESC"]],
    });
    if (leadToConvert) {
      await leadToConvert.update({
        convertedProjectId: firstProject.id,
        convertedToProjectAt: new Date(),
        stage: ["won", "closed_yes"].includes(leadToConvert.stage) ? leadToConvert.stage : "won",
      });
      log(`✓ Lead "${leadToConvert.name ?? leadToConvert.title ?? leadToConvert.id}" vinculado a ${firstProject.code}`);
    } else {
      log(`· No se encontró lead libre para vincular`);
    }
  }
}

async function main() {
  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(` Seed: Proyectos demo (tenant ${SLUG})                \n`);
  process.stdout.write("════════════════════════════════════════════════════\n");

  if (!process.env.DATABASE_URL) {
    process.stderr.write("\n✗ DATABASE_URL no configurada\n");
    process.exit(1);
  }

  // Asegurar schema master cargado y módulo activo
  getMasterDb();
  await activateProjectsModule();

  header(`Cargando modelos del tenant ${SLUG}...`);
  const { models } = getTenantDb(SLUG);

  header("Asegurando plantillas globales del tenant...");
  await ensureTemplates(models);

  header("Asegurando proyectos demo...");
  await ensureProjects(models);

  process.stdout.write("\n════════════════════════════════════════════════════\n");
  process.stdout.write(" ✓ Seed completado                                    \n");
  process.stdout.write("════════════════════════════════════════════════════\n\n");
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`\n✗ Error: ${err.message}\n`);
  if (process.env.NODE_ENV !== "production") {
    process.stderr.write(`${err.stack}\n`);
  }
  process.exit(1);
});
