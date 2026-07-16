import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { error, forbidden, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { UUID_RE, loadPlanTree } from "../../../../../../lib/nutricion/plans.js";
import { buildMenuPdfBuffer, menuPdfFilename } from "../../../../../../lib/nutricion/menuPdf.js";

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/nutricion/plans/[id]/pdf — menú del plan en PDF (descarga).
// Vale tanto para planes asignados (con paciente en la cabecera) como para
// plantillas (sin paciente): Laura puede imprimir un menú tipo.
// ─────────────────────────────────────────────────────────────────────────────
export const GET = withTenant(async (_request, ctx, { tenant, tenantModels, hasModule, brand }) => {
  try {
    if (!hasModule("nutricion")) return forbidden("Módulo nutricion no activo");
    const { id } = await ctx.params;
    if (!UUID_RE.test(id)) return error("id inválido");

    const { Plan, Client } = tenantModels;
    const tree = await loadPlanTree(Plan, tenantModels, id);
    if (!tree || tree.archivedAt) return notFound("Plan no encontrado");

    let client = null;
    if (tree.clientId) {
      client = await Client.findByPk(tree.clientId, { attributes: ["id", "name", "email"] });
    }

    const buffer = await buildMenuPdfBuffer({
      plan: tree,
      client: client ? { name: client.name } : null,
      tenantName: tenant.name,
      brand,
    });

    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${menuPdfFilename(tree, client)}"`,
        "Content-Length": String(buffer.length),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return serverError(err);
  }
});
