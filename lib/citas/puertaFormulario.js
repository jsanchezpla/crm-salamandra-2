/**
 * Puerta de admisión: quién puede reservar cita.
 *
 * Nace de nutri_laura (03/08/2026). Su web manda a la gente al formulario de
 * las siete preguntas, ella lo revisa en la bandeja y acepta o descarta. Pero
 * la agenda pública NO miraba nada de eso: cualquiera con el enlace del widget
 * reservaba, hubiera pasado por el formulario o no. Con retención de tarjeta de
 * por medio eso es peor todavía, porque se le bloquea dinero a alguien que la
 * profesional no ha admitido.
 *
 * Regla, decidida por el usuario: **se aplica a todos** —también a los
 * pacientes de antes, que ya están avisados— y **a todos los tipos de cita**.
 * Y no es una puerta cerrada: a quien no ha pasado por el formulario se le
 * enseña el aviso con el enlace, no un "no".
 *
 * Apagada por defecto. Se enciende por tenant en Configuración → Citas, y solo
 * tiene efecto si el tenant tiene el módulo `formularios`: sin bandeja donde
 * aceptar a nadie, la puerta dejaría fuera al 100% de la gente.
 *
 * ── UNA EXCEPCIÓN: LOS PROFESIONALES (12/08/2026, decisión de Rodrigo) ───────
 * «Una persona registrada como profesional no tiene que hacer el formulario, con
 * haber hecho su formulario profesional le vale. Un paciente que entra por el
 * formulario comercial sí que tiene que hacerlo sí o sí.»
 *
 * Son dos puertas de entrada distintas y hasta hoy solo se miraba una. Quien
 * viene marcado como `profesional_salud` —un nutricionista que trae un caso—
 * llegó por el formulario de profesionales de la web, que es OTRO formulario y
 * no cae en la bandeja del módulo Formularios: la puerta le pedía uno que no le
 * toca, y encima el único tipo de cita que puede reservar (Supervisión
 * profesional) ya está reservado a esa misma marca.
 *
 * Por eso la excepción se cuelga de la MARCA de la ficha y no de un ajuste
 * nuevo: es la misma llave que abre los tipos de cita de profesionales
 * (`lib/citas/tiposVisibles.js`), puesta por el mismo sitio. La puerta sigue
 * cerrada, en global y para todos los tipos, para todo el que sea paciente.
 */

import { Op } from "sequelize";
import { resolvePortalClient } from "./portalClient.js";
import { esProfesionalDeLaSalud } from "../clients/moduleAssignments.js";

/** ¿Este tenant exige formulario aceptado para reservar? */
export function exigeFormularioAceptado(tenant) {
  return tenant?.settings?.citas?.formularioObligatorio === true;
}

/** Enlace al formulario público (vive en la web del cliente, no en el CRM). */
export function urlDelFormulario(tenant) {
  const url = tenant?.settings?.citas?.formularioUrl;
  return typeof url === "string" && url.trim() ? url.trim() : null;
}

/**
 * Cuántas veces puede volver a mandar el formulario quien ha sido descartado
 * (Rodrigo, 12/08/2026). Descartar no es una puerta cerrada —las circunstancias
 * de alguien cambian, y el primer formulario puede estar mal rellenado— pero a
 * la cuarta, seguir ofreciéndole el mismo enlace es mandarle a repetir algo que
 * ya no va a cambiar solo. A partir de ahí se le dice, y se le da un correo.
 */
export const RECHAZOS_ANTES_DE_CERRAR = 3;

/**
 * A dónde escribe quien ya no puede seguir por la agenda.
 *
 * SOLO del tenant, y sin el respaldo por variable de entorno que usa
 * `getTenantResendConfig`: ese respaldo es NUESTRA dirección de Outreach, y
 * mandar a una paciente de Laura a escribirnos a nosotros sería peor que no
 * darle ninguna. Sin correo del cliente, el mensaje se queda sin dirección.
 */
