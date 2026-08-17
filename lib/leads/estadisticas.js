/**
 * lib/leads/estadisticas.js — las cifras de captación de un periodo.
 *
 * (Fichero nuevo en /lib, regla #2: lo comparten el endpoint y la pantalla, y
 * mañana el Excel si se pide. Contar en un solo sitio es lo que evita que la
 * cabecera diga 40 y la tabla de abajo sume 38.)
 *
 * Leads tiene DOS orígenes desde el 01/08/2026 y esta pantalla es su padre:
 *   PROFESIONALES → tabla `leads`, el embudo por etapas.
 *   COMERCIALES   → tabla `form_submissions`, lo que entra por la web.
 * Quien solo tenga el módulo `leads` verá solo la mitad, y está bien: el bloque
 * de comerciales devuelve `null` en vez de ceros, para no dibujar un embudo
 * vacío que parezca que algo va mal.
 *
 * Todo se cuenta LEYENDO las filas del periodo. No hay contadores guardados.
 */

import { Op } from "sequelize";
import { error, forbidden } from "../utils/apiResponse.js";
import { STAGE_LABELS } from "./stages.js";
import { GANADAS, PERDIDAS, tieneEtapaGanada } from "./embudos.js";

/**
 * A diferencia de las estadísticas del centro, esta NO es solo de dirección: el
 * grupo «Leads» del menú entra aquí, y quien trabaja el embudo tiene que poder
 * abrir su propia sección. Son sus leads, no la nómina de nadie.
 */
export function gateEstadisticas(ctx) {
  return ctx.hasModule("leads") ? null : forbidden("Módulo leads no activo");
}

/**
 * Fecha a 'AAAA-MM-DD' EN LOCAL. `toISOString()` pasa por UTC y en España resta
 * horas: el día 1 a las 00:00 se convierte en el último del mes anterior. Ya
 * mordió una vez en las estadísticas del centro.
 */
