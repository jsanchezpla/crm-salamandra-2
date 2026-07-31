/**
 * Cliente de la GraphQL Analytics API de Cloudflare (dataset RUM).
 *
 * De dónde salen los datos: del beacon cookieless de Cloudflare Web Analytics
 * que va incrustado en la web del cliente. Cloudflare NO identifica visitantes
 * (por eso no hace falta banner de cookies), así que TODO lo que devuelve este
 * módulo es AGREGADO: "120 visitas desde Alemania", nunca "quién". Cualquier
 * lectura del estilo "esta empresa entró el martes" es imposible por diseño y
 * no se debe insinuar en la interfaz.
 *
 * Por qué una sola petición: se piden todos los cortes (total, serie diaria,
 * países, páginas, referrers, dispositivos, navegadores) en un único documento
 * GraphQL con alias. Cloudflare limita la frecuencia de llamadas, y siete
 * peticiones por pantalla se comerían ese margen sin ganar nada.
 *
 * Por qué los filtros van interpolados y no como variables: el nombre de los
 * tipos de entrada de Cloudflare (`...Filter_InputObject`) varía según el
 * ámbito, y declararlos mal hace fallar la consulta entera. Interpolar es
 * seguro AQUÍ porque los tres valores que entran están validados con expresión
 * regular antes (hex de 32 y fechas YYYY-MM-DD); nada que venga del usuario
 * llega crudo a la cadena.
 */

// Desde errorTypes.js: este módulo lo usa también scripts/check-cloudflare-analytics.js
// desde línea de comandos, donde `next/server` no se puede resolver.
import { AppError } from "../utils/errorTypes.js";

const ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";
const HEX32 = /^[0-9a-f]{32}$/i;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

// Cloudflare permite hasta 10.000 filas por grupo. Los topes de aquí son los
// que caben en pantalla con sentido; el ranking de países sube a 300 porque el
// mapa los pinta todos.
const TOPE_PAISES = 300;
const TOPE_LISTAS = 25;
const TOPE_SERIE = 400;

/**
 * Extiende AppError A PROPÓSITO: `handleRouteError` solo conserva el mensaje de
 * los AppError; cualquier otro error se convierte en "Error interno del
 * servidor" en producción. Y aquí el mensaje ES el valor — "Cloudflare rechazó
 * el token" y "falta el permiso Account Analytics" son cosas que el
 * administrador tiene que poder leer en pantalla para arreglarlas él mismo.
 */
export class CloudflareAnalyticsError extends AppError {
  constructor(message, { status = 502, detalle = null } = {}) {
    super(message, status);
    this.name = "CloudflareAnalyticsError";
    this.detalle = detalle;
  }
}

/**
 * Días hacia atrás que Cloudflare conserva de verdad en el dataset RUM.
 *
 * Medido contra producción el 2026-07-31, no sacado de la documentación: con el
 * inicio del rango a 7 días o menos del día de hoy salen los datos; a 8 o más,
 * la consulta devuelve CERO FILAS. Y no da error — responde HTTP 200 con la
 * lista vacía, indistinguible de "esta web no ha tenido visitas".
 *
 * Se comprobó además que NO es un límite de anchura del rango: un rango de 31
 * días funciona perfectamente mientras empiece dentro de la ventana retenida.
 * Lo que caduca es el dato antiguo, no la consulta larga.
 *
 * Puede depender del plan de Cloudflare (esta cuenta es la gratuita), así que
 * en vez de prohibir los rangos largos se recortan y se avisa: si algún día la
 * cuenta pasa a un plan con más retención, subir esta constante es todo.
 */
export const MAX_DIAS_RUM = 7;

/**
 * Recorta el inicio del rango a la ventana que Cloudflare conserva.
 *
 * Devuelve el `desde` que se va a consultar de verdad y, si hubo recorte, los
 * datos para poder decírselo a quien mira la pantalla. Callar el recorte sería
 * repetir el mismo fallo que se está arreglando: enseñar un número que no
 * corresponde al periodo que el usuario cree haber pedido.
 */
