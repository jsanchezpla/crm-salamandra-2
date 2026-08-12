/**
 * lib/citas/avisoAdmisionRota.js — que alguien se entere del 403.
 *
 * EL PROBLEMA
 * `estadoDeAdmision` devuelve `"sin_ficha"` cuando hay una solicitud ACEPTADA y
 * ninguna ficha detrás. Eso es una contradicción: la profesional ya dijo que sí
 * —y desde el 05/08 se le manda además un correo de «ya puedes pedir cita»— y
 * la agenda le responde 403.
 *
 * Y hasta hoy pasaba EN SILENCIO por los dos lados: la paciente ve un aviso que
 * la manda a rellenar otra vez el formulario que ya rellenó, y en el CRM no
 * queda rastro de nada. El único modo de descubrirlo era que la persona llamara
 * por teléfono a quejarse.
 *
 * QUÉ HACE
 * Deja un aviso en la campana de los admin del tenant con el nombre y el correo,
 * que es lo que hace falta para arreglarlo a mano desde la bandeja.
 *
 * ⚠️ `dedupe` sobre la SOLICITUD, no sobre el intento. Esto se dispara desde la
 * agenda pública, que es anónima: sin deduplicar, alguien que reintenta cinco
 * veces —o un bot con un correo conocido— llenaría la campana del centro. Con
 * el id de la solicitud como entidad, cada persona afectada genera UN aviso por
 * admin y punto, y el techo de avisos posibles es el número de aceptadas sin
 * ficha, que es un puñado.
 *
 * Best-effort de principio a fin, como el resto de la campana: esto avisa de un
 * fallo, y avisar de un fallo no puede provocar otro.
 *
 * La DECISIÓN («¿toca aviso, y con qué texto?») vive separada de la ENTREGA a
 * propósito: la primera es lo único propio de aquí y se prueba sola en
 * `scripts/_smoke-aviso-admision.mjs`; la segunda es `notifyAdmins`, que ya lo
 * hacen otros cinco sitios.
 */

import { Op } from "sequelize";

/** Tipo de la campana. Fuera de `AUTO_TYPES`: nadie lo sincroniza ni lo borra. */
export const TIPO_AVISO = "admision_sin_ficha";

/**
 * ¿Qué aviso toca para este estado? `null` si ninguno.
 *
 * Solo para `"sin_ficha"`: los demás estados son la puerta funcionando —quien
 * está pendiente o no ha mandado el formulario TIENE que encontrarse el aviso—
 * y notificarlos convertiría la campana en un registro de tráfico.
 */
export async function avisoQueToca({ tenantModels, estado, email }) {
  if (estado !== "sin_ficha") return null;

  const { FormSubmission } = tenantModels ?? {};
  if (!FormSubmission || !email) return null;

  // La aceptada más reciente: es la que la profesional recuerda haber aceptado.
  const solicitud = await FormSubmission.findOne({
    where: { email: { [Op.iLike]: email }, status: "accepted" },
    attributes: ["id", "name", "email", "acceptedAt"],
    order: [["acceptedAt", "DESC"]],
  });
  // Sin solicitud que señalar no hay nada accionable que contar, y sin entidad
  // el dedupe no protegería de la repetición.
  if (!solicitud) return null;

  const quien = solicitud.name || solicitud.email || "Una persona";
  return {
    type: TIPO_AVISO,
    title: "Alguien admitido no puede pedir cita",
    body: `${quien} (${solicitud.email}) tiene la solicitud aceptada pero no se encuentra su ficha, así que la agenda le está diciendo que no. Revísala en Leads Comerciales.`,
    entityType: "FormSubmission",
    entityId: solicitud.id,
    dedupe: true,
  };
}

/**
 * Avisa a los admin de que una persona admitida se ha topado con el 403.
 *
 * No se espera al resultado: quien llama sigue devolviendo su 403 igual.
 */
export function avisarAdmisionRota({ tenantId, tenantModels, estado, email }) {
  if (estado !== "sin_ficha") return;

  (async () => {
    try {
      const aviso = await avisoQueToca({ tenantModels, estado, email });
      if (!aviso) return;
      const { notifyAdmins } = await import("../notifications/notifyUsers.js");
      await notifyAdmins({ tenantId, tenantModels, ...aviso });
    } catch (err) {
      process.stderr.write(`[admision-rota] no se pudo avisar: ${err.message}\n`);
    }
  })();
}
