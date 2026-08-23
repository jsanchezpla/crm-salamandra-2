/**
 * lib/whatsapp/plantillas.js — las plantillas de WhatsApp, en un solo sitio.
 *
 * (Fichero nuevo en /lib, regla #2: `whatsappConfig.js` sabe MANDAR y no tiene
 * por qué saber qué dice cada aviso; `avisosWhatsapp.js` sabe CUÁNDO avisar y
 * no tiene por qué saber cómo se redacta una plantilla de Meta. Esto es el
 * catálogo, y es lo que hay que mirar para darlas de alta en WhatsApp Manager.)
 *
 * ── POR QUÉ HAY PLANTILLAS Y NO TEXTO LIBRE ──────────────────────────────────
 * Meta solo deja mandar texto libre DENTRO de las 24 h siguientes al último
 * mensaje del paciente. Un recordatorio de la víspera lo iniciamos nosotros, así
 * que fuera de esa ventana el envío se rechaza con el error 131047 y el aviso no
 * sale. Las plantillas aprobadas se pueden mandar siempre, y por eso los tres
 * avisos de cita van por aquí y no por `enviarWhatsapp`.
 *
 * ── LAS REGLAS DE META CONDICIONAN LA REDACCIÓN ──────────────────────────────
 * No son manías nuestras; una plantilla que las incumpla se rechaza en revisión:
 *
 *   · El cuerpo NO puede TERMINAR en una variable. De ahí que todos los textos
 *     lleven una coletilla fija al final. No sobra: es lo que los hace válidos.
 *   · Dos variables no pueden ir seguidas ({{1}} {{2}}) sin texto entre medias.
 *   · Un parámetro NO puede ir vacío, ni llevar saltos de línea, tabuladores ni
 *     cuatro espacios seguidos. Por eso `parametros()` limpia y pone un relleno
 *     antes de mandar: un hueco vacío no es un aviso feo, es un envío rechazado.
 *   · La numeración es POSICIONAL: {{1}} es el primer elemento de la lista.
 *
 * ── QUIÉN DA DE ALTA ESTAS PLANTILLAS ────────────────────────────────────────
 * Hoy, el cliente en su WhatsApp Manager (BYOK: su cuenta, sus plantillas), con
 * EXACTAMENTE el `nombre`, el `idioma` y el `cuerpo` de aquí. Cuando estemos
 * como Tech Provider podremos crearlas nosotros por API sobre su cuenta con el
 * permiso `whatsapp_business_management`, y este catálogo pasará a ser la
 * fuente de ese alta automática. Por eso el texto vive aquí y no en un doc.
 */

/** Un parámetro válido para Meta: sin saltos, sin espacios de más, nunca vacío. */
export function limpiarParametro(valor, relleno = "-") {
  const limpio = String(valor ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  // El límite duro de Meta por parámetro es amplio; 300 sobra para un nombre o
  // una fecha y evita mandar un campo corrupto de miles de caracteres.
  return (limpio || relleno).slice(0, 300);
}

/**
 * Las tres plantillas de Citas.
 *
 * `variables` documenta qué significa cada posición — se lee al darlas de alta
 * y al depurar por qué un aviso salió raro.
 */
export const PLANTILLAS_CITA = {
  confirmada: {
    nombre: "cita_confirmada",
    idioma: "es",
    cuerpo:
      "Hola {{1}}, tu cita de {{2}} en {{3}} queda confirmada para el {{4}}. " +
      "{{5}} Si necesitas cambiarla, contesta a este mensaje.",
    variables: ["nombre", "servicio", "centro", "cuándo", "enlace o dónde"],
  },

  enlace: {
    nombre: "cita_enlace",
    idioma: "es",
    cuerpo:
      "Hola {{1}}, aquí tienes el enlace para tu cita de {{2}} en {{3}} del {{4}}: " +
      "{{5}} Nos vemos allí.",
    variables: ["nombre", "servicio", "centro", "cuándo", "enlace"],
  },

  recordatorio: {
    nombre: "cita_recordatorio",
    idioma: "es",
    cuerpo:
      "Recordatorio: mañana tienes tu cita de {{1}} en {{2}}, el {{3}}. " +
      "{{4}} Si no puedes acudir, avísanos con antelación.",
    variables: ["servicio", "centro", "cuándo", "enlace o dónde"],
  },
};

/** El nombre de pila, que es como se saluda por WhatsApp. */
function nombreDePila(nombreCompleto) {
  const n = String(nombreCompleto ?? "").trim();
  return n ? n.split(/\s+/)[0] : "";
}

/**
 * De una cita a la lista ORDENADA de parámetros de su plantilla.
 *
 * El quinto hueco de `confirmada` y el cuarto de `recordatorio` son "enlace o
 * dónde": con videollamada va el enlace, y sin ella una frase corta. Nunca se
 * queda vacío, porque un parámetro vacío hace que Meta rechace el envío entero
 * — que es exactamente el aviso que la persona no recibiría.
 */
export function parametrosCita(tipo, { tenantName, booking, eventTypeName, cuando }) {
  const nombre = nombreDePila(booking?.clientName) || "buenas";
  const servicio = eventTypeName || "consulta";
  const centro = tenantName || "el centro";
  const enlaceODonde = booking?.meetUrl
    ? `Enlace de la videollamada: ${booking.meetUrl}`
    : "Te esperamos en la consulta.";

  let crudos;
  switch (tipo) {
    case "confirmada":
      crudos = [nombre, servicio, centro, cuando, enlaceODonde];
      break;
    case "enlace":
      // Este aviso solo se manda cuando HAY enlace, así que va el enlace a secas.
      crudos = [nombre, servicio, centro, cuando, booking?.meetUrl];
      break;
    case "recordatorio":
      crudos = [servicio, centro, cuando, enlaceODonde];
      break;
    default:
      return null;
  }
  return crudos.map((v) => limpiarParametro(v));
}

/** El texto ya montado, para poder guardarlo en el hilo y verlo en el CRM. */
export function textoDeLaPlantilla(plantilla, parametros) {
  return String(plantilla?.cuerpo ?? "").replace(/\{\{(\d+)\}\}/g, (_, n) => parametros[Number(n) - 1] ?? "");
}
