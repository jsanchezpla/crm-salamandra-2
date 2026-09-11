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
 *     tenant, UNA vez cada 12 h y no una por intento. Best-effort: nunca
 *     lanza, porque se llama desde un catch que ya tiene su propia respuesta
 *     que dar.
 */

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

async function adminsDelTenant(tenantId) {
  const { User } = getMasterModels();
  return User.findAll({ where: { tenantId, role: "admin" }, attributes: ["id"] });
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
    let creadas = 0;
    for (const admin of await buscarAdmins(tenantId)) {
      // Una campana por admin y por medio día: la misma tarde de 129 intentos
      // no puede ser una tarde de 129 avisos.
      const reciente = await Notification.findOne({
        where: { userId: admin.id, type: aviso.type, createdAt: { [Op.gte]: desde } },
        attributes: ["id"],
      });
      if (reciente) continue;
      await Notification.create({
        userId: admin.id,
        channel: "app",
        type: aviso.type,
        title: aviso.title,
        body: aviso.body,
        entityType: null,
        entityId: null,
      });
      creadas += 1;
    }
    return creadas;
  } catch (e) {
    console.warn("[ai:avisoDeCuenta] no se pudo avisar a los admins:", e?.message);
    return 0;
  }
}
