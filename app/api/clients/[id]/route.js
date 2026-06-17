import { promises as fs } from "node:fs";
import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, noContent, forbidden, notFound, error } from "../../../../lib/utils/apiResponse.js";
import { getClientDir } from "../../../../lib/clients/attachmentStorage.js";

export const GET = withTenant(async (_request, { params }, { tenant, tenantModels, hasModule }) => {
  if (!hasModule("clients")) return forbidden();

  const { Client, Interaction } = tenantModels;
  const { id } = await params;

  // Intento principal: cliente + interactions (timeline legacy usado por el
  // ClientDetailModule default). Si la tabla `interactions` no existe en el
  // schema del tenant (sucede p. ej. en crm_nutri_laura, donde el módulo
  // legacy nunca se sembró) → Postgres devuelve 42P01 "undefined_table" y
  // Sequelize lo envuelve en SequelizeDatabaseError. En ese caso degradamos
  // a un fetch sin include y devolvemos interactions:[] para no romper la
  // ficha completa por una sección opcional.
  let client;
  try {
    client = await Client.findByPk(id, {
      include: [{ model: Interaction, as: "interactions", order: [["date", "DESC"]] }],
    });
  } catch (err) {
    const isMissingTable =
      err?.parent?.code === "42P01" ||
      err?.original?.code === "42P01";
    if (!isMissingTable) throw err;
    process.stderr.write(
      `[clients:detail] interactions table missing for tenant ${tenant.slug} — degrading to no-include\n`
    );
    client = await Client.findByPk(id);
    if (client) {
      // Sequelize no añade el alias 'interactions' si no hay include; lo
      // emulamos en el JSON serializado para que el cliente reciba siempre
      // la misma forma (default module lee data.data.interactions).
      const json = client.toJSON();
      json.interactions = [];
      return ok(json);
    }
  }

  if (!client) return notFound("Cliente no encontrado");
  return ok(client);
});

export const PUT = withTenant(async (request, { params }, { tenantModels, hasModule }) => {
  if (!hasModule("clients")) return forbidden();

  const { Client } = tenantModels;
  const { id } = await params;
  const body = await request.json();

  const client = await Client.findByPk(id);
  if (!client) return notFound("Cliente no encontrado");

  const customFields = {
    ...client.customFields,
    company: body.company?.trim() ?? client.customFields?.company ?? null,
    country: body.country?.trim() ?? client.customFields?.country ?? null,
    city: body.city?.trim() ?? client.customFields?.city ?? null,
    topic: body.topic?.trim() ?? client.customFields?.topic ?? null,
    interestedProduct: body.interestedProduct?.trim() ?? client.customFields?.interestedProduct ?? null,
    origin: body.origin ?? client.customFields?.origin ?? "manual",
    leadId: body.leadId ?? client.customFields?.leadId ?? null,
    seStatus: body.status ?? client.customFields?.seStatus ?? "new",
  };

  // Datos fiscales (solo si vienen explícitos en el body)
  const fiscalUpdates = {};
  for (const k of ["fiscalName", "fiscalAddress", "fiscalCity", "fiscalZip", "fiscalCountry", "taxId"]) {
    if (k in body) {
      const v = body[k];
      fiscalUpdates[k] = typeof v === "string" ? (v.trim() || null) : v;
    }
  }

  await client.update({
    name: body.name?.trim() || client.name,
    email: body.email?.trim().toLowerCase() || client.email,
    phone: body.phone?.trim() || client.phone,
    notes: "notes" in body ? (body.notes?.trim() || null) : client.notes,
    customFields,
    ...fiscalUpdates,
  });

  return ok(client);
});

export const DELETE = withTenant(async (_request, { params }, { tenant, tenantModels, hasModule }) => {
  if (!hasModule("clients")) return forbidden();

  const { Client, Invoice } = tenantModels;
  const { id } = await params;

  const client = await Client.findByPk(id);
  if (!client) return notFound("Cliente no encontrado");

  // No permitir borrar si tiene facturas (preservar histórico fiscal).
  // Si la tabla `invoices` no existe en este tenant (caso nutri_laura, donde
  // el módulo billing no se sembró) → Postgres devuelve 42P01. Degradamos
  // a "no hay bloqueo por facturas" y seguimos con el borrado: el cliente
  // claramente no puede tener facturas si la tabla no existe. Mismo patrón
  // defensivo que el GET con `interactions`.
  if (Invoice) {
    try {
      const invoiceCount = await Invoice.count({ where: { clientId: id } });
      if (invoiceCount > 0) {
        return error(`No se puede borrar: el cliente tiene ${invoiceCount} factura(s). Márcalo como inactivo en su lugar.`, 409);
      }
    } catch (err) {
      const isMissingTable =
        err?.parent?.code === "42P01" ||
        err?.original?.code === "42P01";
      if (!isMissingTable) throw err;
      process.stderr.write(
        `[clients:delete] invoices table missing for tenant ${tenant.slug} — skipping invoice guard\n`
      );
    }
  }

  await client.destroy();

  // GC del directorio físico de adjuntos. El CASCADE ya borró client_attachments
  // en BD pero los archivos en disco quedarían huérfanos. Best-effort: si la
  // limpieza falla, el cliente queda borrado igual y el GC periódico (apuntado
  // al backlog) se encargará de los huérfanos.
  try {
    const dir = getClientDir(tenant.slug, id);
    await fs.rm(dir, { recursive: true, force: true });
    process.stdout.write(`[clients:attachment] cleanup dir tenant=${tenant.slug} client=${id}\n`);
  } catch (err) {
    process.stderr.write(`[clients:attachment] cleanup dir failed: ${err.message}\n`);
  }

  return noContent();
});
