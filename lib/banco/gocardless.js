/**
 * Cliente de GoCardless Bank Account Data — la puerta PSD2 al banco de verdad.
 *
 * POR QUÉ ESTE AGREGADOR (29/08/2026): la banca online española no da un enlace
 * estable por movimiento al que llevar al usuario, así que «un botón al banco»
 * solo puede ser traerse los MOVIMIENTOS al CRM y enseñarlos aquí. Para eso
 * hace falta un agregador PSD2, y GoCardless Bank Account Data (la antigua
 * Nordigen) es el único con capa gratuita y cubre la banca española (BBVA,
 * Santander, CaixaBank, Sabadell…). Sin SDK: es una API REST pequeña y el
 * `fetch` de Node llega de sobra.
 *
 * SOLO LECTURA por diseño: el scope que se pide es balances/details/transactions.
 * Con estas credenciales no se puede ordenar un pago.
 *
 * ── EL FLUJO, EN CUATRO PASOS ───────────────────────────────────────────────
 *   1. token   POST /token/new/            (secret_id + secret_key → 24 h)
 *   2. alta    POST /agreements/enduser/ + POST /requisitions/ → link
 *              El usuario va a ESE link, se identifica EN SU BANCO y consiente.
 *   3. vuelta  GET /requisitions/{id} → las cuentas concedidas
 *   4. datos   GET /accounts/{id}/transactions/ → los movimientos
 *
 * El consentimiento PSD2 caduca (90 días por norma): entonces las llamadas de
 * cuenta empiezan a fallar y hay que repetir el paso 2. Y OJO con el ritmo: los
 * bancos limitan las consultas POR CUENTA Y DÍA (el 429 de aquí abajo), así que
 * la sincronización se lanza a mano y con freno, nunca en bucle.
 */

import { AppError } from "../utils/errors.js";
import { getTenantGocardlessConfig } from "./gocardlessConfig.js";

const BASE = "https://bankaccountdata.gocardless.com/api/v2";

// Token de acceso por secret_id, en memoria del proceso (dura 24 h; se cachea
// 23 para no pedir uno por llamada). Mapa module-level como la caché de tenant.
const tokens = new Map();

async function llamar(path, { method = "GET", body = null, token = null } = {}) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        accept: "application/json",
        ...(body ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new AppError(`No se pudo hablar con GoCardless: ${err.message}`, 502);
  }

  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }

  if (!res.ok) {
    // Los mensajes de GoCardless vienen en summary/detail; se traduce lo que
    // una persona puede arreglar y se deja el detalle para el log.
    const detalle = json?.summary ?? json?.detail ?? `HTTP ${res.status}`;
    if (res.status === 401) {
      throw new AppError("GoCardless rechaza las credenciales del banco: revisa el Secret ID y la Secret Key en Configuración.", 502);
    }
    if (res.status === 429) {
      throw new AppError(
        "El banco limita cuántas veces al día se pueden pedir los movimientos y ya se ha llegado al tope. Vuelve a sincronizar mañana.",
        429
      );
    }
    throw new AppError(`GoCardless respondió ${res.status}: ${detalle}`, 502);
  }
  return json;
}

async function tokenDeAcceso(ctx) {
  const { secretId, secretKey, configured } = getTenantGocardlessConfig(ctx);
  if (!configured) {
    // Mismo patrón que la IA: sin clave → 503, nunca la clave de otro.
    throw new AppError("El banco no está configurado: faltan las credenciales de GoCardless en Configuración.", 503);
  }

  const enCache = tokens.get(secretId);
  if (enCache && enCache.caducaEn > Date.now()) return enCache.access;

  const json = await llamar("/token/new/", { method: "POST", body: { secret_id: secretId, secret_key: secretKey } });
  if (!json?.access) throw new AppError("GoCardless no devolvió un token de acceso.", 502);
  tokens.set(secretId, { access: json.access, caducaEn: Date.now() + 23 * 60 * 60 * 1000 });
  return json.access;
}

/** Los bancos disponibles de un país (por defecto, España). */
export async function listarBancos(ctx, pais = "es") {
  const token = await tokenDeAcceso(ctx);
  const lista = await llamar(`/institutions/?country=${encodeURIComponent(pais)}`, { token });
  return (Array.isArray(lista) ? lista : []).map((b) => ({
    id: b.id,
    nombre: b.name,
    logo: b.logo ?? null,
    // Cuántos días de historial deja pedir ese banco (varía por entidad).
    diasHistorico: Number(b.transaction_total_days) || 90,
  }));
}

