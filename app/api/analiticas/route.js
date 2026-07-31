import { Op } from "sequelize";

import { withTenant } from "../../../lib/tenant/withTenant.js";
import { ok } from "../../../lib/utils/apiResponse.js";
import { ForbiddenError, ValidationError } from "../../../lib/utils/errors.js";
import { getTenantCloudflareConfig } from "../../../lib/analytics/cloudflareConfig.js";
import { consultarRum, MAX_DIAS_RUM } from "../../../lib/analytics/cloudflareRum.js";
import { consultarHistorico, primerDiaGuardado } from "../../../lib/analytics/historico.js";
import { cacheGet, cacheSet } from "../../../lib/tenant/tenantCache.js";
import { isDemoTenant } from "../../../lib/demo/isDemo.js";

/**
 * /api/analiticas — visitas de la web del cliente (Cloudflare Web Analytics).
 *
 * Solo lectura. No escribe en ninguna base de datos, no gasta IA y no manda
 * correos, así que no lleva guard de demo: el tenant `demo` sencillamente no
 * tiene credenciales de Cloudflare y recibe el estado "sin configurar", que es
 * exactamente lo que debe ver un visitante anónimo.
 *
 * Lo que NO hace, y conviene que siga siendo así: cruzar una visita con una
 * persona. Cloudflare entrega agregados anónimos (ver lib/analytics/cloudflareRum.js).
 * El cruce con leads que hay más abajo es por PAÍS y sobre totales, nunca
 * visita-a-lead.
 */

// Dos fuentes, una pantalla:
//
//   ≤ 7 días  → Cloudflare EN VIVO. Es lo único que Cloudflare conserva, y así
//               el día en curso sale al minuto, sin esperar a la captura.
//   > 7 días  → NUESTRA copia (tabla web_visits_daily), que llena a diario
//               scripts/capturar-visitas-web.js.
//
// El histórico largo solo tiene datos desde que se encendió la captura: lo
// anterior Cloudflare ya lo había tirado y no hay forma de recuperarlo. Por eso
// la respuesta incluye `historicoDesde`, para que la pantalla lo diga en vez de
// enseñar un vacío que parece una avería.
const RANGOS_VALIDOS = [1, 7, 30, 90, 180, 365];

// Cloudflare limita la frecuencia de llamadas y estos datos se mueven despacio
// (se agregan por día). Cinco minutos evitan machacar la API cuando alguien
// deja la pantalla abierta o cambia de rango adelante y atrás.
const TTL_CACHE_MS = 5 * 60 * 1000;

function rangoDeFechas(dias) {
  const hoy = new Date();
  const desde = new Date(hoy);
  desde.setUTCDate(desde.getUTCDate() - (dias - 1));
  const iso = (d) => d.toISOString().slice(0, 10);
  return { desde: iso(desde), hasta: iso(hoy) };
}

/**
 * Leads del CRM agrupados por país en el mismo periodo.
 *
 * El país sale de `customFields.pais`, que es lo que manda el formulario de la
 * web (un desplegable de códigos ISO alpha-2). Es un dato DECLARADO por quien
 * rellena el formulario, no deducido de su conexión: por eso se enseña en su
 * propia columna y no mezclado con las visitas de Cloudflare, que se miden de
 * otra manera. Compararlos es justo la gracia — "entran muchas visitas de
 * Italia pero no escribe nadie" — pero solo si están separados.
 */
async function leadsPorPais({ tenantModels, desde, hasta }) {
  const { Lead } = tenantModels;
  if (!Lead) return null;

  const inicio = new Date(`${desde}T00:00:00.000Z`);
  const fin = new Date(`${hasta}T23:59:59.999Z`);

  const filas = await Lead.findAll({
    attributes: ["customFields", "createdAt"],
    where: { createdAt: { [Op.between]: [inicio, fin] } },
    raw: true,
  });

  const conteo = new Map();
  let sinPais = 0;
  for (const fila of filas) {
    const bruto = fila?.customFields?.pais;
    const codigo = typeof bruto === "string" ? bruto.trim().toUpperCase() : "";
    if (/^[A-Z]{2}$/.test(codigo)) {
      conteo.set(codigo, (conteo.get(codigo) ?? 0) + 1);
    } else {
      sinPais += 1;
    }
  }

  return {
    total: filas.length,
    sinPais,
    porPais: [...conteo.entries()]
      .map(([codigo, leads]) => ({ codigo, leads }))
      .sort((a, b) => b.leads - a.leads),
  };
}

