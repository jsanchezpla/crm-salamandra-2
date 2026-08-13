import ExcelJS from "exceljs";

import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, serverError } from "../../../../lib/utils/apiResponse.js";
import { auditar, datosPeticion } from "../../../../lib/utils/auditoria.js";
import { aplicar, hashDeFichero } from "../../../../lib/fichaje/importar.js";
import { resolveCurrentTeamMemberId } from "../../../../lib/team/currentTeamMember.js";
import { isDemoTenant } from "../../../../lib/demo/isDemo.js";

const ADMIN = new Set(["admin", "superadmin"]);
const MAX_BYTES = 10 * 1024 * 1024;

/**
 * POST /api/fichaje/import — aplica el volcado. Multipart `file`, `periodo` y
 * `mapeos` (JSON {nombreExcel: teamMemberId}).
 *
 * Todo lo delicado está en `lib/fichaje/importar.js`: una transacción, reemplazo
 * del volcado anterior del mismo mes, y las correcciones a mano intactas. Aquí
 * solo se comprueba quién llama.
 */
export const POST = withTenant(async (request, _ctx, ctx) => {
  const { tenant, tenantModels, tenantSequelize, hasModule, user } = ctx;
  try {
    if (!hasModule("fichaje")) return forbidden("Módulo fichaje no activo");
    if (!ADMIN.has(request.headers.get("x-user-role"))) return forbidden("Solo administradores");
    // La demo es pública y da sesión de admin a cualquiera. Dejar que un
    // visitante anónimo escriba jornadas del escaparate no rompe nada grave,
    // pero ensucia la demo para el siguiente y no aporta: se ve igual con los
    // datos sembrados.
    if (isDemoTenant(ctx)) return forbidden("En la demo el volcado está deshabilitado: mira los datos ya cargados");

    const form = await request.formData();
    const file = form.get("file");
    const periodo = String(form.get("periodo") || "").trim();

    if (!file || typeof file.arrayBuffer !== "function") return error("Falta el fichero");
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodo)) return error("Falta el mes o no tiene formato AAAA-MM");
    if (file.size > MAX_BYTES) return error(`El fichero pasa de ${MAX_BYTES / 1024 / 1024} MB`);

    let mapeos = {};
    const crudo = form.get("mapeos");
    if (crudo) {
      try {
        mapeos = JSON.parse(String(crudo));
      } catch {
        return error("`mapeos` no es un JSON válido");
      }
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer);
    } catch {
      return error("No se ha podido abrir el fichero: ¿es un .xlsx de verdad?", 422);
    }

    let res;
    try {
      res = await aplicar({
        workbook,
        periodo,
        slug: request.headers.get("x-tenant"),
        tenantModels,
        tenantSequelize,
        fileName: file.name || null,
        fileHash: hashDeFichero(buffer),
        mapeos,
        importedByTeamId: await resolveCurrentTeamMemberId(request, tenantModels).catch(() => null),
        importedByUserId: user?.id ?? null,
      });
    } catch (e) {
      // Los tres fallos previstos son de datos, no del servidor: se contestan
      // con su mensaje para que la pantalla pueda decir qué falta.
      if (["mapeo_incompleto", "sin_filas"].includes(e.code)) return error(e.message, 422);
      throw e;
    }

    await auditar({
      tenantId: tenant.id,
      userId: user?.id ?? null,
      action: "fichaje.volcado",
      entity: "FichajeImport",
      entityId: res.loteId,
      after: { periodo, jornadas: res.creadas, reemplazadas: res.reemplazadas, fichero: file.name || null },
      ...datosPeticion(request),
    });

    return ok(res);
  } catch (err) {
    return serverError(err);
  }
});
