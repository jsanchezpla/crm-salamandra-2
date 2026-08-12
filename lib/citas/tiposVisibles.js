/**
 * lib/citas/tiposVisibles.js — qué tipos de cita ve y puede reservar cada uno
 * (05/08/2026).
 *
 * (Fichero nuevo en /lib, regla #2: la decisión la comparten TRES sitios que no
 * se hablan entre ellos —el listado público del widget, el `/book` que crea la
 * reserva y el portal—. Copiada en los tres, el día que cambie se quedará vieja
 * en dos, y el que se quede viejo es el que enseña de más.)
 *
 * Hay dos preguntas distintas y aquí se responden por separado:
 *
 *   1. ¿QUIÉN VE ESTE TIPO DE CITA?  → `filtrarTiposPara`
 *      Los normales los ve todo el mundo. Los ocultos (`is_hidden`) no los ve
 *      nadie, salvo quien tenga un BONO ACTIVO de ese tipo: es la asignación a
 *      dedo. Se le da el bono desde su ficha cuando paga por transferencia o
 *      Bizum, y a partir de ahí ve su tipo de cita, su contador («3 de 6») y
 *      reserva sola, sin pedir hora por WhatsApp cada vez.
 *
 *   2. ¿ESTA RESERVA PASA POR CAJA?  → `exigePasarela` + `reservaSinCobro`
 *      Con el interruptor `settings.citas.soloConPago` encendido, desde la
 *      agenda pública no se puede reservar nada que no se cobre: o lo paga la
 *      pasarela ahora, o lo pagó un bono antes. Las citas verdaderamente
 *      gratuitas solo las crea el centro a mano.
 *
 * ⚠️ EL FILTRO DE LA LISTA NO ES LA SEGURIDAD. Ocultar un tipo del listado solo
 * quita la tentación: el id viaja en el cuerpo de `/book` y cualquiera puede
 * mandarlo. Por eso `/book` vuelve a comprobar lo mismo por su cuenta con
 * `puedeReservar`, que es la comprobación que de verdad cierra la puerta.
 *
 * ⚠️ POR QUÉ `soloConPago` ES UN INTERRUPTOR POR CLIENTE Y NO LA REGLA DE TODOS:
 * Aumenta tiene 62 tipos de cita en producción y NINGUNO tiene precio —cobran
 * cuotas mensuales fuera del CRM—. Aplicarlo a todo el módulo les dejaría la
 * agenda muerta el día que enciendan su portal. Mismo patrón que las otras dos
 * puertas del módulo (`puertaFormulario`, `puertaContrato`): apagado por
 * defecto, se enciende en Configuración → Citas.
 */

import { Op } from "sequelize";
import { estadoPack } from "./packs.js";

/**
 * 42P01 = la tabla no existe en este schema. Pasa de verdad (ver packs.js):
 * `healim` tiene citas pero no `session_packs`.
 */
const esTablaAusente = (err) => err?.parent?.code === "42P01" || err?.original?.code === "42P01";

/** ¿Este centro exige que toda reserva pública pase por caja? (default: no) */
export function exigePasarela(tenant) {
  return tenant?.settings?.citas?.soloConPago === true;
}

/**
 * Los tipos de cita de los que ESTE correo tiene bono con sesiones libres.
 *
 * Devuelve un `Set` de ids. Sin correo —una visitante anónima— devuelve un Set
 * vacío, que es lo que hace que los ocultos no se le enseñen.
 *
 * Ante cualquier tropiezo (tabla ausente, BD con hipo) devuelve vacío: se
 * enseñan MENOS tipos de cita, nunca más. Un fallo técnico no puede destapar un
 * tipo oculto.
 */
