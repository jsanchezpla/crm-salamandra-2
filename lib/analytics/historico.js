import { Op, fn, col, literal } from "sequelize";

/**
 * historico.js — lee las visitas de la web desde NUESTRA base de datos.
 *
 * Cloudflare solo conserva 7 días, así que todo rango más largo (un mes, un
 * trimestre, un año) sale de la copia diaria que guarda
 * `scripts/capturar-visitas-web.js` en la tabla `web_visits_daily`.
 *
 * Devuelve exactamente la MISMA forma que `consultarRum`, para que la pantalla
 * no tenga que saber de dónde vino el dato:
 *
 *   { totales, serie, paises, visitasSinPais, paginas, referrers,
 *     dispositivos, navegadores, recorte }
 */

const DIMENSIONES_LISTA = {
  paginas: "pagina",
  referrers: "referrer",
  dispositivos: "dispositivo",
  navegadores: "navegador",
};

// Cuántas filas se devuelven de cada desglose. Mismo criterio que la consulta
// en vivo: la pantalla enseña un top, no la lista entera.
const TOPE_LISTAS = 10;
const TOPE_PAISES = 250;

async function agregarPorValor(WebVisitDaily, dimension, { desde, hasta, limite, orden }) {
  const filas = await WebVisitDaily.findAll({
    attributes: [
      "valor",
      [fn("SUM", col("visitas")), "visitas"],
      [fn("SUM", col("vistas")), "vistas"],
    ],
    where: { dimension, fecha: { [Op.between]: [desde, hasta] } },
    group: ["valor"],
    order: [[literal(orden === "vistas" ? `SUM(vistas)` : `SUM(visitas)`), "DESC"]],
    limit: limite,
    raw: true,
  });

  return filas.map((f) => ({
    clave: f.valor,
    visitas: Number(f.visitas) || 0,
    vistas: Number(f.vistas) || 0,
  }));
}

/**
 * ¿Desde cuándo hay histórico guardado? Sirve para que la pantalla pueda decir
 * "el histórico empieza el X" en vez de enseñar un vacío que parece una caída.
 */
export async function primerDiaGuardado(WebVisitDaily) {
  const fila = await WebVisitDaily.findOne({
    attributes: [[fn("MIN", col("fecha")), "primera"]],
    raw: true,
  });
  return fila?.primera ?? null;
}

export async function consultarHistorico({ tenantModels, desde, hasta }) {
  const { WebVisitDaily } = tenantModels;

  const serieFilas = await WebVisitDaily.findAll({
    attributes: ["fecha", "visitas", "vistas"],
    where: { dimension: "total", fecha: { [Op.between]: [desde, hasta] } },
    order: [["fecha", "ASC"]],
    raw: true,
  });

  const serie = serieFilas.map((f) => ({
    fecha: typeof f.fecha === "string" ? f.fecha : new Date(f.fecha).toISOString().slice(0, 10),
    visitas: Number(f.visitas) || 0,
    vistas: Number(f.vistas) || 0,
  }));

  // Los totales se suman de la serie diaria, NO de las dimensiones de desglose:
  // los desgloses que da Cloudflare vienen agregados del rango y se guardan
  // atribuidos a un solo día, así que sumarlos daría un número distinto (y
  // menor) que el real. La serie es la fuente buena para los totales.
  const totales = serie.reduce(
    (acc, d) => ({ visitas: acc.visitas + d.visitas, vistas: acc.vistas + d.vistas }),
    { visitas: 0, vistas: 0 }
  );

  const paisesFilas = await agregarPorValor(WebVisitDaily, "pais", {
    desde,
    hasta,
    limite: TOPE_PAISES,
    orden: "visitas",
  });

  const [paginas, referrers, dispositivos, navegadores] = await Promise.all([
    agregarPorValor(WebVisitDaily, DIMENSIONES_LISTA.paginas, { desde, hasta, limite: TOPE_LISTAS, orden: "vistas" }),
    agregarPorValor(WebVisitDaily, DIMENSIONES_LISTA.referrers, { desde, hasta, limite: TOPE_LISTAS, orden: "visitas" }),
    agregarPorValor(WebVisitDaily, DIMENSIONES_LISTA.dispositivos, { desde, hasta, limite: TOPE_LISTAS, orden: "visitas" }),
    agregarPorValor(WebVisitDaily, DIMENSIONES_LISTA.navegadores, { desde, hasta, limite: TOPE_LISTAS, orden: "visitas" }),
  ]);

  return {
    totales,
    serie,
    paises: paisesFilas.map((p) => ({ codigo: p.clave, visitas: p.visitas, vistas: p.vistas })),
    visitasSinPais: 0,
    paginas,
    referrers,
    dispositivos,
    navegadores,
    recorte: null,
  };
}
