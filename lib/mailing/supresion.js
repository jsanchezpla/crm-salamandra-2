import { normalizarEmail } from "./bajaToken.js";

/**
 * lib/mailing/supresion.js — meter una dirección en la lista de la que no
 * sale nadie, y dejar el resto del módulo coherente con ello.
 *
 * (Fichero nuevo en /lib, regla #2: lo llaman la baja pública de un clic, el
 * webhook de rebotes y quejas de AWS y el alta a mano desde el CRM. Tres
 * puertas, una regla: si una de ellas se olvidara de marcar el contacto como
 * `baja`, la lista seguiría enseñando «activo» a alguien que ya no lo está.)
 *
 * Qué hace, en este orden y todo best-effort salvo la supresión en sí:
 *   1. Inserta en `mailing_suppressions` (si ya estaba, no toca el motivo:
 *      el primero manda, y una queja no se degrada a «baja»).
 *   2. Si el correo es un contacto suelto, lo pasa a `baja`.
 *   3. Si el correo es de una ficha de cliente, le quita la casilla de
 *      novedades con la traza `by: "baja"` (lib/clients/comunicaciones.js),
 *      para que la ficha diga la verdad y el equipo vea que fue la persona.
 *   4. Marca los envíos pendientes de esa dirección como `suprimido`.
 */
export async function suprimirEmail(ctx, { email, motivo, detalle = null, campaignId = null, ip = null, userAgent = null }) {
  const correo = normalizarEmail(email);
  if (!correo || !correo.includes("@")) return { nueva: false, fila: null };
  const { MailingSuppression, MailingContact, MailingSend, Client } = ctx.tenantModels;

  const [fila, nueva] = await MailingSuppression.findOrCreate({
    where: { email: correo },
    defaults: { email: correo, motivo, detalle, campaignId },
  });

  try {
    await MailingContact.update({ estado: "baja" }, { where: { email: correo } });
  } catch {
    /* sin contacto suelto */
  }

  if (Client && (ctx.tenantHasModule?.("clients") ?? true)) {
    try {
      const fichas = await Client.findAll({ where: { email: correo }, attributes: ["id", "communicationPrefs"] });
      for (const ficha of fichas) {
        const previas = ficha.communicationPrefs && typeof ficha.communicationPrefs === "object" ? ficha.communicationPrefs : {};
        const novedades = previas.novedades && typeof previas.novedades === "object" ? previas.novedades : {};
        if (novedades.granted === false && novedades.by) continue; // ya decía que no
        await Client.update(
          {
            communicationPrefs: {
              ...previas,
              novedades: {
                granted: false,
                at: new Date().toISOString(),
                ip: ip ? String(ip).slice(0, 64) : null,
                userAgent: userAgent ? String(userAgent).slice(0, 255) : null,
                by: motivo === "baja" ? "baja" : "mailing",
              },
            },
          },
          { where: { id: ficha.id } }
        );
      }
    } catch {
      /* sin tabla de clientes, o sin permiso: la supresión ya está puesta */
    }
  }

  try {
    await MailingSend.update({ estado: "suprimido", error: `supresión (${motivo})` }, { where: { email: correo, estado: "pendiente" } });
  } catch {
    /* nada pendiente */
  }

  return { nueva, fila };
}