export function emailDeContacto(tenant) {
  const integ = tenant?.settings?.integrations ?? {};
  for (const candidato of [integ.resendReplyTo, integ.resendFromEmail]) {
    if (typeof candidato === "string" && candidato.trim()) return candidato.trim();
  }
  return null;
}

/**
 * La web del cliente, para el botón «Volver» de la pantalla que corta.
 *
 * Se saca del ORIGEN de las direcciones que el cliente ya tiene puestas en
 * Configuración → Citas, en vez de pedir un ajuste nuevo que nadie rellenaría:
 * `https://tunutrilaura.com/mi-perfil/` → `https://tunutrilaura.com`. El widget
 * vive en un iframe dentro de esa misma web, así que es el sitio del que viene.
 */
export function urlDeLaWeb(tenant) {
  const candidatos = [
    tenant?.settings?.citas?.portalUrl,
    tenant?.settings?.citas?.reservaUrl,
    tenant?.settings?.citas?.formularioUrl,
    tenant?.settings?.widget?.auth?.loginUrl,
  ];
  for (const url of candidatos) {
    if (typeof url !== "string" || !url.trim()) continue;
    try {
      return new URL(url.trim()).origin;
    } catch {
      // Dirección torcida en los ajustes: se prueba la siguiente.
    }
  }
  return null;
}

/** La fecha más reciente de `campo` en esas filas, o null si ninguna la trae. */
function ultimaFecha(filas, campo) {
  let max = null;
  for (const fila of filas) {
    const t = fila?.[campo] ? new Date(fila[campo]).getTime() : NaN;
    if (Number.isFinite(t) && (max === null || t > max)) max = t;
  }
  return max;
}

/**
 * ¿Le descartaron DESPUÉS de haberle admitido?
 *
 * ⚠️ Solo se responde que sí cuando se pueden comparar las dos fechas. Si a
 * alguna le falta la suya, se deja mandar a la aceptada como toda la vida: es
 * una regla que CIERRA la puerta, y aplicarla a ciegas sobre una fila vieja sin
 * fechar echaría a un paciente de verdad por un dato que no tenemos.
 */
function descartadaDespuesDeAdmitir(aceptadas, rechazadas) {
  const admitida = ultimaFecha(aceptadas, "acceptedAt");
  const descarte = ultimaFecha(rechazadas, "rejectedAt");
  if (admitida === null || descarte === null) return false;
  return descarte > admitida;
}

/**
 * La ficha de quien ya fue admitido, por los DOS caminos por los que puede
 * estar enlazada. Devuelve la primera que exista, o `null`.
 *
 *   1. El correo — con el mismo buscador que usa el resto del portal, así que
 *      una madre que entra con su correo de tutora cuenta como ficha de la
 *      familia.
 *   2. El enlace que escribió la propia aceptación (`client_id`), para las
 *      fichas que se reutilizaron por teléfono y llevan otro correo.
 *
 * Nunca lanza: un fallo al mirar el segundo camino deja el resultado del
 * primero, que es el comportamiento que había antes de existir este.
 */
async function fichaDeQuienFueAdmitido(tenantModels, email, aceptadas) {
  const porCorreo = await resolvePortalClient(tenantModels, email);
  if (porCorreo) return porCorreo;

  const Client = tenantModels?.Client;
  if (!Client?.findByPk) return null;

  // Solo `id`: aquí lo único que se pregunta es si la fila sigue estando. Al
  // contrario que en `portalClient.js`, de esta ficha no se lee ningún campo,
  // así que la lista corta no puede mentir en silencio.
  const vistos = new Set();
  for (const solicitud of aceptadas) {
    const id = solicitud?.clientId;
    if (!id || vistos.has(id)) continue;
    vistos.add(id);
    try {
      const ficha = await Client.findByPk(id, { attributes: ["id"] });
      if (ficha) return ficha;
    } catch {
      // Id torcido o tabla ausente: se sigue con el resto.
    }
  }
  return null;
}