function recortarAlRetenido(desde, hasta) {
  if (!FECHA.test(desde) || !FECHA.test(hasta)) return { desde, recorte: null };

  const finMs = Date.parse(`${hasta}T00:00:00Z`);
  const minMs = finMs - MAX_DIAS_RUM * 86400000;
  const desdeMs = Date.parse(`${desde}T00:00:00Z`);
  if (!(desdeMs < minMs)) return { desde, recorte: null };

  const desdeEfectivo = new Date(minMs).toISOString().slice(0, 10);
  return {
    desde: desdeEfectivo,
    recorte: { pedido: desde, aplicado: desdeEfectivo, maxDias: MAX_DIAS_RUM },
  };
}

function construirFiltro({ desde, hasta, siteTag }) {
  if (!FECHA.test(desde) || !FECHA.test(hasta)) {
    throw new CloudflareAnalyticsError("Rango de fechas inválido", { status: 400 });
  }
  // OJO: se filtra por `datetime`, NO por `date`.
  //
  // El dataset RUM admite `date_geq`/`date_leq` en la sintaxis —Cloudflare los
  // acepta y responde HTTP 200 sin un solo error— pero **no casan ninguna fila**:
  // devuelven la lista vacía siempre. Es el peor fallo posible, porque no se
  // distingue de "esta web no ha tenido visitas": el CRM enseñaba ceros con la
  // credencial bien puesta y la conexión funcionando.
  //
  // Comprobado contra producción el 2026-07-31: con `date_geq/date_leq`, cero
  // filas; con `datetime_geq/datetime_leq` y el MISMO rango, las 5 visitas que
  // enseñaba el panel de Cloudflare en ese momento.
  //
  // `date` sigue valiendo como DIMENSIÓN para agrupar la serie por días; lo que
  // no vale es como filtro.
  const partes = [
    `datetime_geq: "${desde}T00:00:00Z"`,
    `datetime_leq: "${hasta}T23:59:59Z"`,
  ];
  if (siteTag) {
    if (!HEX32.test(siteTag)) {
      throw new CloudflareAnalyticsError("Identificador de sitio inválido", { status: 400 });
    }
    partes.push(`siteTag: "${siteTag}"`);
  }
  return `{ ${partes.join(", ")} }`;
}

function construirConsulta({ accountId, filtro }) {
  if (!HEX32.test(accountId)) {
    throw new CloudflareAnalyticsError("Identificador de cuenta inválido", { status: 400 });
  }

  // `count` = páginas vistas (un evento de carga por página).
  // `sum { visits }` = visitas (sesiones); es la métrica que se enseña arriba.
  return `
    query AnaliticasCRM {
      viewer {
        accounts(filter: { accountTag: "${accountId}" }) {
          total: rumPageloadEventsAdaptiveGroups(filter: ${filtro}, limit: 1) {
            count
            sum { visits }
          }
          serie: rumPageloadEventsAdaptiveGroups(
            filter: ${filtro}, limit: ${TOPE_SERIE}, orderBy: [date_ASC]
          ) {
            count
            sum { visits }
            dimensions { date }
          }
          paises: rumPageloadEventsAdaptiveGroups(
            filter: ${filtro}, limit: ${TOPE_PAISES}, orderBy: [sum_visits_DESC]
          ) {
            count
            sum { visits }
            dimensions { countryName }
          }
          paginas: rumPageloadEventsAdaptiveGroups(
            filter: ${filtro}, limit: ${TOPE_LISTAS}, orderBy: [count_DESC]
          ) {
            count
            sum { visits }
            dimensions { requestPath }
          }
          referrers: rumPageloadEventsAdaptiveGroups(
            filter: ${filtro}, limit: ${TOPE_LISTAS}, orderBy: [sum_visits_DESC]
          ) {
            count
            sum { visits }
            dimensions { refererHost }
          }
          dispositivos: rumPageloadEventsAdaptiveGroups(
            filter: ${filtro}, limit: ${TOPE_LISTAS}, orderBy: [sum_visits_DESC]
          ) {
            count
            sum { visits }
            dimensions { deviceType }
          }
          navegadores: rumPageloadEventsAdaptiveGroups(
            filter: ${filtro}, limit: ${TOPE_LISTAS}, orderBy: [sum_visits_DESC]
          ) {
            count
            sum { visits }
            dimensions { userAgentBrowser }
          }
        }
      }
    }
  `;
}

const visitasDe = (fila) => Number(fila?.sum?.visits ?? 0);
const vistasDe = (fila) => Number(fila?.count ?? 0);