export function fechaISO(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

export function rangoDe(desde, hasta) {
  const inicio = new Date(`${String(desde).slice(0, 10)}T00:00:00`);
  const fin = new Date(`${String(hasta).slice(0, 10)}T23:59:59`);
  if (Number.isNaN(inicio.getTime()) || Number.isNaN(fin.getTime())) return null;
  if (inicio > fin) return null;
  return { inicio, fin };
}

/** Rango pedido en la URL, o los últimos 12 meses. */
export function rangoPedido(request) {
  const sp = new URL(request.url).searchParams;
  const hoy = new Date();
  const haceUnAnio = new Date(hoy.getFullYear(), hoy.getMonth() - 11, 1);
  const rango = rangoDe(sp.get("desde") || fechaISO(haceUnAnio), sp.get("hasta") || fechaISO(hoy));
  if (!rango) return { veto: error("Fechas inválidas: se espera desde/hasta en formato AAAA-MM-DD", 422) };
  return { rango };
}

const pct = (parte, total) => (total > 0 ? Math.round((parte / total) * 100) : null);

/** Clave 'AAAA-MM' local, para agrupar por mes sin pasar por UTC. */
const claveMes = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** Los meses del rango, en orden, aunque alguno esté vacío. */
function mesesDelRango({ inicio, fin }) {
  const out = [];
  const cursor = new Date(inicio.getFullYear(), inicio.getMonth(), 1);
  const tope = new Date(fin.getFullYear(), fin.getMonth(), 1);
  while (cursor <= tope && out.length < 60) {
    out.push({
      clave: claveMes(cursor),
      etiqueta: `${MESES[cursor.getMonth()]} ${String(cursor.getFullYear()).slice(2)}`,
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return out;
}

/** Bloque 1 — EL EMBUDO: leads profesionales por etapa y en qué acaban. */
function embudo(leads) {
  const porEtapa = new Map();
  let ganados = 0;
  let perdidos = 0;
  let conFicha = 0;

  for (const l of leads) {
    porEtapa.set(l.stage, (porEtapa.get(l.stage) ?? 0) + 1);
    if (GANADAS.has(l.stage)) ganados++;
    else if (PERDIDAS.has(l.stage)) perdidos++;
    if (l.clientId) conFicha++;
  }

  const cerrados = ganados + perdidos;
  return {
    total: leads.length,
    abiertos: leads.length - cerrados,
    ganados,
    perdidos,
    conFicha,
    // Sobre los CERRADOS, no sobre el total: contar los que aún se están
    // trabajando como fracasos hunde la cifra y no dice nada.
    conversion: pct(ganados, cerrados),
    etapas: [...porEtapa.entries()]
      .map(([clave, n]) => ({ clave, etiqueta: STAGE_LABELS[clave] ?? clave, n, pct: pct(n, leads.length) }))
      .sort((a, b) => b.n - a.n),
  };
}

/** Bloque 2 — DE DÓNDE VIENEN. */
function origenes(leads) {
  const m = new Map();
  for (const l of leads) {
    const k = (l.source || "").trim() || "Sin origen";
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()]
    .map(([origen, n]) => ({ origen, n, pct: pct(n, leads.length) }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 8);
}

/** Bloque 3 — LEADS COMERCIALES: la bandeja de la web. */
function comerciales(envios) {
  let pendientes = 0;
  let aceptadas = 0;
  let rechazadas = 0;
  for (const s of envios) {
    if (s.status === "accepted") aceptadas++;
    else if (s.status === "rejected") rechazadas++;
    else pendientes++;
  }
  const resueltas = aceptadas + rechazadas;

  // La pendiente más vieja: una bandeja con 3 pendientes de hace dos meses no
  // es «poco trabajo», es trabajo sin hacer, y en un total no se ve.
  const ahora = Date.now();
  const esperas = envios
    .filter((s) => s.status !== "accepted" && s.status !== "rejected")
    .map((s) => Math.floor((ahora - new Date(s.createdAt).getTime()) / 86400000));

  return {
    total: envios.length,
    pendientes,
    aceptadas,
    rechazadas,
    aceptacion: pct(aceptadas, resueltas),
    esperaMaxima: esperas.length ? Math.max(...esperas) : null,
  };
}

/** Bloque 4 — POR MES: cuánto entra por cada puerta. */
function porMes(rango, leads, envios) {
  const meses = mesesDelRango(rango);
  const idx = new Map(meses.map((m, i) => [m.clave, i]));
  const prof = new Array(meses.length).fill(0);
  const com = new Array(meses.length).fill(0);

  for (const l of leads) {
    const i = idx.get(claveMes(new Date(l.createdAt)));
    if (i != null) prof[i]++;
  }
  for (const s of envios) {
    const i = idx.get(claveMes(new Date(s.createdAt)));
    if (i != null) com[i]++;
  }
  return meses.map((m, i) => ({ ...m, profesionales: prof[i], comerciales: com[i] }));
}

/**
 * Calcula todo de una vez. `comerciales` viene a `null` cuando el tenant no
 * tiene el módulo: no es lo mismo «cero» que «esto no va contigo».
 */
export async function calcularEstadisticas(ctx, rango) {
  const { Lead, FormSubmission } = ctx.tenantModels;
  const enRango = { [Op.between]: [rango.inicio, rango.fin] };

  const leads = Lead
    ? await Lead.findAll({
        where: { createdAt: enRango },
        attributes: ["id", "stage", "source", "clientId", "createdAt"],
      })
    : [];

  const tieneComerciales = ctx.hasModule("formularios") && !!FormSubmission;
  const envios = tieneComerciales
    ? await FormSubmission.findAll({
        where: { createdAt: enRango },
        attributes: ["id", "status", "createdAt"],
      })
    : [];

  return {
    periodo: { desde: fechaISO(rango.inicio), hasta: fechaISO(rango.fin) },
    profesionales: {
      ...embudo(leads),
      origenes: origenes(leads),
      // «Con ficha creada» solo se cuenta donde hay fichas que crear: sin el
      // módulo Clientes un lead no puede convertirse en cliente, así que esa
      // cifra es un 0 clavado para siempre. Un cero grande en una pantalla de
      // estadísticas se lee como una avería, no como «esto no va contigo»: es
      // el mismo criterio que ya se sigue justo debajo con el bloque de
      // comerciales. Le pasaba a quality_energy y a abarcaia, que solo tienen
      // leads (10/08/2026).
      //
      // Se tacha AQUÍ y no dentro de `embudo()` a propósito: esa función se
      // deja contando igual que siempre —de ella salen el total, los abiertos
      // y la conversión— y aquí solo se decide si el número significa algo.
      ...(ctx.hasModule("clients") ? {} : { conFicha: null }),
      // Y lo mismo con «Convertidos» donde el embudo no tiene ninguna etapa de
      // ganado (17/08/2026). Le pasa a aumenta, demo y sandbox, que terminan en
      // Nuevo, Contactado y Descartado: ahí `ganados` es un 0 que no puede
      // subir nunca y la conversión un 0 % en cuanto alguien descarte a
      // alguien. Los dos números serían ciertos y engañarían igual, porque no
      // es que no conviertan — es que su embudo no tiene dónde apuntarlo.
      //
      // Se tacha AQUÍ y no dentro de `embudo()` por el mismo motivo que la
      // línea de arriba: esa función se deja contando igual que siempre —de
      // ella salen el total y los abiertos, que sí valen— y aquí solo se decide
      // si el número significa algo.
      ...(tieneEtapaGanada(ctx.tenant?.slug) ? {} : { ganados: null, conversion: null }),
    },
    comerciales: tieneComerciales ? comerciales(envios) : null,
    meses: porMes(rango, leads, envios),
  };
}
