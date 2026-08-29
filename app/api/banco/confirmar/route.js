import { withTenant } from "../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden } from "../../../../lib/utils/apiResponse.js";
import {
  verRequisicion,
  datosDeCuenta,
  caducidadDelAcuerdo,
  nombreDelBanco,
} from "../../../../lib/banco/gocardless.js";
import { isDemoTenant } from "../../../../lib/demo/isDemo.js";
import { auditar, datosPeticion } from "../../../../lib/utils/auditoria.js";

/**
 * POST /api/banco/confirmar { ref }
 *
 * La vuelta del banco. GoCardless redirige a /facturacion/banco?ref=<requisición>
 * y la pantalla remata aquí: se pregunta por la requisición y, si el usuario
 * llegó a consentir, se guardan sus cuentas. Es idempotente por `accountUid`
 * (UNIQUE): recargar la página con el mismo ?ref= no duplica cuentas, y
 * reconectar un banco caducado actualiza su fila y la devuelve a `linked`.
 */
export const POST = withTenant(async (request, _ctx, ctx) => {
  if (!ctx.hasModule("billing_banco")) return forbidden("Módulo billing_banco no activo");
  const role = ctx.user?.role;
  if (role !== "admin" && role !== "superadmin") {
    return forbidden("Solo los administradores pueden conectar el banco");
  }
  if (isDemoTenant(ctx)) return forbidden("La demo no puede conectarse a un banco real");

  let body;
  try {
    body = await request.json();
  } catch {
    return error("Body inválido");
  }
  const ref = typeof body.ref === "string" ? body.ref.trim() : "";
  if (!ref) return error("Falta la referencia de la conexión (ref)");

  const req = await verRequisicion(ctx, ref);

  // La requisición TIENE que ser de este tenant: la referencia se creó como
  // `<slug>-<uuid>` en /conectar. Sin esta comprobación, un admin de un tenant
  // podría confirmar aquí la requisición de otro y llevarse sus cuentas.
  if (typeof req?.reference === "string" && !req.reference.startsWith(`${ctx.slug}-`)) {
    return forbidden("Esa conexión no es de este cliente");
  }

  // LN = linked: el usuario terminó en el banco. CR/GC/UA/SA son pasos a medias
  // (volvió sin acabar); EX es que el enlace caducó sin usarse.
  if (req?.status !== "LN") {
    if (req?.status === "EX") return error("El enlace de conexión caducó sin completarse. Vuelve a conectar el banco.", 409);
    return error("La conexión con el banco no llegó a completarse. Vuelve a intentarlo.", 409);
  }

  const uids = Array.isArray(req.accounts) ? req.accounts : [];
  if (!uids.length) return error("El banco no concedió ninguna cuenta", 409);

  const { BankAccount } = ctx.tenantModels;
  const caduca = await caducidadDelAcuerdo(ctx, req.agreement);
  const nombreBanco = await nombreDelBanco(ctx, req.institution_id);

  const cuentas = [];
  for (const uid of uids) {
    const datos = await datosDeCuenta(ctx, uid);
    const fila = {
      requisitionId: ref,
      institutionId: req.institution_id ?? datos.institutionId ?? "desconocido",
      institutionName: nombreBanco,
      iban: datos.iban,
      name: datos.nombre,
      currency: datos.divisa ? String(datos.divisa).toUpperCase().slice(0, 3) : null,
      status: "linked",
      agreementExpiresAt: caduca,
      lastSyncError: null,
    };

    const existente = await BankAccount.findOne({ where: { accountUid: uid } });
    const cuenta = existente ? await existente.update(fila) : await BankAccount.create({ ...fila, accountUid: uid });
    cuentas.push(cuenta);
  }

  // DESPUÉS de la mutación y best-effort: conectar una cuenta bancaria es de lo
  // que tiene que dejar rastro de quién y cuándo.
  const { userId, ip } = datosPeticion(request);
  for (const cuenta of cuentas) {
    await auditar({
      tenantId: ctx.tenant.id,
      userId,
      action: "banco.cuenta.conectada",
      entity: "BankAccount",
      entityId: cuenta.id,
      before: null,
      after: { banco: cuenta.institutionName, iban: cuenta.iban },
      ip,
    });
  }

  return ok({
    cuentas: cuentas.map((c) => ({ id: c.id, institutionName: c.institutionName, iban: c.iban, name: c.name })),
  });
});
