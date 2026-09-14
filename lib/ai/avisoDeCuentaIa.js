/**
 * lib/ai/avisoDeCuentaIa.js — cuando la IA falla por la CUENTA del cliente,
 * que se entere quien puede arreglarlo.
 *
 * (Fichero nuevo en /lib, regla #2: lo comparten los endpoints clínicos que
 * llaman a Claude; el fallo es el mismo en todos y el aviso también.)
 *
 * (13/09/2026, regla #2) Ya NO lo llaman las rutas: lo llama el cliente central
 * (`lib/ai/trasFalloDeIa.js`) por el gancho `avisarFalloDeCuenta` que
 * `withTenant` y `withPublicTenant` meten en el contexto de la petición con
 * `datosDelContexto`. Así avisan también las 13 rutas que no se acordaban,
 * Whisper y la clasificación automática del portal de soporte. Tres cambios
 * más del mismo día: el título nombra la CUENTA (Anthropic u OpenAI), para que
 * el fallo de una no tape 12 h el de la otra; un mismo error no avisa dos
 * veces aunque pase por dos sitios; y la ventana sigue siendo una campana por
 * cuenta y causa cada 12 h.
 *
 * ── DE QUÉ FALLO REAL NACE (10/09/2026, Aumenta) ───────────────────────────
 * A las 16:26 la cuenta de Anthropic del centro se quedó sin saldo. Hasta las
 * 21:00 hubo 129 intentos de registrar sesiones con IA y TODOS fallaron; la
 * pantalla decía «El reparto por apartados ha fallado. Vuelve a intentarlo» en
 * una caja verde, así que las terapeutas volvieron a intentarlo (y a
 * intentarlo), y cuatro abrieron tickets convencidas de que el CRM estaba
 * caído. Nadie que pudiera recargar el saldo supo nada hasta el día siguiente:
 * quien teclea no suele ser quien paga.
 *
 * Aquí se hacen dos cosas, separadas para poder probarlas sin base:
 *   · `avisoDeCuenta(err)` — PURA: decide si el error es de la cuenta (saldo,
 *     clave, permiso del modelo, límite) y con qué título y texto se cuenta.
 *   · `avisarAdminsDelFalloIa(ctx, err)` — pone esa campana a cada admin del
 *     tenant, UNA vez cada 12 h POR CAUSA y no una por intento. Best-effort:
 *     nunca lanza, porque se llama desde un catch que ya tiene su propia
 *     respuesta que dar.
 *
 * ── UNA POR CAUSA, Y SIN DOBLES AUNQUE PULSEN A LA VEZ ─────────────────────
 * Dos cosas que la primera versión no cubría (revisión del 11/09/2026):
 *   · Un 429 de límite por minuto a las 09:00 no puede tapar el «sin saldo»
 *     de las 10:30: la ventana de 12 h se mira por `title` (la causa), no solo
 *     por `type`.
 *   · El corte de saldo empieza con varias terapeutas pulsando a la vez, y un
 *     «mirar y luego insertar» deja que dos peticiones vean «no hay aviso» y
 *     las dos inserten. La guarda de verdad está en la base: el índice único
 *     `notifications_dedupe_uniq (user_id, type, entity_id) WHERE entity_id
 *     IS NOT NULL`. Por eso cada campana lleva un `entityId` DETERMINISTA
 *     (causa + tramo de 12 h): la segunda inserción del mismo tramo choca con
 *     el índice y se descarta, sin carrera posible.
 */

import { createHash } from "node:crypto";
import { Op } from "sequelize";
import { getMasterModels } from "../db/masterDb.js";
import { cuentaDelError, esFalloDeCuenta, esFalloDeSaldo, mensajeDeErrorIa } from "./errorLegible.js";

export const TIPO_AVISO_CUENTA_IA = "ai_cuenta";
const NO_REPETIR_MS = 12 * 60 * 60 * 1000;

/*
 * El título es la CAUSA (la ventana de 12 h se mira por título) y desde el
 * 13/09/2026 nombra la cuenta: un centro puede tener las dos (Claude para
 * redactar, OpenAI para transcribir), y «la clave de IA no funciona» no decía
 * cuál. Sin `status` (un error de Whisper armado a mano), el `code` dice cuál.
 * El 403 de Whisper (`servicio: "audio"`) es otra causa que el 403 del chat
 * —permiso para transcribir, no para el modelo elegido— y lleva su título,
 * para que uno no tape al otro en la ventana de 12 h.
 */
function tituloDelAviso(err) {
  const cuenta = cuentaDelError(err);
  if (esFalloDeSaldo(err)) return `La cuenta de ${cuenta} se ha quedado sin saldo`;
  const estado = typeof err?.status === "number" ? err.status : { BAD_KEY: 401, QUOTA: 429 }[err?.code];
  return (
    {
      401: `La clave de ${cuenta} no funciona`,
      403: err?.servicio === "audio" ? `La clave de ${cuenta} no puede transcribir audio` : `La clave de ${cuenta} no tiene permiso`,
      429: `La cuenta de ${cuenta} ha llegado a su límite de uso`,
    }[estado] || `La IA de ${cuenta} no puede responder`
  );
}

