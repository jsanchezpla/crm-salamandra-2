import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, forbidden, error } from "../../../../lib/utils/apiResponse.js";
import {
  normalizeContactValue,
  setPrimaryContactValue,
  isMissingTable,
} from "../../../../lib/clients/contactMethods.js";
import { applyAutoAssignments } from "../../../../lib/clients/moduleAssignments.js";

const VALID_STATUSES = ["new", "contacted", "following", "converted", "discarded"];

export const POST = withTenant(async (request, _ctx, { tenantModels, tenantSequelize, hasModule, tenantHasModule, user }) => {
  if (!hasModule("clients")) return forbidden();

  const { Client, ClientContactMethod } = tenantModels;
  // El email/teléfono importado también materializa el método de contacto
  // PRINCIPAL (si no, la ficha nueva mostraría "Sin contactos" pese a tener
  // client.email). Si el tenant aún no tiene la tabla (42P01), se desactiva el
  // espejo para el resto del lote y se cae a Client.create en plano.
  let mirrorAvailable = !!ClientContactMethod;
  const body = await request.json();
  const rows = body.clients;

  if (!Array.isArray(rows) || rows.length === 0) {
    return error("No hay filas para importar", 400);
  }
  if (rows.length > 1000) {
    return error("Máximo 1000 clientes por importación", 400);
  }

  const results = { imported: 0, skipped: 0, errors: [] };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      const name = row.nombre?.toString().trim() || row.name?.toString().trim() || null;
      const email = row.email?.toString().trim().toLowerCase() || null;
      const phone = (row.teléfono || row.telefono || row.phone)?.toString().trim() || null;

      if (!name && !email && !phone) {
        results.skipped++;
        continue;
      }
      if (!name) {
        results.errors.push({ row: i + 2, message: "Nombre obligatorio" });
        continue;
      }

      const customFields = {
        company: (row.empresa || row.company)?.toString().trim() || null,
        country: (row.país || row.pais || row.country)?.toString().trim() || null,
        city: (row.ciudad || row.city)?.toString().trim() || null,
        origin: row.origin || "import",
        seStatus: VALID_STATUSES.includes(row.status) ? row.status : "new",
      };

      const notes = (row.notas || row.notes)?.toString().trim() || null;

      const emailN = normalizeContactValue("email", email);
      const phoneN = normalizeContactValue("phone", phone);
      const payload = { name, email: emailN, phone: phoneN, notes, customFields };

      try {
        let clientId = null;
        if (mirrorAvailable) {
          await tenantSequelize.transaction(async (t) => {
            const c = await Client.create(payload, { transaction: t });
            clientId = c.id;
            if (emailN) await setPrimaryContactValue({ client: c, ClientContactMethod, kind: "email", value: emailN, transaction: t });
            if (phoneN) await setPrimaryContactValue({ client: c, ClientContactMethod, kind: "phone", value: phoneN, transaction: t });
          });
        } else {
          const c = await Client.create(payload);
          clientId = c.id;
        }
        // Marcado automático de módulos (fuera de la tx, best-effort).
        await applyAutoAssignments({ tenantModels, clientId, tenantHasModule, userId: user?.id ?? null });
        results.imported++;
      } catch (err) {
        // Tenant sin la tabla de contactos: desactiva el espejo y reintenta en plano.
        if (mirrorAvailable && isMissingTable(err)) {
          mirrorAvailable = false;
          const c = await Client.create(payload);
          await applyAutoAssignments({ tenantModels, clientId: c.id, tenantHasModule, userId: user?.id ?? null });
          results.imported++;
        } else {
          throw err;
        }
      }
    } catch {
      results.errors.push({ row: i + 2, message: "Error al crear el cliente" });
    }
  }

  return ok(results, 201);
});
