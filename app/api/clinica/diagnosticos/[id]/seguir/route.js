import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok, error, errorConDatos, forbidden, notFound, serverError } from "../../../../../../lib/utils/apiResponse.js";
import { auditar, datosPeticion, resumen } from "../../../../../../lib/utils/auditoria.js";
import { puedeDarBonos } from "../../../../../../lib/citas/quienDaBonos.js";
import { clientIdOfPatient } from "../../../../../../lib/clinica/patientClient.js";
import { crearBonoConSuCobro } from "../../../../../../lib/billing/altaDeBono.js";
import { puedePasarA, cobroDelProducto, cobroDeLaEntrevista, ROTULO_ESTADO } from "../../../../../../lib/clinica/diagnostico.js";
import { descuentoDeLaEntrevista } from "../../../../../../lib/clinica/adoptarEnDiagnostico.js";
import { UUID_RE, MOTIVO_SIN_PERMISO_DIAGNOSTICO, textoEnFacturaDe, centimosDe } from "../../../../../../lib/clinica/diagnosticoFila.js";
import {
  tablaAusente,
  catalogoDelCentro,
  conceptoDelExpediente,
  productoDelExpediente,
  cobroDeEntrevistaDelExpediente,
  resumenDeCobro,
  nombreDeQuienPide,
  filasDe,
} from "../../../../../../lib/clinica/diagnosticoDb.js";

/**
 * POST /api/clinica/diagnosticos/[id]/seguir — la familia SIGUE con el
 * diagnóstico tras la entrevista inicial (12/09/2026).
 *
 * Nacen, por la MISMA puerta que un bono dado a mano
 * (`lib/billing/altaDeBono.js`, la regla de AV-0070: el bono y su deuda en una
 * transacción):
 *   · un bono SIN TOPE del tipo DIAGNÓSTICO para la familia y ese paciente
 *     (`session_packs.total_sessions` a NULL; sus horas las acota el
 *     expediente, no un contador);
 *   · su cobro PENDIENTE con el precio del producto: el concepto del catálogo
 *     («Diagnóstico Simple» 350 €, «Diagnóstico Completo» 650 €) o, sin él,
 *     el precio de caída del producto. La entrevista va DENTRO de ese precio.
 * Y el expediente pasa a `en_curso` con su `packId`.
 *
 * ── Y SE DESCUENTA LA ENTREVISTA YA COBRADA (12/09/2026, Aumenta) ─────────
 * «Los 50 € de la entrevista inicial de Lea descuentan del importe de la
 * valoración completa»: si el expediente tiene su cobro de entrevista —el
 * atado por `entrevistaPaymentId` (el alta que adopta una entrevista ya
 * cobrada) o, en los expedientes anteriores a la columna, el que encuentra
 * `cobrosDeExpedientes`—, el producto nace por `precio − entrevista`
 * (`descuentoDeLaEntrevista`, cobrada o pendiente y no devuelta) y la nota
 * del cobro lo dice. Es el MISMO cálculo que `cobroAlSeguir` en la fila: lo
 * que la pantalla anuncia en la confirmación es lo que se apunta.
 *
 * Solo dirección o quien lleve Facturación (`puedeDarBonos`). 409 si ya tiene
 * bono. Si un intento anterior dejó el bono creado y el expediente sin
 * apuntar (se cortó entre las dos escrituras), se ADOPTA ese bono en vez de
 * crear otro: `session_packs.diagnostico_id` es lo que permite encontrarlo.
 */

const normalizaCorreo = (v) => (typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? v.trim().toLowerCase() : null);