/**
 * ¿A este correo le corresponde saltarse la puerta por ser profesional?
 *
 * La marca vive en la FICHA (`client_module_assignments`), así que hay que
 * resolverla desde el correo, igual que hace el listado de tipos de cita. A un
 * correo sin ficha se le responde que no, que es el lado que cierra.
 *
 * Nunca lanza: si algo falla se responde «no es profesional» y la persona cae en
 * la puerta normal. Dejar pasar por un error de lectura sería vaciar la única
 * defensa que hay.
 */
export async function esProfesionalExento(tenantModels, email) {
  if (!email) return false;
  try {
    const ficha = await resolvePortalClient(tenantModels, email);
    if (!ficha?.id) return false;
    return await esProfesionalDeLaSalud(tenantModels, ficha.id);
  } catch {
    return false;
  }
}

/**
 * ¿Con este estado se puede reservar?
 *
 * Los dos sitios que cortan y el que anuncia preguntan lo mismo, y antes cada
 * uno lo escribía a mano (`estado === "aceptada"`). Con la excepción de los
 * profesionales pasan a ser dos estados, y tres copias de esa condición es como
 * se llega a que el portal diga que sí y `/book` responda 403.
 */
export function admitido(estado) {
  return estado === "aceptada" || estado === "profesional";
}

/**
 * Estado de admisión de un email.
 *
 * Devuelve uno de:
 *   "profesional" — viene marcado como profesional de la salud: exento
 *   "aceptada"    — tiene solicitud aceptada Y ficha: puede reservar
 *   "pendiente"   — la mandó y está en la bandeja, sin revisar
 *   "descartada"  — la mandó y no se aceptó
 *   "sin_ficha"   — la aceptaron en su día, pero su ficha ya no está
 *   "sin_enviar"  — no hay ninguna solicitud con ese email
 *   "sin_bandeja" — no se pudo mirar (tabla ausente, BD caída): se cierra
 *
 * Se mira SOLO por email porque es lo único que compartimos entre el
 * formulario y la reserva. Con `iLike` porque el formulario guarda lo que la
 * persona teclee y nadie escribe su correo dos veces igual.
 *
 * ── HACE FALTA FICHA, NO SOLO SOLICITUD (06/08/2026, Rodrigo) ───────────────
 * «Si elimino a un paciente, debería volver al paso cero». Y tenía razón: la
 * solicitud aceptada sobrevive al borrado de la ficha (la FK se queda a NULL),
 * así que quien acababa de ser dado de baja seguía entrando a su área privada,
 * seguía pudiendo pedir cita y seguía viendo un perfil de una consulta en la
 * que ya no está.
 *
 * Aceptar una solicitud SIEMPRE crea la ficha —el propio endpoint de la bandeja
 * lo dice y prohíbe devolver una aceptada a pendiente por eso mismo—, así que
 * «aceptada sin ficha» solo puede significar una cosa: la borraron. La ficha es
 * la prueba de ser paciente; la solicitud solo es la puerta por la que se entró.
 *
 * La comprobación solo DEGRADA el "aceptada": si además hay una solicitud nueva
 * esperando, manda esa y se le dice «en revisión». Si no, vuelve al paso cero y
 * se le ofrece el formulario. Nunca al revés: sin solicitud no se entra por
 * tener ficha.
 *
 * ── LA FICHA NO SIEMPRE LLEVA EL MISMO CORREO (12/08/2026) ──────────────────
 * Buscar la ficha SOLO por el correo dejó fuera a gente que sí la tenía. Al
 * aceptar una solicitud no siempre se crea una ficha nueva: `buscarClienteExistente`
 * reutiliza la que ya haya, y la busca por correo **o por TELÉFONO**. Cuando entra
 * por teléfono —la misma familia que ya estaba en el CRM, apuntada en su día con
 * otra dirección—, la ficha queda enlazada a una solicitud cuyo correo no es el
 * suyo. La persona es paciente, tiene ficha, recibió el «ya puedes pedir cita»…
 * y la agenda le respondía 403 sin decírselo a nadie.
 *
 * Por eso hay un segundo camino: `form_submissions.client_id`, que es el enlace
 * que dejó escrito la PROPIA aceptación (y su guard de idempotencia). Es mejor
 * prueba que el correo, porque no depende de que dos campos de texto coincidan.
 *
 * ⚠️ Se resuelve con un `findByPk`, no mirando si la columna trae algo: **esa
 * columna no tiene FK**, así que borrar una ficha NO la pone a NULL —deja el id
 * colgando, apuntando a una fila que ya no existe—. Al buscarla, una ficha
 * borrada devuelve `null` y la persona vuelve al paso cero, que es justo lo que
 * el bloque de arriba quiere. Los dos caminos se refuerzan; ninguno abre la
 * puerta a quien no tiene ficha.
 */
