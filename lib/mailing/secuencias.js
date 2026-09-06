import { Op } from "sequelize";
import { resolverAudiencia, ultimasCitasPorCliente } from "./audiencia.js";
import { avanzarCampana, campanaLista, recalcularContadores } from "./envio.js";
import { normalizarBloques } from "./bloques.js";
import { madridToday } from "../utils/madridDate.js";

/**
 * lib/mailing/secuencias.js — los correos que salen SOLOS cuando pasa algo en
 * el CRM (sprint 2, 06/09/2026): bienvenida al alta, cumpleaños, «hace seis
 * meses de tu última cita».
 *
 * (Fichero nuevo en /lib, regla #2: lo llaman el temporizador
 * `scripts/enviar-mailing.js` —que es quien las dispara— y los endpoints que
 * enseñan «a quién le tocaría hoy». La regla de quién entra tiene que ser una.)
 *
 * ── CÓMO SE DISPARA SIN DUPLICAR ────────────────────────────────────────────
 * Cada secuencia tiene una campaña AUTOMÁTICA por periodo
 * (`mailing_campaigns.sequence_id` + `periodo`, UNIQUE): la bienvenida usa un
 * solo periodo para siempre, los cumpleaños y «sin cita» uno por año. Los
 * destinatarios del día se meten en `mailing_sends` de esa campaña con
 * `ignoreDuplicates`, así que el UNIQUE (campaign_id, email) del sprint 1 es lo
 * que garantiza que nadie recibe dos veces la misma secuencia en el mismo
 * periodo aunque el temporizador pase sesenta veces al día. El envío en sí es
 * `avanzarCampana`, el mismo motor que una campaña normal: mismos enlaces de
 * baja, misma supresión, mismas métricas.
 *
 * ── QUÉ NO HACE ─────────────────────────────────────────────────────────────
 * · No barre el histórico al encender: solo cuenta lo que ocurre a partir de
 *   `activada_desde` (una bienvenida no llega a las familias de hace tres años)
 *   y, para «sin cita», solo los que cruzan el umbral en los últimos 30 días.
 * · No escribe a correos sueltos: no tienen ficha, ni alta, ni citas.
 * · No decide por su cuenta la hora: sale a partir de `hora` (Madrid).
 */

export const EVENTOS = {
  alta: {
    label: "Bienvenida al alta",
    ayuda: "Sale a las fichas nuevas, tantos días después de crearse como se indique (0 = el mismo día).",
    diasPorDefecto: 1,
    usaDias: true,
    etiquetaDias: "días después del alta",
  },
  cumpleanos: {
    label: "Cumpleaños",
    ayuda: "Sale el día del cumpleaños de la ficha (su fecha de nacimiento), una vez al año.",
    diasPorDefecto: 0,
    usaDias: false,
    etiquetaDias: null,
  },
  sin_cita: {
    label: "Hace tiempo que no viene",
    ayuda: "Sale cuando la última cita (no cancelada ni falta) cumple los días indicados. Una vez al año como mucho por persona.",
    diasPorDefecto: 180,
    usaDias: true,
    etiquetaDias: "días desde la última cita",
  },
};
export const EVENTOS_KEYS = Object.keys(EVENTOS);

/** Hora (0-23) de Madrid de un instante. */
export function horaMadrid(ahora = new Date()) {
  const h = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", hour: "2-digit", hour12: false }).format(ahora);
  return Number(h) % 24;
}

/** El periodo de la campaña automática: uno para siempre, o el año. PURO. */
export function periodoDe(evento, ahora = new Date()) {
  if (evento === "alta") return "unica";
  return madridToday(ahora).slice(0, 4);
}

/** `MM-DD` de hoy en Madrid, para casar cumpleaños. */
function mesDiaHoy(ahora) {
  return madridToday(ahora).slice(5);
}

/** `MM-DD` de una fecha de nacimiento DATEONLY ("YYYY-MM-DD" o Date). */
export function mesDiaDe(birthDate) {
  if (!birthDate) return null;
  const s = birthDate instanceof Date ? birthDate.toISOString().slice(0, 10) : String(birthDate).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.slice(5) : null;
}

/**
 * ¿Le toca hoy a esta ficha? PURO. `datos` = { createdAt, birthDate, ultimaCita }.
 * `activadaDesde` corta el histórico; `ahora` es el instante de la pasada.
 */
export function cumpleEvento(seq, datos, ahora = new Date()) {
  const dias = Math.max(0, Number(seq.dias) || 0);
  const desde = seq.activadaDesde ? new Date(seq.activadaDesde).getTime() : 0;
  const t = ahora.getTime();
  const DIA = 86400000;
  if (seq.evento === "alta") {
    const creado = datos.createdAt ? new Date(datos.createdAt).getTime() : null;
    if (!creado || creado < desde) return false;
    const vence = creado + dias * DIA;
    // Le toca desde que cumple los días y hasta 30 días después (si el
    // temporizador estuvo parado, no se pierde; si pasó un mes, ya no procede).
    return vence <= t && vence >= t - 30 * DIA;
  }
  if (seq.evento === "cumpleanos") {
    const md = mesDiaDe(datos.birthDate);
    if (!md) return false;
    const hoy = mesDiaHoy(ahora);
    // El 29 de febrero se felicita el 28 en los años sin él.
    if (md === "02-29" && hoy === "02-28" && !mesDiaHoy(new Date(t + DIA)).startsWith("02")) return true;
    return md === hoy;
  }
  if (seq.evento === "sin_cita") {
    const ultima = datos.ultimaCita ? new Date(datos.ultimaCita).getTime() : null;
    if (!ultima) return false;
    const umbral = ultima + dias * DIA;
    return umbral <= t && umbral >= Math.max(desde, t - 30 * DIA);
  }
  return false;
}