export async function tiposConBonoActivo(tenantModels, email) {
  const { SessionPack, Booking } = tenantModels;
  const vacio = new Set();
  if (!SessionPack || !Booking || !email) return vacio;

  try {
    const packs = await SessionPack.findAll({
      where: {
        clientEmail: { [Op.iLike]: String(email).trim() },
        status: "active",
      },
    });
    if (!packs.length) return vacio;

    const ids = new Set();
    for (const pack of packs) {
      const citas = await Booking.findAll({ where: { packId: pack.id } });
      // Un bono agotado ya no da derecho a nada: quien gastó sus 6 sesiones deja
      // de ver el tipo oculto hasta que le den otro.
      if (!estadoPack(pack, citas).agotado) ids.add(pack.eventTypeId);
    }
    return ids;
  } catch (err) {
    if (esTablaAusente(err)) return vacio;
    // Tampoco se propaga: dejar sin agenda a un centro por esto es peor.
    process.stderr.write(`[citas:tiposVisibles] no se pudieron leer los bonos: ${err.message}\n`);
    return vacio;
  }
}

/**
 * Filtra una lista de tipos de cita para quien está mirando.
 *
 * `idsPermitidos` sale de `tiposConBonoActivo`. Los tipos no ocultos pasan
 * siempre; los ocultos, solo si están en ese conjunto.
 */
export function filtrarTiposPara(tipos, idsPermitidos, { esProfesional = false, tenant = null } = {}) {
  const permitidos = idsPermitidos instanceof Set ? idsPermitidos : new Set();
  const soloPro = slugsSoloProfesionales(tenant);
  return (Array.isArray(tipos) ? tipos : []).filter((t) => {
    if (esSoloParaProfesionales(t, soloPro) && !esProfesional) return false;
    return !t?.isHidden || permitidos.has(t.id);
  });
}

/**
 * Tipos de cita reservados a PROFESIONALES DE LA SALUD (12/08/2026, Rodrigo).
 *
 * Nace de «Supervisión profesional» en nutri_laura: una sesión entre colegas,
 * no una consulta, que estaba en la agenda pública a 60 € y podía reservar
 * cualquiera. Quien entra es quien viene marcado del formulario de
 * profesionales de la web.
 *
 * ── POR QUÉ UNA LISTA EN LOS AJUSTES Y NO UNA COLUMNA ──────────────────────
 * `event_types` no tiene ningún JSONB libre, así que un flag por tipo pedía una
 * migración en todos los clientes con `citas` para una casilla que hoy usa un
 * tipo de cita de un cliente. Los otros tres interruptores de este módulo
 * —`formularioObligatorio`, `soloConPago`, `contratoObligatorio`— ya viven en
 * `settings.citas`, así que este va donde vive su familia. El día que un
 * segundo cliente lo pida por tipo, se migra.
 *
 * Se listan SLUGS y no ids: un id no se puede leer ni escribir a mano en la
 * pantalla de Configuración, y el slug sobrevive a renombrar el tipo de cita.
 */
export function slugsSoloProfesionales(tenant) {
  const lista = tenant?.settings?.citas?.tiposSoloProfesionales;
  if (!Array.isArray(lista)) return new Set();
  return new Set(
    lista.filter((s) => typeof s === "string" && s.trim()).map((s) => s.trim().toLowerCase())
  );
}

/** ¿Este tipo está en la lista de reservados a profesionales? */
export function esSoloParaProfesionales(eventType, slugs) {
  const lista = slugs instanceof Set ? slugs : slugsSoloProfesionales(slugs);
  if (!lista.size) return false;
  const slug = typeof eventType?.slug === "string" ? eventType.slug.trim().toLowerCase() : null;
  return !!slug && lista.has(slug);
}

/**
 * Si tiene un programa en marcha, SOLO ve ese (06/08/2026, Rodrigo).
 *
 * «Cuando alguien compre un tipo de cita, que al reservar solo pueda ver esa
 * para ir reservando y el resto no se puedan ver.» Quien pagó un bono de 6
 * sesiones entra a reservar la siguiente, no a elegir entre el catálogo: verle
 * ahí los demás servicios es ruido, y encima invita a reservar por fuera algo
 * que ya tiene pagado.
 *
 * SE APAGA SOLO, y esa es la propiedad importante: `idsPermitidos` sale de
 * `tiposConBonoActivo`, que ya excluye los bonos agotados. Cuando gasta la
 * última sesión, su bono deja de contar, esto deja de estrechar y vuelve a ver
 * el catálogo entero — que es justo cuando toca ofrecerle renovar. Sin esa
 * propiedad, quedaría encerrada en un tipo agotado sin poder comprar nada.
 *
 * Sin bonos activos no toca nada: la inmensa mayoría no tiene ninguno.
 *
 * ⚠️ Es visibilidad, no una puerta. `/book` sigue aceptando cualquier tipo
 * público —si alguien llega por un enlace directo a otro servicio, puede
 * reservarlo—. Estrechar la LISTA quita el ruido; convertirlo en prohibición
 * dejaría a una paciente con bono sin poder contratar nada más, que no es lo
 * que se pidió.
 */