// Cloudflare devuelve la dimensión de país como código ISO alpha-2 ("DE"), que
// es justo la clave del mapa. Lo que no reconoce lo manda como "" — se muestra
// aparte en vez de tirarlo, para que los totales cuadren con la suma de la lista.
function normalizarPais(valor) {
  const codigo = typeof valor === "string" ? valor.trim().toUpperCase() : "";
  return /^[A-Z]{2}$/.test(codigo) ? codigo : null;
}

function listaSimple(filas, campo, { metrica = "visitas" } = {}) {
  return (filas ?? [])
    .map((f) => ({
      clave: (f?.dimensions?.[campo] ?? "").trim(),
      visitas: visitasDe(f),
      vistas: vistasDe(f),
    }))
    .filter((f) => (metrica === "visitas" ? f.visitas > 0 : f.vistas > 0));
}

/**
 * Consulta el dataset RUM y devuelve los cortes ya normalizados.
 *
 * Lanza CloudflareAnalyticsError con el mensaje TAL CUAL lo dio Cloudflare
 * cuando la API responde con errores: si algún día cambian un nombre de campo,
 * el administrador tiene que poder leer el motivo en pantalla en vez de un
 * "algo ha fallado" que no lleva a ningún sitio.
 */
export async function consultarRum({ token, accountId, siteTag, desde, hasta, signal }) {
  const { desde: desdeEfectivo, recorte } = recortarAlRetenido(desde, hasta);
  const filtro = construirFiltro({ desde: desdeEfectivo, hasta, siteTag });
  const query = construirConsulta({ accountId, filtro });

  let respuesta;
  try {
    respuesta = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
      signal,
    });
  } catch (err) {
    throw new CloudflareAnalyticsError("No se pudo contactar con Cloudflare", {
      status: 504,
      detalle: err?.message ?? null,
    });
  }

  if (respuesta.status === 401 || respuesta.status === 403) {
    throw new CloudflareAnalyticsError(
      "Cloudflare rechazó el token: comprueba que sigue activo y que tiene el permiso «Account Analytics: Read».",
      { status: 502 }
    );
  }

  let cuerpo;
  try {
    cuerpo = await respuesta.json();
  } catch {
    throw new CloudflareAnalyticsError("Cloudflare devolvió una respuesta ilegible", { status: 502 });
  }

  if (Array.isArray(cuerpo?.errors) && cuerpo.errors.length > 0) {
    const mensajes = cuerpo.errors.map((e) => e?.message).filter(Boolean).join(" · ");
    throw new CloudflareAnalyticsError(
      `Cloudflare rechazó la consulta: ${mensajes || "sin detalle"}`,
      { status: 502, detalle: mensajes || null }
    );
  }

  const cuenta = cuerpo?.data?.viewer?.accounts?.[0];
  if (!cuenta) {
    throw new CloudflareAnalyticsError(
      "El token no da acceso a esa cuenta de Cloudflare, o el identificador de cuenta no es el correcto.",
      { status: 502 }
    );
  }

  const total = cuenta.total?.[0] ?? null;

  const paisesCrudos = cuenta.paises ?? [];
  const paises = [];
  let visitasSinPais = 0;
  for (const fila of paisesCrudos) {
    const codigo = normalizarPais(fila?.dimensions?.countryName);
    const visitas = visitasDe(fila);
    if (visitas <= 0) continue;
    if (!codigo) {
      visitasSinPais += visitas;
      continue;
    }
    paises.push({ codigo, visitas, vistas: vistasDe(fila) });
  }
  paises.sort((a, b) => b.visitas - a.visitas);

  return {
    totales: {
      visitas: visitasDe(total),
      vistas: vistasDe(total),
    },
    serie: (cuenta.serie ?? [])
      .map((f) => ({
        fecha: f?.dimensions?.date ?? null,
        visitas: visitasDe(f),
        vistas: vistasDe(f),
      }))
      .filter((f) => f.fecha),
    paises,
    visitasSinPais,
    paginas: listaSimple(cuenta.paginas, "requestPath", { metrica: "vistas" }),
    referrers: listaSimple(cuenta.referrers, "refererHost"),
    dispositivos: listaSimple(cuenta.dispositivos, "deviceType"),
    navegadores: listaSimple(cuenta.navegadores, "userAgentBrowser"),
    // `null` salvo que se haya pedido más historia de la que Cloudflare guarda.
    // Quien pinte esto tiene que decirlo en pantalla: los números son del
    // periodo recortado, no del que se pidió.
    recorte,
  };
}