export const GET = withTenant(async (request, _routeContext, ctx) => {
  if (!ctx.hasModule("analytics")) {
    throw new ForbiddenError("El módulo de Analíticas no está disponible");
  }

  const url = new URL(request.url);
  const dias = Number(url.searchParams.get("dias") ?? 7);
  if (!RANGOS_VALIDOS.includes(dias)) {
    throw new ValidationError(`Rango no válido: usa ${RANGOS_VALIDOS.join(", ")} días`);
  }

  const config = getTenantCloudflareConfig(ctx);
  const { desde, hasta } = rangoDeFechas(dias);

  // ── La demo pública nunca habla con Cloudflare ─────────────────────────────
  //
  // La demo da sesión de ADMIN a visitantes anónimos, así que NO puede tener
  // credenciales de Cloudflare de nadie: sería el token de un cliente real
  // detrás de un enlace público. Pero sin credenciales la pantalla enseñaba el
  // "configura tu token", que como escaparate no vale nada — el visitante ve el
  // andamio en vez del producto.
  //
  // Solución: en la demo TODOS los rangos, cortos incluidos, salen de
  // `web_visits_daily`, que viene sembrada con datos inventados
  // (scripts/seed-analiticas-demo.js). Nadie llama a Cloudflare ni hace falta
  // ninguna clave.
  const demo = isDemoTenant(ctx);
  if (demo) {
    const claveDemo = `analiticas:${ctx.slug}:${dias}`;
    const cacheadoDemo = cacheGet(claveDemo);
    if (cacheadoDemo) return ok(cacheadoDemo);

    const historico = await consultarHistorico({ tenantModels: ctx.tenantModels, desde, hasta });
    let leadsDemo = null;
    if (ctx.tenantHasModule("leads") || ctx.tenantHasModule("sales")) {
      try {
        leadsDemo = await leadsPorPais({ tenantModels: ctx.tenantModels, desde, hasta });
      } catch (err) {
        console.error("[analiticas] cruce con leads fallido:", err?.message);
      }
    }

    const datosDemo = {
      configurado: true,
      siteTagInvalido: false,
      filtradoPorSitio: false,
      rango: { desde, hasta, dias },
      // `cloudflare` a propósito: la pantalla no debe enseñar el aviso de
      // "esto sale del histórico propio" en un escaparate.
      fuente: "cloudflare",
      historicoDesde: null,
      ...historico,
      leads: leadsDemo,
      actualizado: new Date().toISOString(),
    };

    cacheSet(claveDemo, datosDemo, TTL_CACHE_MS);
    return ok(datosDemo);
  }

  // Sin credenciales no es un error: es el estado inicial de un cliente al que
  // aún no le han puesto el token. La pantalla enseña las instrucciones.
  if (!config.configured) {
    return ok({
      configurado: false,
      siteTagInvalido: config.siteTagInvalido,
      faltaCuenta: !config.accountId,
      faltaToken: !config.token,
      rango: { desde, hasta, dias },
    });
  }

  const claveCache = `analiticas:${ctx.slug}:${dias}`;
  const cacheado = cacheGet(claveCache);
  if (cacheado) return ok(cacheado);

  // Rangos cortos: Cloudflare en vivo. Largos: nuestra copia diaria.
  const enVivo = dias <= MAX_DIAS_RUM;
  let historicoDesde = null;

  let rum;
  if (enVivo) {
    rum = await consultarRum({
      token: config.token,
      accountId: config.accountId,
      siteTag: config.siteTag,
      desde,
      hasta,
      signal: request.signal,
    });
  } else {
    rum = await consultarHistorico({ tenantModels: ctx.tenantModels, desde, hasta });
    historicoDesde = await primerDiaGuardado(ctx.tenantModels.WebVisitDaily);
  }

  // El cruce con leads es un extra: si el tenant no tiene el módulo comercial,
  // o si la consulta falla, la pantalla de visitas debe seguir funcionando.
  let leads = null;
  if (ctx.tenantHasModule("leads") || ctx.tenantHasModule("sales")) {
    try {
      leads = await leadsPorPais({ tenantModels: ctx.tenantModels, desde, hasta });
    } catch (err) {
      console.error("[analiticas] cruce con leads fallido:", err?.message);
    }
  }

  const datos = {
    configurado: true,
    siteTagInvalido: config.siteTagInvalido,
    filtradoPorSitio: !!config.siteTag,
    rango: { desde, hasta, dias },
    // De dónde salieron los números, y desde cuándo hay copia guardada.
    fuente: enVivo ? "cloudflare" : "historico",
    historicoDesde,
    ...rum,
    leads,
    actualizado: new Date().toISOString(),
  };

  cacheSet(claveCache, datos, TTL_CACHE_MS);
  return ok(datos);
});