export function soloSuPrograma(tipos, idsPermitidos) {
  const permitidos = idsPermitidos instanceof Set ? idsPermitidos : new Set();
  if (permitidos.size === 0) return tipos;
  const suyos = (Array.isArray(tipos) ? tipos : []).filter((t) => permitidos.has(t?.id));
  // Si por lo que sea no queda ninguno (el tipo se desactivó con el bono vivo),
  // se devuelve la lista entera: mejor de más que dejarla sin nada que reservar.
  return suyos.length ? suyos : tipos;
}

/**
 * ¿Puede esta persona reservar ESTE tipo de cita? La comprobación de verdad,
 * la que hace `/book` con el id que le llega en el cuerpo.
 *
 * Devuelve `{ ok: true }` o `{ ok: false, motivo }` con un texto que se le puede
 * enseñar tal cual. Los dos motivos dicen lo MISMO a propósito («no está
 * disponible»): distinguir «este tipo existe pero no es para ti» de «este tipo
 * no existe» convertiría el endpoint en un buscador de lo que vende la
 * competencia, y a la paciente no le aporta nada.
 *
 * @param {object}  eventType   el tipo pedido
 * @param {object}  opciones
 * @param {boolean} opciones.tieneBono   ¿tiene bono activo de este tipo?
 * @param {boolean} opciones.seCobra     ¿esta reserva va a pasar por la pasarela?
 * @param {boolean} opciones.exigePago   interruptor del centro
 */
export function puedeReservar(
  eventType,
  { tieneBono = false, seCobra = false, exigePago = false, esProfesional = false, tenant = null } = {}
) {
  const NO_DISPONIBLE = "Este tipo de cita no está disponible para reservar online.";

  // 0. Reservado a profesionales de la salud. Va ANTES que el bono a propósito:
  //    una supervisión entre colegas no se abre por haber comprado sesiones, y
  //    dejar que un bono la abriera sería una puerta trasera al mismo sitio.
  //    Mismo motivo que el punto 1 para estar aquí y no solo en el listado: el
  //    id del tipo viaja en el cuerpo y se escribe a mano.
  if (esSoloParaProfesionales(eventType, tenant) && !esProfesional) {
    return { ok: false, motivo: NO_DISPONIBLE };
  }

  // 1. Oculto: solo pasa quien tiene bono. Sin esto, el filtro del listado sería
  //    decorativo — el id viaja en el cuerpo de la petición.
  if (eventType?.isHidden && !tieneBono) {
    return { ok: false, motivo: NO_DISPONIBLE };
  }

  // 2. Regla dura del centro: o lo paga la pasarela ahora, o lo pagó un bono
  //    antes. Lo gratuito de verdad lo crea el centro a mano desde su agenda.
  //
  //    ⚠️ LA VALORACIÓN INICIAL SE SALTA ESTA PUERTA (05/08/2026). Es la misma
  //    excepción que en la de contratos y por el mismo motivo: es la primera
  //    visita, la puerta de entrada de todo el embudo, y en tunutrilaura es
  //    GRATUITA. Sin esta excepción, encender «solo pagando» dejaba la
  //    valoración —el único tipo sin precio— imposible de reservar, que es
  //    exactamente lo contrario de lo que se pretendía. Pasó en producción el
  //    mismo día que se encendió.
  //
  //    Quien tenga bono sigue pasando por la rama de arriba, y un tipo OCULTO
  //    sigue exigiendo bono aunque sea la valoración: el punto 1 va antes.
  if (exigePago && !seCobra && !tieneBono && !eventType?.isInitialAssessment) {
    return { ok: false, motivo: NO_DISPONIBLE };
  }

  return { ok: true };
}