/**
 * Quién recibiría la secuencia en el instante `ahora` (sin mirar la hora ni
 * lo ya enviado). Devuelve destinatarios de la audiencia con sus datos.
 */
export async function candidatosDeSecuencia(ctx, seq, { ahora = new Date() } = {}) {
  if (!ctx.tenantModels.Client) return [];
  const base = await resolverAudiencia(ctx, { fuentes: ["clientes"] }, { conClientes: ctx.tenantHasModule?.("clients") ?? true });
  const clientes = base.destinatarios.filter((d) => d.origen === "cliente");
  if (!clientes.length) return [];
  const ids = clientes.map((d) => d.origenId);
  const filas = await ctx.tenantModels.Client.findAll({
    where: { id: { [Op.in]: ids } },
    attributes: ["id", "createdAt", "birthDate"],
    raw: true,
  });
  const datos = new Map(filas.map((f) => [f.id, f]));
  const ultimas = seq.evento === "sin_cita" ? await ultimasCitasPorCliente(ctx, ids) : new Map();
  return clientes.filter((d) => {
    const f = datos.get(d.origenId);
    if (!f) return false;
    return cumpleEvento(seq, { createdAt: f.createdAt, birthDate: f.birthDate, ultimaCita: ultimas.get(d.origenId) ?? null }, ahora);
  });
}

/** La campaña automática del periodo, creada si no existe, con el contenido al día. */
export async function campanaDeSecuencia(ctx, seq, periodo) {
  const { MailingCampaign } = ctx.tenantModels;
  const contenido = {
    nombre: `${seq.nombre} · ${periodo === "unica" ? "automática" : periodo}`.slice(0, 160),
    asunto: seq.asunto,
    preheader: seq.preheader,
    bloques: normalizarBloques(seq.bloques),
    replyTo: seq.replyTo,
  };
  const [campana, creada] = await MailingCampaign.findOrCreate({
    where: { sequenceId: seq.id, periodo },
    defaults: { ...contenido, tipo: "secuencia", audiencia: "todos", estado: "enviada", createdBy: seq.createdBy ?? null },
  });
  if (!creada) await campana.update(contenido);
  return campana;
}

/**
 * Una pasada del temporizador para un tenant: por cada secuencia activa cuya
 * hora haya llegado, mete a los candidatos del día en su campaña automática y
 * avanza el envío. Devuelve un resumen por secuencia.
 */
export async function procesarSecuencias(ctx, { ahora = new Date(), base = null, presupuestoMs = 40000 } = {}) {
  const { MailingSequence, MailingSend } = ctx.tenantModels;
  const inicio = Date.now();
  const activas = await MailingSequence.findAll({ where: { activa: true } });
  const resumen = [];
  for (const seq of activas) {
    if (Date.now() - inicio > presupuestoMs) break;
    const r = { id: seq.id, nombre: seq.nombre, evento: seq.evento, candidatos: 0, nuevos: 0, enviados: 0, motivo: null };
    resumen.push(r);
    if (horaMadrid(ahora) < (Number(seq.hora) || 0)) {
      r.motivo = "todavía no es la hora";
      continue;
    }
    const lista = campanaLista({ asunto: seq.asunto, bloques: seq.bloques });
    if (!lista.ok) {
      r.motivo = lista.motivo;
      continue;
    }
    const candidatos = await candidatosDeSecuencia(ctx, seq, { ahora });
    r.candidatos = candidatos.length;
    const campana = await campanaDeSecuencia(ctx, seq, periodoDe(seq.evento, ahora));
    if (candidatos.length) {
      const creadas = await MailingSend.bulkCreate(
        candidatos.map((d) => ({ campaignId: campana.id, email: d.email, nombre: d.nombre, origen: d.origen, origenId: d.origenId, estado: "pendiente" })),
        { ignoreDuplicates: true }
      );
      r.nuevos = creadas.length;
    }
    const contadores = await recalcularContadores(ctx, campana);
    if (contadores.pendientes > 0) {
      if (campana.estado !== "enviando") await campana.update({ estado: "enviando", empezadaAt: campana.empezadaAt ?? new Date(), terminadaAt: null });
      const lote = await avanzarCampana(ctx, campana, { lote: 100, base, presupuestoMs: Math.max(1000, presupuestoMs - (Date.now() - inicio)) });
      r.enviados = lote.enviados;
    }
  }
  return resumen;
}

/** Histórico de una secuencia: sus campañas automáticas con contadores. */
export async function historialDeSecuencia(ctx, seq) {
  const { MailingCampaign } = ctx.tenantModels;
  const campanas = await MailingCampaign.findAll({ where: { sequenceId: seq.id }, order: [["createdAt", "DESC"]] });
  return campanas.map((c) => ({
    id: c.id,
    periodo: c.periodo,
    estado: c.estado,
    totalDestinatarios: c.totalDestinatarios,
    enviados: c.enviados,
    fallidos: c.fallidos,
    suprimidos: c.suprimidos,
    empezadaAt: c.empezadaAt,
    terminadaAt: c.terminadaAt,
  }));
}
