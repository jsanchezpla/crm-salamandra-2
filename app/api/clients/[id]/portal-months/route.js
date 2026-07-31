import { Op } from "sequelize";
import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, serverError } from "../../../../../lib/utils/apiResponse.js";
import { auditar, datosPeticion } from "../../../../../lib/utils/auditoria.js";
import { bloqueoImpagoActivo, mesesAbiertos, mesesManuales, mesDe } from "../../../../../lib/citas/portalMeses.js";

/**
 * /api/clients/[id]/portal-months — qué meses tiene abiertos una familia en su
 * área privada (sprint Aumenta 2026-07, punto 2.3).
 *
 *   GET → últimos meses con su estado: cobrado, abierto a mano, y cuántos
 *         documentos hay retenidos en cada uno.
 *   PUT → abre o cierra un mes A MANO ({ mes: 'YYYY-MM', abierto: bool }).
 *
 * El desbloqueo NORMAL es automático: al registrar el cobro del mes, sus
 * documentos se abren solos. Esto es la excepción con nombre: becas, acuerdos
 * de pago, o un cobro que entró por fuera del CRM. Por eso se audita.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const MESES_VISTA = 6;

function gate(ctx) {
  return ctx.hasModule("clients") ? null : forbidden("Módulo clients no activo");
}

const tablaAusente = (err) => err?.parent?.code === "42P01" || err?.original?.code === "42P01";

/** Los últimos N meses, del más reciente al más antiguo. */
function ultimosMeses(n) {
  const hoy = new Date();
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
}

export const GET = withTenant(async (_request, rc, ctx) => {
  try {
    const veto = gate(ctx);
    if (veto) return veto;
    const { id } = await rc.params;
    if (!UUID_RE.test(id)) return error("id inválido", 422);

    const { Client, Document } = ctx.tenantModels;
    const cliente = await Client.findByPk(id, { attributes: ["id", "portalUnlockedMonths"] });
    if (!cliente) return notFound("Cliente no encontrado");

    const abiertos = await mesesAbiertos(ctx.tenantModels, cliente);
    const manuales = new Set(mesesManuales(cliente));

    // Documentos compartidos por el equipo (los que sube la familia no se
    // bloquean nunca, así que no se cuentan aquí).
    const porMes = new Map();
    if (Document) {
      try {
        const docs = await Document.findAll({
          where: {
            clientId: id,
            source: { [Op.in]: ["ficha", "informe"] },
            clientVisible: true,
            uploadedByClient: false,
          },
          attributes: ["id", "createdAt"],
          limit: 500,
        });
        for (const d of docs) {
          const m = mesDe(d.createdAt);
          if (m) porMes.set(m, (porMes.get(m) ?? 0) + 1);
        }
      } catch (err) {
        if (!tablaAusente(err)) throw err;
      }
    }

    // Los últimos meses SIEMPRE, más cualquier mes antiguo que tenga
    // documentos: si no, un informe de hace un año quedaría retenido sin que
    // nadie pudiera verlo en esta pantalla para abrirlo.
    const meses = [...new Set([...ultimosMeses(MESES_VISTA), ...porMes.keys()])].sort((a, b) => b.localeCompare(a));

    return ok({
      clientId: id,
      activo: bloqueoImpagoActivo(ctx.tenant),
      meses: meses.map((mes) => ({
        mes,
        abierto: abiertos.has(mes),
        manual: manuales.has(mes),
        // Cobrado = abierto sin haberlo tocado a mano.
        cobrado: abiertos.has(mes) && !manuales.has(mes),
        documentos: porMes.get(mes) ?? 0,
      })),
    });
  } catch (err) {
    return serverError(err);
  }
});

export const PUT = withTenant(async (request, rc, ctx) => {
  try {
    const veto = gate(ctx);
    if (veto) return veto;
    const { id } = await rc.params;
    if (!UUID_RE.test(id)) return error("id inválido", 422);

    const { Client } = ctx.tenantModels;
    const cliente = await Client.findByPk(id);
    if (!cliente) return notFound("Cliente no encontrado");

    let body;
    try {
      body = await request.json();
    } catch {
      return error("Body inválido", 400);
    }
    const mes = String(body?.mes ?? "").slice(0, 7);
    if (!MES_RE.test(mes)) return error("Mes inválido: se espera 'AAAA-MM'", 422);
    const abrir = body?.abierto !== false;

    const actuales = new Set(mesesManuales(cliente));
    if (abrir) actuales.add(mes);
    else actuales.delete(mes);
    const portalUnlockedMonths = [...actuales].sort();
    await cliente.update({ portalUnlockedMonths });

    await auditar({
      tenantId: ctx.tenant.id,
      ...datosPeticion(request),
      action: abrir ? "client.portal.month_unlocked" : "client.portal.month_locked",
      entity: "Client",
      entityId: id,
      after: { mes },
    });

    return ok({ clientId: id, portalUnlockedMonths });
  } catch (err) {
    return serverError(err);
  }
});