/** Qué campana toca para este error, o `null` si no es cosa de la cuenta. */
export function avisoDeCuenta(err) {
  if (!esFalloDeCuenta(err)) return null;
  return { type: TIPO_AVISO_CUENTA_IA, title: tituloDelAviso(err), body: mensajeDeErrorIa(err) };
}

/*
 * El mismo objeto de error no avisa dos veces (13/09/2026): lo avisa el
 * cliente central, y si una ruta lo volviera a pasar, o un envoltorio lo
 * relanzara hacia otro que también avisa, aquí se para sin mirar la base. Un
 * WeakSet no retiene los errores: se van con la petición.
 */
const yaAvisados = new WeakSet();

/**
 * Un UUID que sale siempre igual para el mismo texto (v5-like sobre SHA-1).
 * Es lo que convierte «causa + tramo de 12 h» en un `entityId` que el índice
 * único de la tabla puede comparar.
 */
export function idDeterminista(texto) {
  const h = createHash("sha1").update(String(texto)).digest("hex");
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    "5" + h.slice(13, 16),
    ((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0") + h.slice(18, 20),
    h.slice(20, 32),
  ].join("-");
}

/** El `entityId` de una campana: mismo tenant, misma causa, mismo tramo de 12 h → mismo id. */
export function idDelAviso(tenantId, title, ahora = new Date()) {
  const tramo = Math.floor(ahora.getTime() / NO_REPETIR_MS);
  return idDeterminista(`ai_cuenta:${tenantId}:${title}:${tramo}`);
}

async function adminsDelTenant(tenantId) {
  const { User } = getMasterModels();
  return User.findAll({ where: { tenantId, role: "admin" }, attributes: ["id"] });
}

function esChoqueDeUnico(e) {
  return e?.name === "SequelizeUniqueConstraintError" || e?.parent?.code === "23505" || e?.original?.code === "23505";
}

/**
 * Avisa a los administradores del tenant si el fallo es de su cuenta de IA.
 * Devuelve cuántas campanas ha creado (0 si no tocaba o si algo falló).
 * `deps` existe para las pruebas: `buscarAdmins(tenantId)` y `ahora`.
 */
export async function avisarAdminsDelFalloIa(
  ctx,
  err,
  { buscarAdmins = adminsDelTenant, ahora = new Date() } = {}
) {
  const aviso = avisoDeCuenta(err);
  if (!aviso) return 0;
  if (err && typeof err === "object") {
    if (yaAvisados.has(err)) return 0;
    yaAvisados.add(err);
  }
  try {
    const Notification = ctx?.tenantModels?.Notification;
    const tenantId = ctx?.tenant?.id;
    if (!Notification || !tenantId) return 0;
    const desde = new Date(ahora.getTime() - NO_REPETIR_MS);
    const entityId = idDelAviso(tenantId, aviso.title, ahora);
    let creadas = 0;
    for (const admin of await buscarAdmins(tenantId)) {
      // Ventana deslizante por CAUSA: la misma tarde de 129 intentos no puede
      // ser una tarde de 129 avisos, pero un 429 de hace una hora no tapa el
      // sin-saldo de ahora.
      const reciente = await Notification.findOne({
        where: { userId: admin.id, type: aviso.type, title: aviso.title, createdAt: { [Op.gte]: desde } },
        attributes: ["id"],
      });
      if (reciente) continue;
      try {
        await Notification.create({
          userId: admin.id,
          channel: "app",
          type: aviso.type,
          title: aviso.title,
          body: aviso.body,
          entityType: null,
          entityId,
        });
        creadas += 1;
      } catch (e) {
        // Otra petición del mismo instante ya la puso: el índice único la
        // frena y aquí no hay nada que hacer. Cualquier otro fallo sí se cuenta.
        if (!esChoqueDeUnico(e)) throw e;
      }
    }
    return creadas;
  } catch (e) {
    console.warn("[ai:avisoDeCuenta] no se pudo avisar a los admins:", e?.message);
    return 0;
  }
}

/**
 * El gancho que se guarda en el contexto de la petición: con él, el cliente
 * central (`lib/ai/trasFalloDeIa.js`) avisa sin saber de tenants.
 */
export function ganchoDeAviso(tenantContext, deps) {
  return (err) => avisarAdminsDelFalloIa(tenantContext, err, deps);
}

/**
 * Lo que `withTenant` y `withPublicTenant` meten en el contexto de la petición
 * (`conContextoDeUso`): de quién es y con qué avisar si la cuenta de IA falla.
 * Un solo sitio para los dos envoltorios, para que no se desalineen.
 */
export function datosDelContexto(tenantContext, { userId = null, impersonadorId = null } = {}, deps) {
  return {
    tenantId: tenantContext?.tenant?.id ?? null,
    userId,
    impersonadorId,
    avisarFalloDeCuenta: ganchoDeAviso(tenantContext, deps),
  };
}
