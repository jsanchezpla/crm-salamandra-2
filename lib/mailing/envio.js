import { Op } from "sequelize";
import { bloquesConContenido, normalizarBloques } from "./bloques.js";
import { renderCorreo } from "./render.js";
import { resolverAudiencia, emailsSuprimidos } from "./audiencia.js";
import { cuentaSes, enviarSes, getTenantSesConfig } from "./ses.js";
import { enlacesDeEnvio, enlacesDePrueba, urlBase } from "./enlaces.js";
import { normalizarEmail } from "./bajaToken.js";

/**
 * lib/mailing/envio.js — el motor: prepara una campaña, la manda por lotes y
 * la reanuda sin duplicar.
 *
 * (Fichero nuevo en /lib, regla #2: lo llaman el endpoint «Enviar», el
 * endpoint «avanzar» que la pantalla va pulsando mientras la campaña está en
 * marcha, y el temporizador `scripts/enviar-mailing.js`. Tres entradas, un
 * motor: si cada una enviara a su manera, la reanudación no sería segura.)
 *
 * ── POR QUÉ NO SE MANDA TODO EN UNA PETICIÓN (plan 2.4) ────────────────────
 * Mil correos caben técnicamente en una petición web, pero si se corta a
 * mitad no hay forma de saber a quién se escribió. Aquí la campaña se marca
 * «enviando», cada destinatario tiene su fila en `mailing_sends`
 * (UNIQUE campaign_id+email: preparar dos veces no duplica) y `avanzarCampana`
 * coge un lote, lo manda y lo apunta. Quien llame —la pantalla o el
 * temporizador— puede parar y volver cuando quiera.
 *
 * ── CÓMO SE COGE UN LOTE SIN PISARSE ───────────────────────────────────────
 * Con UN `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED) RETURNING`:
 * la pantalla y el temporizador pueden avanzar a la vez sin coger la misma
 * fila. Una fila que se quede en `procesando` más de diez minutos (el proceso
 * murió a mitad) se vuelve a coger.
 *
 * ── EL RITMO LO PONE AWS ───────────────────────────────────────────────────
 * `MaxSendRate` de la cuenta (1/s en el sandbox, 14/s o más en producción).
 * Entre correo y correo se espera lo que toque; pasarse es un
 * TooManyRequestsException que se reintenta, no un fallo del destinatario.
 *
 * Nada de aquí lanza por un correo que falla: el fallo se apunta en su fila y
 * se sigue con el siguiente. Lo que sí lanza es lo que impide empezar (sin
 * SES configurado, campaña sin asunto), y lo hace ANTES de tocar nada.
 *
 * ── SPRINT 2 (06/09/2026): A/B DE ASUNTO Y ENVÍO ESCALONADO ────────────────
 * A/B: al preparar, una parte de la audiencia (`abPorcentaje`, repartida
 * mitad A y mitad B, tomada a intervalos regulares de la lista para no sesgar
 * por apellido) sale con cada asunto y el resto se queda `esperando`. Pasadas
 * `abEsperaHoras` desde el arranque, `decidirGanadorAB` mira los clics (y si
 * empatan, las aperturas) y libera al resto con el asunto ganador. Con menos
 * de 20 destinatarios no hay prueba que valga: se manda todo con el A.
 * Ritmo: `ritmoPorHora` acota cuántos salen en cualquier ventana de 60 min;
 * la campaña sigue `enviando` y el temporizador la retoma cada minuto.
 */

export const ESTADOS_CAMPANA = ["borrador", "programada", "enviando", "pausada", "enviada", "cancelada"];
export const MAX_INTENTOS = 3;
const MINUTOS_ATASCO = 10;
export const MINIMO_PARA_AB = 20;

/**
 * Reparto A/B de una audiencia de `total` personas, PURO: devuelve por índice
 * `{ estado, variante }`. La muestra de prueba se coge a intervalos regulares
 * (no los N primeros, que van por orden alfabético) y se alterna a/b.
 * Sin A/B (`porcentaje` nulo) o con menos de MINIMO_PARA_AB, todo `pendiente`.
 */
export function repartoAB(total, porcentaje) {
  const n = Math.max(0, Number(total) || 0);
  const pct = Number(porcentaje) || 0;
  const salida = new Array(n);
  if (!pct || n < MINIMO_PARA_AB) {
    for (let i = 0; i < n; i++) salida[i] = { estado: "pendiente", variante: null };
    return salida;
  }
  let prueba = Math.round((n * Math.min(50, Math.max(10, pct))) / 100);
  if (prueba % 2) prueba++;
  prueba = Math.max(2, Math.min(n, prueba));
  for (let i = 0; i < n; i++) salida[i] = { estado: "esperando", variante: null };
  const paso = n / prueba;
  for (let j = 0; j < prueba; j++) {
    const i = Math.min(n - 1, Math.floor(j * paso));
    salida[i] = { estado: "pendiente", variante: j % 2 === 0 ? "a" : "b" };
  }
  return salida;
}

