import { Op } from "sequelize";
import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok } from "../../../../../lib/utils/apiResponse.js";
import { ValidationError } from "../../../../../lib/utils/errors.js";
import { auditar, datosPeticion } from "../../../../../lib/utils/auditoria.js";
import { autorDe, exigirMailing, leerBody, texto } from "../../../../../lib/mailing/comun.js";
import { leerCsvDeContactos, MAX_FILAS_CSV } from "../../../../../lib/mailing/csv.js";
import { enviarConfirmacion } from "../../../../../lib/mailing/confirmacion.js";
import { assertNotDemoPaidCall } from "../../../../../lib/demo/isDemo.js";

/**
 * POST /api/mailing/contactos/importar — traer correos sueltos de un CSV.
 *
 * Cuerpo: `{ csv: "texto del fichero", origen: "de dónde sale el sí", modo }`.
 *   modo = "activos"    → el origen ES la prueba de consentimiento (una hoja
 *                          de inscripción, una lista de un taller): entran
 *                          `activos` con by: "csv".
 *   modo = "confirmar"  → entran `pendientes` y se les manda el correo de
 *                          confirmación (doble opt-in). Hasta 200 por
 *                          importación, para no disparar mil correos de golpe.
 *
 * El CSV registra el ORIGEN del consentimiento (plan, entregable 2): sin
 * `origen` no se importa nada. Lo que ya está en la lista, en una ficha de
 * cliente o en supresión se salta y se cuenta, no se pisa.
 *
 * Ensayo: `{ simular: true }` devuelve los recuentos sin escribir.
 */
const MAX_CONFIRMACIONES = 200;
const MAX_CSV_BYTES = 2 * 1024 * 1024;

export const POST = withTenant(async (request, _rc, ctx) => {
  exigirMailing(ctx);
  const body = await leerBody(request);
  const csv = String(body.csv ?? "");
  if (!csv.trim()) throw new ValidationError("El CSV está vacío");
  if (csv.length > MAX_CSV_BYTES) throw new ValidationError("El CSV es demasiado grande (máximo 2 MB)");
  const origen = texto(body.origen, 300, { requerido: true, nombre: "El origen del consentimiento" });
  const modo = body.modo === "confirmar" ? "confirmar" : "activos";
  const simular = body.simular === true;
  if (modo === "confirmar" && !simular) assertNotDemoPaidCall(ctx, "El correo de confirmación");

  const leido = leerCsvDeContactos(csv);
  if (!leido.filas.length) {
    return ok({ simulado: simular, leidas: 0, invalidos: leido.invalidos.slice(0, 20), duplicadosEnFichero: leido.duplicados, creados: 0, yaEstaban: 0, deFicha: 0, suprimidos: 0, confirmacionesEnviadas: 0 });
  }
  if (modo === "confirmar" && leido.filas.length > MAX_CONFIRMACIONES) {
    throw new ValidationError(`Con confirmación por correo el tope son ${MAX_CONFIRMACIONES} direcciones por importación (son ${leido.filas.length}). Pártelo, o impórtalas como activas si ya tienes su consentimiento.`);
  }

  const { MailingContact, MailingSuppression, Client } = ctx.tenantModels;
  const emails = leido.filas.map((f) => f.email);
  const existentes = new Set((await MailingContact.findAll({ where: { email: { [Op.in]: emails } }, attributes: ["email"], raw: true })).map((f) => f.email));
  const suprimidos = new Set((await MailingSuppression.findAll({ where: { email: { [Op.in]: emails } }, attributes: ["email"], raw: true })).map((f) => f.email));
  let deFicha = new Set();
  if (ctx.tenantHasModule("clients")) {
    try {
      deFicha = new Set((await Client.findAll({ where: { email: { [Op.in]: emails } }, attributes: ["email"], raw: true })).map((f) => String(f.email).toLowerCase()));
    } catch {
      /* sin tabla de clientes */
    }
  }

  const { ip } = datosPeticion(request);
  const ahora = new Date().toISOString();
  const nuevos = leido.filas.filter((f) => !existentes.has(f.email) && !suprimidos.has(f.email) && !deFicha.has(f.email));
  const resumen = {
    simulado: simular,
    leidas: leido.filas.length,
    cabecera: leido.cabecera,
    invalidos: leido.invalidos.slice(0, 20),
    invalidosTotal: leido.invalidos.length,
    duplicadosEnFichero: leido.duplicados,
    creados: 0,
    yaEstaban: leido.filas.filter((f) => existentes.has(f.email)).length,
    deFicha: leido.filas.filter((f) => deFicha.has(f.email)).length,
    suprimidos: leido.filas.filter((f) => suprimidos.has(f.email)).length,
    confirmacionesEnviadas: 0,
    confirmacionesFallidas: 0,
    tope: MAX_FILAS_CSV,
  };
  if (simular) return ok({ ...resumen, creados: nuevos.length });

  const filas = nuevos.map((f) => ({
    email: f.email,
    nombre: f.nombre,
    origen: "csv",
    estado: modo === "activos" ? "activo" : "pendiente",
    consentimiento:
      modo === "activos"
        ? { granted: true, at: ahora, ip: ip ? String(ip).slice(0, 64) : null, userAgent: null, by: "csv", origen }
        : { granted: false, at: null, ip: null, userAgent: null, by: null, origen: `${origen} (pendiente de confirmación)` },
    createdBy: autorDe(request),
  }));
  for (let i = 0; i < filas.length; i += 500) {
    const creadas = await MailingContact.bulkCreate(filas.slice(i, i + 500), { ignoreDuplicates: true });
    resumen.creados += creadas.length;
  }

  if (modo === "confirmar") {
    const pendientes = await MailingContact.findAll({ where: { email: { [Op.in]: nuevos.map((f) => f.email) }, estado: "pendiente" } });
    for (const c of pendientes) {
      const r = await enviarConfirmacion(ctx, c, { request });
      if (r.ok) resumen.confirmacionesEnviadas++;
      else resumen.confirmacionesFallidas++;
    }
  }

  await auditar({
    tenantId: ctx.tenant.id,
    ...datosPeticion(request),
    action: "mailing.contactos.imported",
    entity: "mailing_contact",
    entityId: null,
    after: { modo, origen, leidas: resumen.leidas, creados: resumen.creados, yaEstaban: resumen.yaEstaban, deFicha: resumen.deFicha, suprimidos: resumen.suprimidos },
  });
  return ok(resumen);
});