/**
 * Abre el alta de una conexión: crea el acuerdo (solo lectura, 90 días) y la
 * requisición, y devuelve el enlace AL BANCO al que hay que mandar al usuario.
 * `redirect` es a dónde vuelve cuando termina (nuestra pantalla de Banco).
 */
export async function crearRequisicion(ctx, { institutionId, redirect, reference, diasHistorico = 90 }) {
  const token = await tokenDeAcceso(ctx);

  const acuerdo = await llamar("/agreements/enduser/", {
    method: "POST",
    token,
    body: {
      institution_id: institutionId,
      // Nunca más de lo que el banco permite; 90 es el suelo común en España.
      max_historical_days: Math.max(1, Math.min(diasHistorico, 90)),
      access_valid_for_days: 90,
      access_scope: ["balances", "details", "transactions"],
    },
  });

  const req = await llamar("/requisitions/", {
    method: "POST",
    token,
    body: {
      redirect,
      institution_id: institutionId,
      reference,
      agreement: acuerdo?.id,
      user_language: "ES",
    },
  });

  if (!req?.id || !req?.link) throw new AppError("GoCardless no devolvió el enlace de conexión.", 502);
  return { id: req.id, link: req.link, agreementId: acuerdo?.id ?? null };
}

/** El estado de una requisición y sus cuentas concedidas. */
export async function verRequisicion(ctx, requisitionId) {
  const token = await tokenDeAcceso(ctx);
  return await llamar(`/requisitions/${encodeURIComponent(requisitionId)}/`, { token });
}

/** El nombre de un banco por su id. Best-effort: sin él, la cuenta se conecta igual. */
export async function nombreDelBanco(ctx, institutionId) {
  if (!institutionId) return null;
  try {
    const token = await tokenDeAcceso(ctx);
    const b = await llamar(`/institutions/${encodeURIComponent(institutionId)}/`, { token });
    return b?.name ?? null;
  } catch {
    return null;
  }
}

/**
 * Cuándo caduca el consentimiento de un acuerdo. Se calcula con LOS DATOS DE
 * GOCARDLESS (aceptado + días concedidos), nunca inventado aquí — el mismo
 * criterio que el `capture_before` de Stripe. Sin datos, null.
 */
export async function caducidadDelAcuerdo(ctx, agreementId) {
  if (!agreementId) return null;
  try {
    const token = await tokenDeAcceso(ctx);
    const a = await llamar(`/agreements/enduser/${encodeURIComponent(agreementId)}/`, { token });
    const aceptado = a?.accepted ? new Date(a.accepted) : null;
    const dias = Number(a?.access_valid_for_days) || null;
    if (!aceptado || Number.isNaN(aceptado.getTime()) || !dias) return null;
    return new Date(aceptado.getTime() + dias * 24 * 60 * 60 * 1000);
  } catch {
    // La caducidad es informativa: sin ella la cuenta funciona igual, solo que
    // el aviso de «toca reconectar» no podrá adelantarse.
    return null;
  }
}

/** Los datos identificativos de una cuenta (iban, banco) + sus detalles. */
export async function datosDeCuenta(ctx, accountUid) {
  const token = await tokenDeAcceso(ctx);
  const cuenta = await llamar(`/accounts/${encodeURIComponent(accountUid)}/`, { token });
  let detalles = null;
  try {
    const d = await llamar(`/accounts/${encodeURIComponent(accountUid)}/details/`, { token });
    detalles = d?.account ?? null;
  } catch {
    // Los detalles son el nombre bonito y la divisa: si el banco no los da,
    // la cuenta se conecta igual con su IBAN.
  }
  return {
    uid: cuenta?.id ?? accountUid,
    iban: cuenta?.iban ?? detalles?.iban ?? null,
    institutionId: cuenta?.institution_id ?? null,
    status: cuenta?.status ?? null,
    nombre: detalles?.name ?? detalles?.ownerName ?? null,
    divisa: detalles?.currency ?? null,
  };
}

/**
 * Los movimientos de una cuenta desde una fecha ('YYYY-MM-DD'). Devuelve solo
 * los CONTABILIZADOS (`booked`): los pendientes no tienen id estable y
 * duplicarían al consolidarse.
 */
export async function transaccionesDeCuenta(ctx, accountUid, { desde = null } = {}) {
  const token = await tokenDeAcceso(ctx);
  const qs = desde ? `?date_from=${encodeURIComponent(desde)}` : "";
  const json = await llamar(`/accounts/${encodeURIComponent(accountUid)}/transactions/${qs}`, { token });
  const booked = json?.transactions?.booked;
  return Array.isArray(booked) ? booked : [];
}
