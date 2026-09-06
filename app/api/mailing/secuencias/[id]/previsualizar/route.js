import { withTenant } from "../../../../../../lib/tenant/withTenant.js";
import { ok } from "../../../../../../lib/utils/apiResponse.js";
import { buscarOFallar, exigirMailing, idDeRuta } from "../../../../../../lib/mailing/comun.js";
import { candidatosDeSecuencia, horaMadrid } from "../../../../../../lib/mailing/secuencias.js";

/**
 * GET /api/mailing/secuencias/[id]/previsualizar — a quién le tocaría HOY con
 * la configuración guardada (mismo cálculo que el temporizador, sin la hora ni
 * lo ya enviado). Para que quien la enciende vea qué va a pasar.
 */
export const GET = withTenant(async (_request, rc, ctx) => {
  exigirMailing(ctx);
  const id = await idDeRuta(rc);
  const seq = await buscarOFallar(ctx.tenantModels.MailingSequence, id, "Esa secuencia");
  const ahora = new Date();
  // Para la vista previa de una secuencia APAGADA se simula que se enciende
  // ahora mismo: es lo que pasaría al pulsar el interruptor.
  const simulada = { ...seq.toJSON(), activadaDesde: seq.activa ? seq.activadaDesde : ahora };
  const candidatos = await candidatosDeSecuencia(ctx, simulada, { ahora });
  return ok({
    hoy: candidatos.length,
    muestra: candidatos.slice(0, 8).map((d) => ({ email: d.email, nombre: d.nombre })),
    horaActual: horaMadrid(ahora),
    saldriaHoy: horaMadrid(ahora) >= (Number(seq.hora) || 0),
  });
});