export async function estadoDeAdmision(tenantModels, email) {
  const FormSubmission = tenantModels?.FormSubmission;
  if (!FormSubmission || !email) return "sin_enviar";

  // Los profesionales, antes que nada: su formulario es otro y no está en esta
  // bandeja, así que buscarlos aquí solo puede dar «no ha mandado nada». Va
  // incluso por delante del "sin_bandeja" —la excepción no depende de poder leer
  // la bandeja— pero nunca por delante de la propia marca, que sí hay que poder
  // leer: si falla, se sigue por la puerta normal.
  if (await esProfesionalExento(tenantModels, email)) return "profesional";

  let suyas;
  try {
    suyas = await FormSubmission.findAll({
      where: { email: { [Op.iLike]: email } },
      attributes: ["status", "clientId", "acceptedAt", "rejectedAt"],
      limit: 50,
    });
  } catch (err) {
    // Tener el módulo NO garantiza tener la tabla: el schema de nutri_laura en
    // local tiene `formularios` activo y `form_submissions` sin crear. Sin este
    // try la agenda pública devolvería un 500 a cada persona que intente pedir
    // cita, que es la peor de las tres salidas posibles.
    //
    // Se cierra, no se abre: quien enciende la puerta quiere filtrar, y dejar
    // pasar a todo el mundo en silencio vacía la única defensa que había. El
    // comprobador previo (scripts/comprobar-citas.js) avisa de esto ANTES de
    // que le pase a nadie.
    process.stderr.write(`[puerta-formulario] no se pudo consultar la bandeja: ${err.message}\n`);
    return "sin_bandeja";
  }

  if (!suyas.length) return "sin_enviar";

  const hayPendiente = suyas.some((s) => s.status === "pending");
  const aceptadas = suyas.filter((s) => s.status === "accepted");
  const rechazadas = suyas.filter((s) => s.status === "rejected");

  // Una aceptada manda sobre el resto: quien fue admitido y luego mandó otra
  // solicitud sin revisar sigue siendo paciente, no vuelve a la cola.
  //
  // ── PERO NO SOBRE UN DESCARTE POSTERIOR (12/08/2026) ──────────────────────
  // «Manda la aceptada» tomado al pie de la letra hacía que descartar a alguien
  // NO surtiera efecto si en su día se le había admitido: la fila descartada se
  // quedaba debajo de una aceptada más vieja y la puerta seguía leyendo
  // «aceptada». Lo enseñó una solicitud real de nutri_laura —admitida el 03/08 y
  // descartada el 05/08— que la puerta seguía dando por admitida. Ahí no se notó
  // porque además le faltaba la ficha, pero con ficha habría podido reservar
  // después de que la descartaran, que es exactamente lo que la bandeja quiere
  // impedir. Manda la decisión MÁS RECIENTE, no el mejor resultado.
  if (aceptadas.length && !descartadaDespuesDeAdmitir(aceptadas, rechazadas)) {
    // …siempre que su ficha siga existiendo.
    const ficha = await fichaDeQuienFueAdmitido(tenantModels, email, aceptadas);
    if (ficha) return "aceptada";
    return hayPendiente ? "pendiente" : "sin_ficha";
  }

  // Una solicitud nueva esperando manda sobre cualquier descarte anterior: es
  // justo el reenvío que se le permite a quien fue descartado.
  if (hayPendiente) return "pendiente";
  if (!rechazadas.length) return "sin_enviar";

  return rechazadas.length >= RECHAZOS_ANTES_DE_CERRAR ? "descartada_final" : "descartada";
}

