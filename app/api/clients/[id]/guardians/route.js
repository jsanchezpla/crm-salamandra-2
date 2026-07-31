import { withTenant } from "../../../../../lib/tenant/withTenant.js";
import { ok, error, forbidden, notFound, serverError } from "../../../../../lib/utils/apiResponse.js";
import { auditar, datosPeticion } from "../../../../../lib/utils/auditoria.js";
import {
  normalizeGuardians,
  signersOf,
  contractFullySigned,
  GUARDIAN_RELATIONSHIPS,
} from "../../../../../lib/clients/guardians.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * /api/clients/[id]/guardians — padres y tutores de una familia
 * (sprint 2026-07-29, punto 1.2).
 *
 *   GET → tutores + estado de firma del contrato de cada uno
 *   PUT → reemplaza la lista { guardians: [...] }
 *
 * POR QUÉ VIVEN DENTRO DEL CLIENTE Y NO COMO DOS CLIENTES: con padres
 * separados hay dos personas, pero UNA familia y UN paciente. Partirlo en dos
 * fichas obligaría a decidir de quién es cada factura, duplicaría el histórico
 * y bifurcaría el desbloqueo mensual del portal. Cada tutor tiene su email, su
 * teléfono y su firma; el dinero y el expediente siguen siendo de la familia.
 *
 * El acceso al portal NO se crea aquí: es por EMAIL (el SSO de WordPress firma
 * el correo del que entra) y lo resuelve lib/citas/portalClient.js, que busca
 * tanto en `clients.email` como entre los tutores. Poner el email de un tutor
 * es, literalmente, darle acceso.
 */

function gate(ctx) {
  if (!ctx.hasModule("clients")) return forbidden("Módulo clients no activo");
  return null;
}

export const GET = withTenant(async (_request, rc, ctx) => {
  try {
    const veto = gate(ctx);
    if (veto) return veto;
    const { id } = await rc.params;
    if (!UUID_RE.test(id)) return error("id inválido");

    const { Client, ContractSignature } = ctx.tenantModels;
    const cliente = await Client.findByPk(id, { attributes: ["id", "name", "guardians"] });
    if (!cliente) return notFound("Cliente no encontrado");

    const guardians = Array.isArray(cliente.guardians) ? cliente.guardians : [];
    const firmas = ContractSignature
      ? await ContractSignature.findAll({ where: { clientId: id }, attributes: ["guardianId", "signerName", "signedAt"] })
      : [];
    const porTutor = new Map(firmas.map((f) => [String(f.guardianId).toLowerCase(), f]));

    return ok({
      clientId: id,
      relaciones: GUARDIAN_RELATIONSHIPS,
      guardians: guardians.map((g) => {
        const f = porTutor.get(String(g.id).toLowerCase()) ?? null;
        return { ...g, firmadoEl: f?.signedAt ?? null, firmadoPor: f?.signerName ?? null };
      }),
      // Cuántas firmas faltan para abrir la documentación del portal. Con
      // padres separados son DOS: el contrato no se da por firmado hasta que
      // firman todos los que deben.
      firmantes: signersOf(guardians).length,
      contratoCompleto: contractFullySigned(guardians, firmas),
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
    if (!UUID_RE.test(id)) return error("id inválido");

    const { Client } = ctx.tenantModels;
    const cliente = await Client.findByPk(id);
    if (!cliente) return notFound("Cliente no encontrado");

    let body;
    try { body = await request.json(); } catch { return error("Body inválido"); }
    if (!Array.isArray(body.guardians)) return error("Se requiere guardians: [...]", 422);

    const guardians = normalizeGuardians(body.guardians);
    if (guardians.length > 6) return error("Demasiados tutores (máximo 6)", 422);

    // Dos tutores con el mismo correo romperían el acceso al portal: los dos
    // resolverían a la misma persona y no se sabría de quién es cada firma.
    const correos = guardians.map((g) => (g.email ?? "").toLowerCase()).filter(Boolean);
    if (new Set(correos).size !== correos.length) {
      return error("Hay dos tutores con el mismo correo. Cada uno necesita el suyo para entrar al portal.", 422);
    }

    const antes = (Array.isArray(cliente.guardians) ? cliente.guardians : []).length;
    await cliente.update({ guardians });

    await auditar({
      tenantId: ctx.tenant.id,
      ...datosPeticion(request),
      action: "client.guardians.updated",
      entity: "Client",
      entityId: id,
      // Solo el recuento y quién firma: nombres, DNI y teléfonos de los padres
      // son datos personales y la auditoría vive en master, compartida.
      before: { tutores: antes },
      after: { tutores: guardians.length, firmantes: signersOf(guardians).length },
    });

    return ok({ guardians });
  } catch (err) {
    return serverError(err);
  }
});
