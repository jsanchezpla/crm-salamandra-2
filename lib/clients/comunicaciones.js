/**
 * comunicaciones — qué le puede escribir el centro a cada familia
 * (01/08/2026).
 *
 * (Fichero nuevo en /lib, regla #2: lo comparten el portal —donde la familia lo
 * marca—, el envío de correos y WhatsApp de las citas, y la ficha del cliente
 * en el CRM. La regla de «¿le puedo escribir por aquí?» tiene que estar en UN
 * sitio o acabará dando respuestas distintas según quién pregunte.)
 *
 * TRES CASILLAS, ni una más:
 *
 *   citasEmail     Avisos de cita por correo (confirmación, recordatorio,
 *                  cambios y cancelaciones).
 *   citasWhatsapp  Los mismos avisos por WhatsApp.
 *   novedades      Novedades y actividades del centro. Publicidad, vaya.
 *
 * ── DECISIONES ─────────────────────────────────────────────────────────────
 *
 * 1. **Vive en el CLIENTE, no en el paciente.** Quien recibe los mensajes es la
 *    familia, y el área privada es suya. Con dos hermanos en el centro el
 *    teléfono es uno: preguntarlo dos veces sería absurdo, y contestar distinto,
 *    irresoluble. Lo del NIÑO (imágenes) sigue en `patients.consents`.
 *
 * 2. **Publicidad separada de los avisos**, y la pantalla del portal se puede
 *    pasar con TODO desmarcado: si aceptar novedades fuera el peaje para entrar
 *    en tu área privada, ese consentimiento no valdría nada.
 *
 * 3. **Si desmarcan los dos canales, NO se les escribe. Punto.** (Criterio de
 *    Rodrigo, 01/08/2026.) Nada de colar «avisos imprescindibles» por correo
 *    saltándose la casilla: quien dice que no quiere correos no quiere correos.
 *    La familia sigue viendo sus citas —y sus cambios— entrando en el área
 *    privada, que es suya y no necesita permiso.
 *
 * 4. **Solo un NO explícito bloquea.** Mientras no contesten valen los valores
 *    por defecto (correo sí, WhatsApp no): si no, activar esto dejaría a todas
 *    las familias existentes sin confirmación de cita de un día para otro.
 *
 * Forma persistida en `clients.communication_prefs` (JSONB):
 *   { [canal]: { granted, at, ip, userAgent, by } }
 *   by ∈ "portal" (lo marcó la familia) | "equipo" (lo registró el centro)
 */

export const CANALES = ["citasEmail", "citasWhatsapp", "novedades"];

export const CANAL_LABEL = {
  citasEmail: "Avisos de mis citas por correo electrónico",
  citasWhatsapp: "Avisos de mis citas por WhatsApp",
  novedades: "Novedades y actividades del centro",
};

export const CANAL_AYUDA = {
  citasEmail: "Confirmaciones, recordatorios, cambios de hora y cancelaciones.",
  citasWhatsapp: "Los mismos avisos, al móvil. Sale del número del centro.",
  novedades: "Talleres, charlas y novedades. Nada que ver con tus citas.",
};

/** Por defecto: correo sí (es como se opera hoy), WhatsApp y publicidad no. */
export const POR_DEFECTO = { citasEmail: true, citasWhatsapp: false, novedades: false };

function entrada(v) {
  if (v == null) return null;
  if (typeof v === "boolean") return { granted: v, at: null, ip: null, userAgent: null, by: null };
  if (typeof v !== "object") return null;
  return {
    granted: !!v.granted,
    at: v.at ?? null,
    ip: v.ip ?? null,
    userAgent: v.userAgent ?? null,
    by: v.by ?? null,
  };
}

/** Preferencias completas de un cliente, rellenando los canales que falten. */
export function preferenciasDe(client) {
  const guardadas =
    client?.communicationPrefs && typeof client.communicationPrefs === "object" ? client.communicationPrefs : {};
  const salida = {};
  for (const canal of CANALES) {
    // `by: null` = nadie ha contestado todavía; es un valor por defecto, no una
    // respuesta. La UI lo distingue para no presumir un consentimiento.
    salida[canal] = entrada(guardadas[canal]) ?? {
      granted: POR_DEFECTO[canal],
      at: null,
      ip: null,
      userAgent: null,
      by: null,
    };
  }
  return salida;
}

/** ¿Ha contestado la familia alguna vez, o son los valores por defecto? */
export function yaRespondio(client) {
  const p = client?.communicationPrefs;
  return !!(p && typeof p === "object" && CANALES.some((c) => p[c] && typeof p[c] === "object" && p[c].by));
}

/**
 * Fusiona la respuesta sobre lo que había, sellando fecha/IP/navegador SOLO en
 * los canales cuyo valor cambia. Los que no vengan conservan su traza.
 */
export function normalizarPreferencias(input, { previas = {}, ip = null, userAgent = null, by = "portal", now } = {}) {
  const antes = previas && typeof previas === "object" ? previas : {};
  const cuando = now ?? new Date().toISOString();
  const salida = {};
  for (const canal of CANALES) {
    const anterior = entrada(antes[canal]);
    if (!(canal in (input ?? {}))) {
      if (anterior) salida[canal] = anterior;
      continue;
    }
    const nuevo = !!(typeof input[canal] === "object" ? input[canal]?.granted : input[canal]);
    if (anterior && anterior.granted === nuevo && anterior.by) {
      salida[canal] = anterior; // sin cambio real: no se re-sella la traza
      continue;
    }
    salida[canal] = {
      granted: nuevo,
      at: cuando,
      ip: ip ? String(ip).slice(0, 64) : null,
      userAgent: userAgent ? String(userAgent).slice(0, 255) : null,
      by,
    };
  }
  return salida;
}

/** ¿Se le puede escribir por este canal? Sin excepciones ni puertas traseras. */
export function puedeAvisar(client, canal) {
  return !!preferenciasDe(client)[canal]?.granted;
}

/**
 * Lo mismo, partiendo de una CITA. Resuelve la familia por `clientId` y, si la
 * cita no lo tiene (reservas viejas, públicas de alguien que aún no es
 * cliente), por el correo con el que reservó.
 *
 * Sin ficha de cliente devuelve el valor por defecto del canal: una reserva
 * pública tiene que poder recibir su confirmación, o el flujo se rompe en
 * silencio para quien todavía no es cliente de nadie.
 */
export async function citaPuedeAvisar(tenantModels, booking, canal) {
  try {
    const { Client } = tenantModels ?? {};
    if (!Client) return POR_DEFECTO[canal] ?? false;

    let cliente = null;
    if (booking?.clientId) {
      cliente = await Client.findByPk(booking.clientId, { attributes: ["id", "communicationPrefs"] });
    }
    if (!cliente && booking?.clientEmail) {
      cliente = await Client.findOne({
        where: { email: booking.clientEmail },
        attributes: ["id", "communicationPrefs"],
      });
    }
    if (!cliente) return POR_DEFECTO[canal] ?? false;
    return puedeAvisar(cliente, canal);
  } catch {
    // Si no se puede comprobar, se aplica el valor por defecto del canal: para
    // el correo eso es seguir avisando (no dejar a nadie sin su cita por un
    // fallo de lectura) y para WhatsApp, callarse.
    return POR_DEFECTO[canal] ?? false;
  }
}