/**
 * Traduce el estado a lo que se le responde a quien intenta reservar.
 *
 * `identificado` = la petición trae sesión verificada del portal, así que
 * sabemos que el email es de verdad suyo. Solo entonces se le puede decir
 * "tu solicitud está en revisión": a una petición anónima, decirle si un email
 * concreto está aceptado o pendiente convierte este endpoint en un buscador de
 * pacientes de la consulta. A esos se les da siempre el mismo mensaje.
 */
export function mensajeDePuerta(
  estado,
  { identificado = false, nombre = null, emailContacto = null } = {}
) {
  const quien = nombre ? ` de ${nombre}` : "";

  // No se ha podido mirar la bandeja: no es culpa suya y no hay nada que
  // pueda hacer, así que ni se le manda al formulario ni se le insinúa que le
  // falte algo.
  if (estado === "sin_bandeja") {
    return {
      codigo: "ADMISION_NO_DISPONIBLE",
      titulo: "Ahora mismo no podemos dar cita",
      texto: "Estamos teniendo un problema técnico con las solicitudes. Inténtalo de nuevo en un rato.",
      mostrarEnlace: false,
    };
  }

  // "sin_ficha" (la borraron) cae en el mensaje genérico de abajo a propósito:
  // a quien ya no es paciente se le trata como a quien llega por primera vez —se
  // le ofrece el formulario— y no se le dice «te hemos dado de baja», que es una
  // conversación de la consulta y no de una pantalla.
  if (identificado && estado === "pendiente") {
    return {
      codigo: "ADMISION_PENDIENTE",
      titulo: "Tu solicitud está en revisión",
      texto: `Ya hemos recibido tus respuestas. En cuanto el equipo${quien} las revise te avisamos por correo y podrás reservar.`,
      mostrarEnlace: false,
    };
  }

  // Agotados los reenvíos. Se le dice y se le da una salida por correo, en vez
  // de devolverle por cuarta vez el mismo formulario: repetirlo sin más es lo
  // que convierte un «no» en una noria.
  //
  // Solo a quien viene identificado, igual que el «en revisión»: a una petición
  // anónima no se le puede confirmar que un correo concreto ha sido descartado
  // —sería un buscador de pacientes— así que esa cae en el mensaje de abajo.
  if (identificado && estado === "descartada_final") {
    return {
      codigo: "ADMISION_CERRADA",
      titulo: "Has alcanzado el número máximo de formularios",
      texto: emailContacto
        ? `Contacta por correo a ${emailContacto} para más información.`
        : "Contacta por correo con el centro para más información.",
      mostrarEnlace: false,
      // La única salida de esta pantalla es hacia fuera: sin esto se queda sin
      // ningún botón, que dentro de un iframe es un callejón sin salida.
      mostrarVolver: true,
    };
  }

  return {
    codigo: "ADMISION_REQUERIDA",
    titulo: "Antes de reservar, cuéntanos tu caso",
    texto: `Para dar cita hace falta que completes primero un formulario breve. Es lo que el equipo${quien} necesita para preparar tu consulta.`,
    mostrarEnlace: true,
  };
}