export const POST = withTenant(async (request, routeCtx, ctx) => {
  const { tenant, tenantModels, hasModule } = ctx;
  if (!hasModule("clinica")) return forbidden();
  const puedeDecidir = puedeDarBonos({ role: request.headers.get("x-user-role") ?? "user", hasModule });
  if (!puedeDecidir) return forbidden(MOTIVO_SIN_PERMISO_DIAGNOSTICO);

  try {
    const { Diagnostico, SessionPack, Client } = tenantModels;
    const { id } = (await routeCtx?.params) ?? {};
    if (!Diagnostico || !UUID_RE.test(String(id ?? ""))) return notFound("Ese diagnóstico no existe");

    const expediente = await Diagnostico.findByPk(id);
    if (!expediente) return notFound("Ese diagnóstico no existe");
    if (expediente.packId) return errorConDatos("Este diagnóstico ya tiene su bono", 409, { packId: expediente.packId, status: expediente.status });
    if (!puedePasarA(expediente.status, "en_curso")) {
      return errorConDatos(
        `No se puede seguir con un diagnóstico que está en «${ROTULO_ESTADO[expediente.status] ?? expediente.status}»`,
        409,
        { status: expediente.status }
      );
    }
    if (!SessionPack) return error("Este centro no tiene bonos de sesiones: hace falta el módulo de Citas", 422);

    const catalogo = await catalogoDelCentro(tenantModels);
    // El tipo DIAGNÓSTICO: el que el expediente tiene apuntado o, si el centro
    // lo creó después de abrirlo, el que hay ahora.
    const tipo =
      (expediente.eventTypeId && catalogo.tipos.find((t) => String(t.id) === String(expediente.eventTypeId))) ||
      catalogo.tipoDiagnostico;
    if (!tipo) return error("Este centro no tiene un tipo de cita DIAGNÓSTICO: créalo en Configuración → Citas antes de seguir", 422);

    const clientId = expediente.clientId ?? (await clientIdOfPatient(tenantModels, expediente.patientId));
    if (!clientId) return error("El paciente no tiene ficha de familia: sin ella no hay a quién cobrarle el diagnóstico", 422);

    const producto = productoDelExpediente({ tenant, expediente });
    const concepto = conceptoDelExpediente({ tenant, expediente, catalogo });
    // La entrevista ya cobrada (o debida) se descuenta del producto.
    const cobroEntrevista = await cobroDeEntrevistaDelExpediente(tenantModels, expediente, {
      textoEntrevista: cobroDeLaEntrevista(catalogo.conceptoEntrevista).texto,
    });
    const descuentoEuros = descuentoDeLaEntrevista(cobroEntrevista);
    const cobro = cobroDelProducto(producto, concepto, { descuentoEuros });
    const importeCentimos = centimosDe(cobro.importeEuros);

    const avisos = [];
    let huboCobro = false;
    let bono = null;

    // Un bono ya nacido para este expediente (reintento tras un corte): se adopta.
    try {
      bono = await SessionPack.findOne({ where: { diagnosticoId: expediente.id, status: "active" } });
    } catch (err) {
      if (!tablaAusente(err) && err?.parent?.code !== "42703") throw err;
    }

    if (bono) {
      avisos.push("El bono ya existía de un intento anterior: se ha enganchado al expediente en vez de crear otro.");
    } else {
      const ficha = Client ? await Client.findByPk(clientId, { attributes: ["id", "email", "portalEmail"] }) : null;
      const creador = await nombreDeQuienPide(request, tenantModels);
      ({ bono, cobro: huboCobro } = await crearBonoConSuCobro({
        tenantModels,
        clientId,
        clientEmail: normalizaCorreo(ficha?.portalEmail || ficha?.email),
        patientId: expediente.patientId,
        eventTypeId: tipo.id,
        nombreDelTipo: tipo.name,
        // SIN TOPE: las horas las acota el expediente (`cabeHora`).
        totalSessions: null,
        amount: importeCentimos,
        notes: `Diagnóstico: ${producto.nombre}`,
        creador,
        diagnosticoId: expediente.id,
        cobro: { conceptId: cobro.conceptId, texto: cobro.texto, invoiceText: textoEnFacturaDe(concepto) },
      }));
      if (!huboCobro) {
        avisos.push(
          cobro.importeEuros === 0 && cobro.descuentoEuros > 0
            ? `La entrevista ya cobrada (${cobro.descuentoEuros} €) cubre el precio de «${producto.nombre}»: el bono ha nacido sin cobro.`
            : `El bono ha nacido sin cobro: no hay precio para «${producto.nombre}» (ni concepto en el catálogo ni precio de caída).`
        );
      }
    }

    await expediente.update({
      packId: bono.id,
      conceptId: cobro.conceptId ?? expediente.conceptId ?? null,
      eventTypeId: expediente.eventTypeId ?? tipo.id,
      clientId,
      status: "en_curso",
    });

    await auditar({
      tenantId: tenant.id,
      ...datosPeticion(request),
      action: "diagnostico.seguido",
      entity: "Diagnostico",
      entityId: expediente.id,
      after: {
        ...resumen(expediente, ["id", "patientId", "clientId", "productoKey", "packId", "status"]),
        importe: cobro.importeEuros !== null ? String(cobro.importeEuros) : null,
        descuento: cobro.descuentoEuros > 0 ? String(cobro.descuentoEuros) : null,
        entrevistaPaymentId: cobroEntrevista?.id ?? null,
        cobro: huboCobro,
      },
    });

    const [fila] = await filasDe({ tenantModels, tenant, expedientes: [expediente], puedeDecidir, catalogo });
    return ok({
      expediente: fila,
      bono: { id: bono.id, sinTope: true },
      cobro: huboCobro ? { importe: cobro.importeEuros, descuento: cobro.descuentoEuros, status: "pending", texto: cobro.texto } : null,
      entrevista: resumenDeCobro(cobroEntrevista),
      avisos,
    });
  } catch (err) {
    if (tablaAusente(err)) return notFound("Ese diagnóstico no existe");
    return serverError(err);
  }
});