/** ¿Ha pasado ya el tiempo de prueba del A/B? PURO. */
export function debeDecidirAB(campana, ahora = new Date()) {
  if (!campana?.asuntoB || campana.abGanador || !campana.empezadaAt) return false;
  const horas = Math.max(1, Number(campana.abEsperaHoras) || 4);
  return new Date(campana.empezadaAt).getTime() + horas * 3600000 <= ahora.getTime();
}

/** El asunto que le toca a un envío según su variante. PURO. */
export function asuntoDe(campana, variante) {
  return variante === "b" && campana?.asuntoB ? campana.asuntoB : campana?.asunto;
}

function esquemaDe(ctx) {
  return `crm_${ctx.slug}`;
}

function dormir(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** ¿Se puede enviar tal cual está? `{ ok, motivo }`. */
export function campanaLista(campana) {
  if (!campana) return { ok: false, motivo: "La campaña no existe" };
  if (!String(campana.asunto ?? "").trim()) return { ok: false, motivo: "Falta el asunto" };
  const bloques = normalizarBloques(campana.bloques);
  if (!bloquesConContenido(bloques)) return { ok: false, motivo: "El correo está vacío: añade al menos un bloque con contenido" };
  return { ok: true, motivo: null };
}

/** Datos del centro para el pie del correo. */
export function centroDe(ctx) {
  const t = ctx?.tenant ?? {};
  const centro = t.settings?.centro ?? {};
  const sede = Array.isArray(centro.sedes) ? centro.sedes[0] : null;
  const direccion = [sede?.direccion, sede?.cp, sede?.ciudad].filter(Boolean).join(", ") || null;
  return { nombre: centro.razonSocial || t.name || "", direccion, brand: t.settings?.brand ?? {} };
}

/** La configuración de SES o un error legible. */
export function exigirSes(ctx) {
  const cfg = getTenantSesConfig(ctx);
  if (!cfg.configurado) {
    const err = new Error("Amazon SES no está configurado: faltan credenciales o remitente en Configuración → Conexiones");
    err.statusCode = 400;
    throw err;
  }
  return cfg;
}

/** Cabeceras de baja de un clic (RFC 8058): Gmail y Yahoo las exigen a quien envía en masa. */
function cabecerasDeBaja(enlaces) {
  return [
    { name: "List-Unsubscribe", value: `<${enlaces.baja}>` },
    { name: "List-Unsubscribe-Post", value: "List-Unsubscribe=One-Click" },
  ];
}

/**
 * Prepara la campaña: resuelve la audiencia, crea las filas de `mailing_sends`
 * (las que ya existan se respetan) y la pone en `enviando`.
 * Devuelve `{ total, nuevas }`.
 */
export async function prepararCampana(ctx, campana) {
  const lista = campanaLista(campana);
  if (!lista.ok) {
    const err = new Error(lista.motivo);
    err.statusCode = 422;
    throw err;
  }
  exigirSes(ctx);

  const { MailingSend, MailingSegment } = ctx.tenantModels;
  let reglas = {};
  if (campana.audiencia === "segmento" && campana.segmentId) {
    const seg = await MailingSegment.findByPk(campana.segmentId);
    if (!seg) {
      const err = new Error("El segmento de esta campaña ya no existe");
      err.statusCode = 422;
      throw err;
    }
    reglas = seg.reglas ?? {};
  }
  const audiencia = await resolverAudiencia(ctx, reglas, { conClientes: ctx.tenantHasModule?.("clients") ?? true });
  if (!audiencia.total) {
    const err = new Error("No hay ningún destinatario: nadie con la casilla de novedades marcada ni correos sueltos activos");
    err.statusCode = 422;
    throw err;
  }

  // A/B de asunto: quién hace de prueba y quién espera al ganador.
  const conAB = !!campana.asuntoB && audiencia.total >= MINIMO_PARA_AB;
  const reparto = repartoAB(audiencia.total, conAB ? campana.abPorcentaje || 20 : null);
  const filas = audiencia.destinatarios.map((d, i) => ({
    campaignId: campana.id,
    email: d.email,
    nombre: d.nombre,
    origen: d.origen,
    origenId: d.origenId,
    estado: reparto[i].estado,
    variante: reparto[i].variante ?? (campana.asuntoB ? "a" : null),
  }));
  let nuevas = 0;
  for (let i = 0; i < filas.length; i += 500) {
    const trozo = filas.slice(i, i + 500);
    const creadas = await MailingSend.bulkCreate(trozo, { ignoreDuplicates: true, returning: false });
    nuevas += creadas.length;
  }

  await campana.update({
    estado: "enviando",
    empezadaAt: campana.empezadaAt ?? new Date(),
    terminadaAt: null,
    programadaPara: null,
    ultimoError: null,
    // Con A/B pero sin gente suficiente, la prueba se salta y queda escrito.
    ...(campana.asuntoB && !conAB && !campana.abGanador ? { abGanador: "a", abDecididoAt: new Date() } : {}),
  });
  await recalcularContadores(ctx, campana);
  return { total: audiencia.total, nuevas, ab: conAB };
}

/** Coge un lote de filas pendientes (o atascadas) y las marca `procesando`. */
async function reclamarLote(ctx, campaignId, lote) {
  const s = esquemaDe(ctx);
  const [filas] = await ctx.tenantSequelize.query(
    `UPDATE "${s}"."mailing_sends" SET estado = 'procesando', updated_at = now()
      WHERE id IN (
        SELECT id FROM "${s}"."mailing_sends"
         WHERE campaign_id = :cid
           AND (estado = 'pendiente' OR (estado = 'procesando' AND updated_at < now() - interval '${MINUTOS_ATASCO} minutes'))
         ORDER BY created_at
         LIMIT :lote
         FOR UPDATE SKIP LOCKED
      )
      RETURNING id, email, nombre, origen, origen_id AS "origenId", intentos, variante`,
    { replacements: { cid: campaignId, lote } }
  );
  return filas;
}

/** Los contadores resumidos de la campaña, desde las filas. */
export async function recalcularContadores(ctx, campana) {
  const { MailingSend } = ctx.tenantModels;
  const filas = await MailingSend.findAll({
    attributes: ["estado", [ctx.tenantSequelize.fn("count", ctx.tenantSequelize.col("id")), "n"]],
    where: { campaignId: campana.id },
    group: ["estado"],
    raw: true,
  });
  const n = Object.fromEntries(filas.map((f) => [f.estado, Number(f.n)]));
  const total = Object.values(n).reduce((a, b) => a + b, 0);
  const enviados = (n.enviado ?? 0) + (n.rebotado ?? 0) + (n.queja ?? 0);
  await campana.update({
    totalDestinatarios: total,
    enviados,
    fallidos: n.fallido ?? 0,
    suprimidos: n.suprimido ?? 0,
  });
  return {
    total,
    enviados,
    fallidos: n.fallido ?? 0,
    suprimidos: n.suprimido ?? 0,
    esperando: n.esperando ?? 0,
    pendientes: (n.pendiente ?? 0) + (n.procesando ?? 0) + (n.esperando ?? 0),
  };
}

/**
 * Decide el asunto ganador de un A/B y libera a los que esperaban. Clics por
 * variante; si empatan (o nadie ha pinchado), aperturas; si siguen igual, A.
 * `forzar` ('a' | 'b') salta la cuenta: es el botón «elegir ahora».
 */
export async function decidirGanadorAB(ctx, campana, { forzar = null } = {}) {
  const { MailingSend } = ctx.tenantModels;
  const fn = ctx.tenantSequelize.fn;
  const col = ctx.tenantSequelize.col;
  let ganador = forzar === "a" || forzar === "b" ? forzar : null;
  let cuentas = { a: { enviados: 0, clics: 0, aperturas: 0 }, b: { enviados: 0, clics: 0, aperturas: 0 } };
  const filas = await MailingSend.findAll({
    attributes: [
      "variante",
      [fn("count", col("id")), "enviados"],
      [fn("sum", ctx.tenantSequelize.literal("CASE WHEN clics > 0 THEN 1 ELSE 0 END")), "clics"],
      [fn("sum", ctx.tenantSequelize.literal("CASE WHEN aperturas > 0 THEN 1 ELSE 0 END")), "aperturas"],
    ],
    where: { campaignId: campana.id, variante: { [Op.in]: ["a", "b"] }, estado: { [Op.in]: ["enviado", "rebotado", "queja"] } },
    group: ["variante"],
    raw: true,
  });
  for (const f of filas) {
    if (f.variante === "a" || f.variante === "b") {
      cuentas[f.variante] = { enviados: Number(f.enviados), clics: Number(f.clics), aperturas: Number(f.aperturas) };
    }
  }
  if (!ganador) {
    const tasa = (v, k) => (cuentas[v].enviados ? cuentas[v][k] / cuentas[v].enviados : 0);
    if (tasa("a", "clics") !== tasa("b", "clics")) ganador = tasa("a", "clics") > tasa("b", "clics") ? "a" : "b";
    else if (tasa("a", "aperturas") !== tasa("b", "aperturas")) ganador = tasa("a", "aperturas") > tasa("b", "aperturas") ? "a" : "b";
    else ganador = "a";
  }
  await MailingSend.update({ estado: "pendiente", variante: ganador }, { where: { campaignId: campana.id, estado: "esperando" } });
  await campana.update({ abGanador: ganador, abDecididoAt: new Date() });
  return { ganador, cuentas };
}

/**
 * Manda UN lote. Devuelve `{ procesados, enviados, fallidos, suprimidos,
 * reintentos, pendientes, terminada }`. Idempotente y reanudable.
 *
 * @param {object} ctx
 * @param {object} campana  instancia de MailingCampaign en estado `enviando`
 * @param {{ lote?: number, base?: string, ritmo?: number|null, presupuestoMs?: number }} opciones
 */
export async function avanzarCampana(ctx, campana, { lote = 25, base = null, ritmo = null, presupuestoMs = 45000 } = {}) {
  const cfg = exigirSes(ctx);
  const inicio = Date.now();
  const baseUrl = base || urlBase();
  const centro = centroDe(ctx);
  const bloques = normalizarBloques(campana.bloques);
  const { MailingSend } = ctx.tenantModels;

  // El ritmo: lo que diga la cuenta (una llamada por lote), o 1/s si no se sabe.
  let porSegundo = Number(ritmo) || 0;
  if (!porSegundo) {
    const cuenta = await cuentaSes(cfg);
    porSegundo = cuenta.ok ? Math.max(1, cuenta.ritmoMax) : 1;
    if (cuenta.ok && !cuenta.envioActivo) {
      await campana.update({ estado: "pausada", ultimoError: "AWS tiene el envío de esta cuenta en pausa (revisa la consola de SES)" });
      return { procesados: 0, enviados: 0, fallidos: 0, suprimidos: 0, reintentos: 0, pendientes: null, terminada: false, pausada: true, ritmoUsado: porSegundo };
    }
  }
  const esperaMs = Math.ceil(1000 / porSegundo);

  // A/B: si el tiempo de prueba ha pasado, se decide y se libera al resto.
  if (debeDecidirAB(campana, new Date())) await decidirGanadorAB(ctx, campana);

  // Envío escalonado: como mucho `ritmoPorHora` en cualquier ventana de 60 min.
  let loteEfectivo = lote;
  if (campana.ritmoPorHora > 0) {
    const enviadosHora = await MailingSend.count({
      where: { campaignId: campana.id, enviadoAt: { [Op.gte]: new Date(Date.now() - 3600000) } },
    });
    const disponibles = campana.ritmoPorHora - enviadosHora;
    if (disponibles <= 0) {
      const c = await recalcularContadores(ctx, campana);
      return { procesados: 0, enviados: 0, fallidos: 0, suprimidos: 0, reintentos: 0, pendientes: c.pendientes, terminada: false, pausada: false, limitado: true, ritmoUsado: porSegundo };
    }
    loteEfectivo = Math.min(lote, disponibles);
  }

  const filas = await reclamarLote(ctx, campana.id, loteEfectivo);
  const resumen = { procesados: 0, enviados: 0, fallidos: 0, suprimidos: 0, reintentos: 0 };
  if (filas.length) {
    // La supresión se mira por lote, fresca: alguien puede darse de baja
    // mientras la campaña avanza y no tiene que recibirla.
    const suprimidos = await emailsSuprimidos(ctx);
    for (const fila of filas) {
      resumen.procesados++;
      const email = normalizarEmail(fila.email);
      if (suprimidos.has(email)) {
        await MailingSend.update({ estado: "suprimido", error: "en la lista de supresión" }, { where: { id: fila.id } });
        resumen.suprimidos++;
        continue;
      }

      const enlaces = enlacesDeEnvio({ base: baseUrl, slug: ctx.slug, sendId: fila.id, email });
      let correo;
      try {
        correo = renderCorreo({
          asunto: asuntoDe(campana, fila.variante),
          preheader: campana.preheader,
          bloques,
          centro,
          destinatario: { nombre: fila.nombre, email },
          enlaces,
        });
      } catch (err) {
        await MailingSend.update({ estado: "fallido", error: `render: ${err.message}` }, { where: { id: fila.id } });
        resumen.fallidos++;
        continue;
      }

      const res = await enviarSes(cfg, {
        to: email,
        subject: correo.asunto,
        html: correo.html,
        text: correo.text,
        replyTo: campana.replyTo || null,
        headers: cabecerasDeBaja(enlaces),
        tags: [
          { name: "crm_campaign", value: campana.id },
          { name: "crm_send", value: fila.id },
        ],
      });

      if (res.ok) {
        await MailingSend.update(
          { estado: "enviado", sesMessageId: res.id, enviadoAt: new Date(), error: null, intentos: (fila.intentos ?? 0) + 1 },
          { where: { id: fila.id } }
        );
        resumen.enviados++;
      } else {
        const intentos = (fila.intentos ?? 0) + 1;
        const reintentar = res.reintentable && intentos < MAX_INTENTOS;
        await MailingSend.update(
          { estado: reintentar ? "pendiente" : "fallido", error: `${res.tipo}: ${res.error}`.slice(0, 1000), intentos },
          { where: { id: fila.id } }
        );
        if (reintentar) {
          resumen.reintentos++;
          if (res.tipo === "TooManyRequestsException") await dormir(esperaMs * 4);
        } else {
          resumen.fallidos++;
        }
        // Una cuenta parada o suspendida no se arregla insistiendo: se pausa.
        if (res.tipo === "SendingPausedException" || res.tipo === "AccountSuspendedException") {
          await MailingSend.update({ estado: "pendiente" }, { where: { id: fila.id } });
          await campana.update({ estado: "pausada", ultimoError: `${res.tipo}: ${res.error}`.slice(0, 500) });
          const c = await recalcularContadores(ctx, campana);
          return { ...resumen, pendientes: c.pendientes, terminada: false, pausada: true, ritmoUsado: porSegundo };
        }
      }

      if (Date.now() - inicio > presupuestoMs) break;
      await dormir(esperaMs);
    }
  }

  const contadores = await recalcularContadores(ctx, campana);
  await campana.reload();
  // Solo se da por terminada la que sigue «enviando» (nadie la pausó a mitad).
  const terminada = contadores.pendientes === 0 && campana.estado === "enviando";
  if (terminada) await campana.update({ estado: "enviada", terminadaAt: new Date() });
  return { ...resumen, pendientes: contadores.pendientes, terminada, pausada: campana.estado === "pausada", ritmoUsado: porSegundo };
}

/**
 * Envío de PRUEBA a una o varias direcciones del equipo. No crea filas, no
 * mide clics, y el asunto va marcado. Devuelve `[{ email, ok, error }]`.
 */
export async function enviarPrueba(ctx, campana, emails, { base = null } = {}) {
  const cfg = exigirSes(ctx);
  const lista = campanaLista(campana);
  if (!lista.ok) {
    const err = new Error(lista.motivo);
    err.statusCode = 422;
    throw err;
  }
  const baseUrl = base || urlBase();
  const centro = centroDe(ctx);
  const bloques = normalizarBloques(campana.bloques);
  const resultados = [];
  for (const crudo of emails) {
    const email = normalizarEmail(crudo);
    const enlaces = enlacesDePrueba({ base: baseUrl, slug: ctx.slug, email });
    const correo = renderCorreo({
      asunto: campana.asunto,
      preheader: campana.preheader,
      bloques,
      centro,
      destinatario: { nombre: "Nombre de prueba", email },
      enlaces,
    });
    const res = await enviarSes(cfg, {
      to: email,
      subject: `[PRUEBA] ${correo.asunto}`,
      html: correo.html,
      text: correo.text,
      replyTo: campana.replyTo || null,
      headers: cabecerasDeBaja(enlaces),
      tags: [{ name: "crm_campaign", value: campana.id }, { name: "crm_prueba", value: "1" }],
    });
    resultados.push({ email, ok: res.ok, id: res.id ?? null, error: res.ok ? null : `${res.tipo}: ${res.error}` });
  }
  return resultados;
}

/** Las campañas que le tocan al temporizador: programadas vencidas y las que están enviando. */
export async function campanasPendientesDeEnvio(ctx) {
  const { MailingCampaign } = ctx.tenantModels;
  return MailingCampaign.findAll({
    where: {
      [Op.or]: [{ estado: "enviando" }, { estado: "programada", programadaPara: { [Op.lte]: new Date() } }],
    },
    order: [["programadaPara", "ASC"], ["createdAt", "ASC"]],
  });
}
