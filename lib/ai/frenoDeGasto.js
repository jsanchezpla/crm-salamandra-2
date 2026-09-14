/**
 * lib/ai/frenoDeGasto.js — cuánto lleva gastado un centro en IA este mes y la
 * campana del tope (14/09/2026). Solo servidor.
 *
 * (Fichero nuevo en /lib, regla #2: es la ÚNICA lectura del gasto del mes que
 * decide algo y la única campana del tope. La usan `vetoAi`, por donde pasan
 * las 21 rutas que gastan IA, y la clasificación automática del portal público
 * de Soporte, que no pasa por `vetoAi`.) Las reglas —qué es aviso, qué es
 * freno, qué frases— son puras y viven en `lib/ai/topeDeGasto.js`, porque las
 * importa también la tarjeta de Configuración.
 *
 * ── LO QUE NO PUEDE HACER NUNCA: APAGAR LA IA POR UN FALLO SUYO ────────────
 * `vetoAi` es la puerta de toda la IA del CRM. Por eso aquí:
 *   · sin tope guardado no se consulta la base (hoy, todos los centros);
 *   · si la consulta falla o tarda más de 500 ms, se DEJA PASAR (fail-open):
 *     el tope protege el gasto, no es un permiso. Es el mismo criterio que la
 *     contabilidad de `lib/ai/usoDeIA.js`;
 *   · la campana tampoco espera más de 500 ms: si tarda, sigue sola por detrás
 *     y la llamada no la espera;
 *   · nada de esto lanza.
 *
 * ── LA SUMA ────────────────────────────────────────────────────────────────
 * Todo el `coste_usd` del centro en el mes de Madrid (Claude, ChatGPT y Whisper
 * juntos), con la misma frontera que `GET /api/tenant/ia/consumo`. No se filtra
 * `error IS NULL`: las llamadas que fallaron van a coste 0 y no cambian la
 * suma, y así el freno no depende de que la columna `error` esté migrada. La
 * suma se guarda 60 s por centro en el proceso: lo que se escapa son céntimos
 * (el peor caso, un audio largo de Whisper en vuelo). Un fallo no se guarda.
 *
 * ── LA CAMPANA ─────────────────────────────────────────────────────────────
 * Una por administrador, tramo (80 / 100), mes e importe del tope: subir el
 * tope rearma el aviso. El `entityId` es determinista (`idDeterminista` de
 * `avisoDeCuentaIa.js`), así que el índice único `notifications_dedupe_uniq`
 * frena dos peticiones simultáneas. Delante van un Set del proceso (para no
 * mirar la base en cada llamada del mes) y un `findOne` (el Set se vacía en
 * cada despliegue). Un intento que falla, o que sigue en marcha, no se repite
 * hasta dentro de 60 s: con la base mal, cada llamada del centro por encima
 * del 80 % no puede ir a buscar admins otra vez.
 *
 * ── LA IA QUE NO PASA POR `vetoAi` ─────────────────────────────────────────
 * `topeFueraDeVetoAi` junta las dos piezas para quien dispara la IA sin
 * `vetoAi` y nunca es admin (hoy, la clasificación de un ticket del portal):
 * pone la campana si toca y dice si puede seguir.
 */

import { Op } from "sequelize";
import { getMasterModels } from "../db/masterDb.js";
import { madridYearMonth } from "../utils/madridDate.js";
import { idDeterminista } from "./avisoDeCuentaIa.js";
import { decidirConTope, estadoDelTope, leerTope, FRASE_CORTA_DE_TOPE, textoDelAvisoDeTope, TIPO_AVISO_TOPE } from "./topeDeGasto.js";

export const SEGUNDOS_DE_CACHE = 60;
export const MS_MAXIMO_DE_CONSULTA = 500;
/** Lo que se espera a un intento de campana que falló o sigue en marcha antes de repetirlo. */
export const SEGUNDOS_ENTRE_INTENTOS = 60;

export const SQL_GASTO_DEL_MES = `
  SELECT coalesce(sum(coste_usd), 0)::float AS usd
  FROM master.ai_uso
  WHERE tenant_id = :tenantId
    AND created_at >= (date_trunc('month', now() AT TIME ZONE 'Europe/Madrid') AT TIME ZONE 'Europe/Madrid')
`;

