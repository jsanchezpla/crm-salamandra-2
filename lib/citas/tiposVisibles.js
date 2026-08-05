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
export function filtrarTiposPara(tipos, idsPermitidos) {
  const permitidos = idsPermitidos instanceof Set ? idsPermitidos : new Set();
  return (Array.isArray(tipos) ? tipos : []).filter(
    (t) => !t?.isHidden || permitidos.has(t.id)
  );
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
export function puedeReservar(eventType, { tieneBono = false, seCobra = false, exigePago = false } = {}) {
  const NO_DISPONIBLE = "Este tipo de cita no está disponible para reservar online.";

  // 1. Oculto: solo pasa quien tiene bono. Sin esto, el filtro del listado sería
  //    decorativo — el id viaja en el cuerpo de la petición.
  if (eventType?.isHidden && !tieneBono) {
    return { ok: false, motivo: NO_DISPONIBLE };
  }

  // 2. Regla dura del centro: o lo paga la pasarela ahora, o lo pagó un bono
  //    antes. Lo gratuito de verdad lo crea el centro a mano desde su agenda.
  if (exigePago && !seCobra && !tieneBono) {
    return { ok: false, motivo: NO_DISPONIBLE };
  }

  return { ok: true };
}
