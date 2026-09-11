/**
 * lib/ai/avisoDeCuentaIa.js — cuando la IA falla por la CUENTA del cliente,
 * que se entere quien puede arreglarlo.
 *
 * (Fichero nuevo en /lib, regla #2: lo comparten los endpoints clínicos que
 * llaman a Claude; el fallo es el mismo en todos y el aviso también.)
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
import { esFalloDeCuenta, esFalloDeSaldo, mensajeDeErrorIa } from "./errorLegible.js";

export const TIPO_AVISO_CUENTA_IA = "ai_cuenta";
const NO_REPETIR_MS = 12 * 60 * 60 * 1000;

const TITULO_POR_ESTADO = {
  401: "La clave de IA no funciona",
  403: "La clave de IA no tiene permiso para este modelo",
  429: "La IA ha llegado a su límite de uso",
};

/** Qué campana toca para este error, o `null` si no es cosa de la cuenta. */
export function avisoDeCuenta(err) {
  if (!esFalloDeCuenta(err)) return null;
  const title = esFalloDeSaldo(err)
    ? "La IA se ha quedado sin saldo"
    : TITULO_POR_ESTADO[err.status] || "La IA no puede responder";
  return { type: TIPO_AVISO_CUENTA_IA, title, body: mensajeDeErrorIa(err) };
}

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
