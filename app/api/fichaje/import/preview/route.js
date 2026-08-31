import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, serverError } from "../../../../../lib/utils/apiResponse.js";
import { previsualizar, hashDeFichero } from "../../../../../lib/fichaje/importar.js";
import { leerLibro } from "../../../../../lib/fichaje/leerLibro.js";

const ADMIN = new Set(["admin", "superadmin"]);
const MAX_BYTES = 10 * 1024 * 1024;

/**
 * POST /api/fichaje/import/preview — multipart `file` + `periodo`.
 *
 * NO ESCRIBE NADA. Ni una fila, ni un alias, ni el lote. Se puede subir el
 * fichero equivocado las veces que haga falta sin consecuencias, que es
 * exactamente lo que se necesita cuando lo que está en juego es una nómina.
 *
 * El periodo lo manda quien importa y no se deduce del fichero: las hojas del
 * Excel de Aumenta se llaman «02-6» y «9-13», y ahí no pone el mes por ningún
 * lado. Adivinarlo por la fecha del fichero o por el mes en curso es cómo se
 * cargan las horas de marzo encima de las de abril.
 */
export const POST = withTenant(async (request, _ctx, { tenantModels, hasModule }) => {
  try {
    if (!hasModule("fichaje")) return forbidden("Módulo fichaje no activo");
    if (!ADMIN.has(request.headers.get("x-user-role"))) return forbidden("Solo administradores");

    const form = await request.formData();
    const file = form.get("file");
    const periodo = String(form.get("periodo") || "").trim();

    if (!file || typeof file.arrayBuffer !== "function") return error("Falta el fichero");
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodo)) return error("Falta el mes o no tiene formato AAAA-MM");
    if (file.size > MAX_BYTES) return error(`El fichero pasa de ${MAX_BYTES / 1024 / 1024} MB`);

    const buffer = Buffer.from(await file.arrayBuffer());
    let workbook;
    try {
      workbook = await leerLibro(buffer);
    } catch {
      return error("No se ha podido abrir el fichero: ¿es un Excel de verdad (.xlsx o .xls)?", 422);
    }

    const preview = await previsualizar({
      workbook,
      periodo,
      slug: request.headers.get("x-tenant"),
      tenantModels,
      fileHash: hashDeFichero(buffer),
    });

    return ok({ ...preview, fileName: file.name || null });
  } catch (err) {
    return serverError(err);
  }
});