const cache = new Map(); // tenantId → { mes, usd, en }
const avisados = new Set(); // entityIds ya tramitados en este proceso
const intentados = new Map(); // entityId → ms del intento que falló o sigue en marcha

function mesDe(ahora) {
  const { year, month } = madridYearMonth(ahora);
  return `${year}-${String(month).padStart(2, "0")}`;
}

async function consultarEnMaster(tenantId) {
  const { AiUso } = getMasterModels();
  const [[fila]] = await AiUso.sequelize.query(SQL_GASTO_DEL_MES, { replacements: { tenantId } });
  return Number(fila?.usd) || 0;
}

function conTiempoMaximo(promesa, ms, queTarda = "la consulta del gasto") {
  let temporizador;
  const tiempo = new Promise((_, rechazar) => {
    temporizador = setTimeout(() => rechazar(new Error(`${queTarda} tardó demasiado`)), ms);
  });
  return Promise.race([promesa, tiempo]).finally(() => clearTimeout(temporizador));
}

/**
 * Dólares gastados por el centro en el mes de Madrid de `ahora`. Lanza si la
 * consulta falla o tarda (quien llama decide; `comprobarTopeDeGasto` deja pasar).
 * `consultar` y `msMaximo` existen para las pruebas.
 */
export async function gastoDelMesUsd(tenantId, { ahora = new Date(), consultar = consultarEnMaster, msMaximo = MS_MAXIMO_DE_CONSULTA } = {}) {
  const mes = mesDe(ahora);
  const guardado = cache.get(tenantId);
  if (guardado && guardado.mes === mes && ahora.getTime() - guardado.en < SEGUNDOS_DE_CACHE * 1000) return guardado.usd;
  // `Promise.resolve().then` para que un `consultar` que lanza SIN promesa
  // también pase por aquí, y un fallo NO se guarda.
  const usd = Number(await conTiempoMaximo(Promise.resolve().then(() => consultar(tenantId)), msMaximo)) || 0;
  cache.set(tenantId, { mes, usd, en: ahora.getTime() });
  return usd;
}

/** Solo pruebas: olvida la suma guardada y las campanas ya tramitadas. */
export function olvidarGastoDelMes() {
  cache.clear();
  avisados.clear();
  intentados.clear();
}

const PERMITIR = Object.freeze({ permitir: true, avisarTramo: null, estado: Object.freeze({ nivel: "sin_tope" }) });

/**
 * ¿Puede seguir esta llamada, y toca campana? `{ permitir, avisarTramo, estado }`.
 * NUNCA lanza. Sin tope no consulta. Ante un fallo o más de 500 ms, deja pasar.
 */
export async function comprobarTopeDeGasto(ctx, { esAdmin = false, ahora = new Date(), consultar, msMaximo } = {}) {
  try {
    const tope = leerTope(ctx?.tenant?.settings?.integrations);
    const tenantId = ctx?.tenant?.id;
    if (!tope || !tenantId) return PERMITIR;
    const gastadoUsd = await gastoDelMesUsd(tenantId, { ahora, ...(consultar ? { consultar } : {}), ...(msMaximo ? { msMaximo } : {}) });
    const estado = estadoDelTope({ gastadoUsd, tope });
    return { ...decidirConTope(estado, { esAdmin }), estado };
  } catch (e) {
    console.warn("[ai:tope] no se pudo comprobar el tope de gasto; se deja pasar:", e?.message);
    return PERMITIR;
  }
}

/** El `entityId` de la campana: mismo centro, mes, tramo e importe → mismo id. */
export function idDelAvisoDeTope(tenantId, mes, tramo, topeUsd) {
  return idDeterminista(`${TIPO_AVISO_TOPE}:${tenantId}:${mes}:${tramo}:${Number(topeUsd).toFixed(2)}`);
}

async function adminsDelTenant(tenantId) {
  const { User } = getMasterModels();
  return User.findAll({ where: { tenantId, role: { [Op.in]: ["admin", "superadmin"] } }, attributes: ["id"] });
}

function esChoqueDeUnico(e) {
  return e?.name === "SequelizeUniqueConstraintError" || e?.parent?.code === "23505" || e?.original?.code === "23505";
}

