import { createSequelizeInstance } from "./sequalize.js";
import { defineClient } from "../../models/tenant/Client.model.js";
import { defineContact } from "../../models/tenant/Contact.model.js";
import { defineLead } from "../../models/tenant/Lead.model.js";
import { defineProject } from "../../models/tenant/Project.model.js";
import { defineTask } from "../../models/tenant/Task.model.js";
import { defineTicket } from "../../models/tenant/Ticket.model.js";
import { defineInvoice } from "../../models/tenant/Invoice.model.js";
import { definePayment } from "../../models/tenant/Payment.model.js";
import { defineRate } from "../../models/tenant/Rate.model.js";
import { defineRecurringInvoice } from "../../models/tenant/RecurringInvoice.model.js";
import { defineCost } from "../../models/tenant/Cost.model.js";
import { defineTeamMember } from "../../models/tenant/TeamMember.model.js";
import { defineAsset } from "../../models/tenant/Asset.model.js";
import { defineTraining } from "../../models/tenant/Training.model.js";
import { defineNotification } from "../../models/tenant/Notification.model.js";
import { defineMessage } from "../../models/tenant/Message.model.js";
import { defineQuizAttempt } from "../../models/tenant/QuizAttempt.model.js";

// Map<slug, { sequelize, models, lastUsed }>
const pool = new Map();
const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutos

function initTenantDb(slug) {
  const schema = `crm_${slug}`;
  const sequelize = createSequelizeInstance(schema);

  // ── Modelos base ────────────────────────────────────────────────────────────
  const Client = defineClient(sequelize);
  const Contact = defineContact(sequelize);
  const Lead = defineLead(sequelize);
  const Project = defineProject(sequelize);
  const Task = defineTask(sequelize);
  const Ticket = defineTicket(sequelize);
  const TeamMember = defineTeamMember(sequelize);
  const Asset = defineAsset(sequelize);
  const Training = defineTraining(sequelize);
  const Notification = defineNotification(sequelize);
  const Message = defineMessage(sequelize);
  const QuizAttempt = defineQuizAttempt(sequelize);

  // ── Módulo de facturación ───────────────────────────────────────────────────
  const Invoice = defineInvoice(sequelize);
  const Payment = definePayment(sequelize);
  const Rate = defineRate(sequelize);
  const RecurringInvoice = defineRecurringInvoice(sequelize);
  const Cost = defineCost(sequelize);

  // ── Asociaciones base ───────────────────────────────────────────────────────
  Client.hasMany(Contact, { foreignKey: "clientId", as: "contacts" });
  Contact.belongsTo(Client, { foreignKey: "clientId", as: "client" });

  Client.hasMany(Lead, { foreignKey: "clientId", as: "leads" });
  Lead.belongsTo(Client, { foreignKey: "clientId", as: "client" });

  Client.hasMany(Project, { foreignKey: "clientId", as: "projects" });
  Project.belongsTo(Client, { foreignKey: "clientId", as: "client" });

  Project.hasMany(Task, { foreignKey: "projectId", as: "tasks" });
  Task.belongsTo(Project, { foreignKey: "projectId", as: "project" });

  Client.hasMany(Ticket, { foreignKey: "clientId", as: "tickets" });
  Client.hasMany(Asset, { foreignKey: "clientId", as: "assets" });

  // ── Asociaciones de facturación ─────────────────────────────────────────────
  Client.hasMany(Invoice, { foreignKey: "clientId", as: "invoices" });
  Invoice.belongsTo(Client, { foreignKey: "clientId", as: "client" });

  Invoice.hasMany(Payment, { foreignKey: "invoiceId", as: "payments" });
  Payment.belongsTo(Invoice, { foreignKey: "invoiceId", as: "invoice" });

  TeamMember.hasMany(Rate, { foreignKey: "therapistId", as: "rates" });
  Rate.belongsTo(TeamMember, { foreignKey: "therapistId", as: "therapist" });

  TeamMember.hasMany(Invoice, { foreignKey: "therapistId", as: "invoicesAsTherapist" });
  Invoice.belongsTo(TeamMember, { foreignKey: "therapistId", as: "therapist" });

  Client.hasMany(RecurringInvoice, { foreignKey: "clientId", as: "recurringInvoices" });
  RecurringInvoice.belongsTo(Client, { foreignKey: "clientId", as: "client" });

  TeamMember.hasMany(Cost, { foreignKey: "therapistId", as: "costs" });
  Cost.belongsTo(TeamMember, { foreignKey: "therapistId", as: "therapist" });

  const models = {
    Client,
    Contact,
    Lead,
    Project,
    Task,
    Ticket,
    Invoice,
    Payment,
    Rate,
    RecurringInvoice,
    Cost,
    TeamMember,
    Asset,
    Training,
    Notification,
    Message,
    QuizAttempt,
  };

  return { sequelize, models };
}

export function getTenantDb(slug) {
  if (!slug || !/^[a-z0-9_]+$/.test(slug)) {
    throw new Error(`Invalid tenant slug: ${slug}`);
  }

  const cached = pool.get(slug);
  if (cached) {
    cached.lastUsed = Date.now();
    return cached;
  }

  const { sequelize, models } = initTenantDb(slug);
  const entry = { sequelize, models, lastUsed: Date.now() };
  pool.set(slug, entry);
  return entry;
}

export async function closeAllConnections() {
  const closings = [];
  for (const [slug, entry] of pool.entries()) {
    closings.push(entry.sequelize.close().then(() => pool.delete(slug)));
  }
  await Promise.all(closings);
}

export function getPoolStats() {
  const stats = [];
  for (const [slug, entry] of pool.entries()) {
    stats.push({
      slug,
      schema: `crm_${slug}`,
      idleMs: Date.now() - entry.lastUsed,
    });
  }
  return stats;
}

// Purge de conexiones idle cada 5 minutos
setInterval(async () => {
  const now = Date.now();
  for (const [slug, entry] of pool.entries()) {
    if (now - entry.lastUsed > IDLE_TIMEOUT_MS) {
      try {
        await entry.sequelize.close();
        pool.delete(slug);
      } catch {
        // Ignorar errores de cierre silencioso
      }
    }
  }
}, IDLE_TIMEOUT_MS);