async function ponerCampanas({ Notification, entityId, admins, title, body }) {
  let creadas = 0;
  for (const admin of admins) {
    // El Set se vacía en cada despliegue: se mira antes de insertar, y el
    // índice único se queda con las carreras.
    const ya = await Notification.findOne({ where: { userId: admin.id, type: TIPO_AVISO_TOPE, entityId }, attributes: ["id"] });
    if (ya) continue;
    try {
      await Notification.create({
        userId: admin.id,
        channel: "app",
        type: TIPO_AVISO_TOPE,
        title,
        body,
        entityType: "IaTope",
        entityId,
      });
      creadas += 1;
    } catch (e) {
      if (!esChoqueDeUnico(e)) throw e;
    }
  }
  return creadas;
}

/**
 * La campana del tramo (80 o 100) a cada administrador del centro, una vez por
 * mes e importe. Best-effort: nunca lanza y no espera más de 500 ms (si tarda,
 * sigue por detrás). Un intento que falla o sigue en marcha no se repite hasta
 * dentro de 60 s. Devuelve cuántas ha creado a tiempo.
 * `buscarAdmins`, `ahora` y `msMaximo` existen para las pruebas.
 */
export async function avisarTramoDelTope(
  ctx,
  estado,
  tramo,
  { buscarAdmins = adminsDelTenant, ahora = new Date(), msMaximo = MS_MAXIMO_DE_CONSULTA } = {}
) {
  try {
    const tenantId = ctx?.tenant?.id;
    const Notification = ctx?.tenantModels?.Notification;
    if (!tenantId || !Notification || !tramo || !estado?.topeUsd) return 0;
    const entityId = idDelAvisoDeTope(tenantId, mesDe(ahora), tramo, estado.topeUsd);
    if (avisados.has(entityId)) return 0;
    const ultimo = intentados.get(entityId);
    if (ultimo !== undefined && ahora.getTime() - ultimo < SEGUNDOS_ENTRE_INTENTOS * 1000) return 0;
    intentados.set(entityId, ahora.getTime());
    const { title, body } = textoDelAvisoDeTope(estado, tramo, ahora);
    // `Promise.resolve().then` para que un fallo SIN promesa también pase por
    // aquí. Si gana el tiempo, `Promise.race` ya ha enganchado el rechazo que
    // llegue después: no queda ningún «unhandled rejection».
    const trabajo = Promise.resolve()
      .then(async () => ponerCampanas({ Notification, entityId, admins: await buscarAdmins(tenantId), title, body }))
      .then((creadas) => {
        avisados.add(entityId);
        intentados.delete(entityId);
        return creadas;
      });
    return await conTiempoMaximo(trabajo, msMaximo, "la campana del tope");
  } catch (e) {
    console.warn("[ai:tope] no se pudo avisar a los administradores:", e?.message);
    return 0;
  }
}

/**
 * El tope para una IA que NO pasa por `vetoAi` y que dispara alguien que nunca
 * es administrador (hoy, la clasificación de un ticket del portal público).
 * Pone la campana si toca. Devuelve `null` si la llamada puede seguir, o la
 * frase corta de por qué no («Sin clasificar: …»). Nunca lanza: ante un fallo,
 * `null` (deja pasar). `opciones` (`ahora`, `consultar`, `msMaximo`,
 * `buscarAdmins`) existen para las pruebas.
 */
export async function topeFueraDeVetoAi(ctx, accion, { buscarAdmins, ...opciones } = {}) {
  const tope = await comprobarTopeDeGasto(ctx, { ...opciones, esAdmin: false });
  if (tope.avisarTramo) {
    await avisarTramoDelTope(ctx, tope.estado, tope.avisarTramo, {
      ...(buscarAdmins ? { buscarAdmins } : {}),
      ...(opciones.ahora ? { ahora: opciones.ahora } : {}),
      ...(opciones.msMaximo ? { msMaximo: opciones.msMaximo } : {}),
    });
  }
  if (tope.permitir) return null;
  console.info(`[ai:tope] frenada tenant=${ctx?.slug || ctx?.tenant?.slug} accion=${accion}`);
  return FRASE_CORTA_DE_TOPE;
}
