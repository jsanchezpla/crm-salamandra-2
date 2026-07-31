"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import HelpTooltip from "../../components/ui/HelpTooltip.jsx";
import { MAPA_VIEWBOX, MAPA_ALTO, MAPA_ANCHO, PAISES } from "./worldMap.js";

/**
 * Analíticas — de dónde vienen las visitas de la web del cliente.
 *
 * Los datos vienen de Cloudflare Web Analytics, que mide SIN cookies y SIN
 * identificar a nadie. Toda la pantalla habla por tanto de agregados: "120
 * visitas desde Alemania". Es importante que la interfaz no sugiera lo
 * contrario — de ahí la nota del pie y que en ningún sitio se hable de
 * "visitantes" en singular ni se ofrezca abrir el detalle de una visita.
 *
 * Los gráficos van en SVG a mano y el mapa es un fichero generado (worldMap.js):
 * el proyecto no tiene librería de gráficos y meter una obligaría a un deploy
 * completo con reinstalación de dependencias.
 */

const RANGOS = [
  { dias: 7, etiqueta: "7 días" },
  { dias: 30, etiqueta: "30 días" },
  { dias: 90, etiqueta: "90 días" },
];

const numero = new Intl.NumberFormat("es-ES");
const fmt = (n) => numero.format(Number(n ?? 0));

const NOMBRE_PAIS = (codigo) => PAISES[codigo]?.n ?? codigo;

function fechaCorta(iso) {
  if (!iso) return "";
  const [a, m, d] = iso.split("-");
  return `${d}/${m}${a ? "" : ""}`;
}

// ── Piezas pequeñas ─────────────────────────────────────────────────────────

function Kpi({ etiqueta, valor, pie, ayuda, cargando }) {
  return (
    <div className="bg-white border border-neutral-100 rounded-xl p-5">
      <div className="flex items-center gap-1.5 mb-2">
        <p className="text-[11px] font-medium text-neutral-400 uppercase tracking-widest">{etiqueta}</p>
        {ayuda && (
          <HelpTooltip title={etiqueta} placement="bottom">
            {ayuda}
          </HelpTooltip>
        )}
      </div>
      {cargando ? (
        <div className="h-8 w-20 bg-neutral-100 rounded animate-pulse" />
      ) : (
        <p
          className="text-3xl font-extrabold leading-none"
          style={{ fontFamily: "'Syne', sans-serif", color: "var(--color-primary)" }}
        >
          {valor}
        </p>
      )}
      {pie && !cargando && <p className="text-xs text-neutral-400 mt-1.5">{pie}</p>}
    </div>
  );
}

function Panel({ titulo, ayuda, children, acciones }) {
  return (
    <div className="bg-white border border-neutral-100 rounded-xl p-5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-1.5">
          <h2 className="text-sm font-semibold text-[var(--ink-900)]">{titulo}</h2>
          {ayuda && (
            <HelpTooltip title={titulo} placement="bottom">
              {ayuda}
            </HelpTooltip>
          )}
        </div>
        {acciones}
      </div>
      {children}
    </div>
  );
}

function ListaBarras({ items, vacio = "Sin datos en este periodo", sufijo = "visitas" }) {
  if (!items || items.length === 0) {
    return <p className="text-sm text-neutral-400 py-6 text-center">{vacio}</p>;
  }
  const max = Math.max(...items.map((i) => i.valor), 1);
  return (
    <ul className="space-y-2.5">
      {items.map((item) => (
        <li key={item.clave}>
          <div className="flex items-baseline justify-between gap-3 mb-1">
            <span className="text-sm text-[var(--ink-900)] truncate" title={item.etiqueta}>
              {item.etiqueta}
            </span>
            <span className="text-xs text-neutral-500 shrink-0 tabular-nums">
              {fmt(item.valor)} <span className="text-neutral-300">{sufijo}</span>
            </span>
          </div>
          <div className="h-1.5 bg-neutral-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.max(2, (item.valor / max) * 100)}%`,
                backgroundColor: "var(--color-primary)",
                opacity: 0.85,
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

// ── Serie temporal ──────────────────────────────────────────────────────────

function SerieVisitas({ serie }) {
  const [activo, setActivo] = useState(null);

  const { area, linea, puntos, max } = useMemo(() => {
    const W = 720;
    const H = 160;
    const n = serie.length;
    if (n === 0) return { area: "", linea: "", puntos: [], max: 0 };

    const maximo = Math.max(...serie.map((d) => d.visitas), 1);
    // Margen lateral: sin él, el primer y el último punto quedan cortados justo
    // en el borde del lienzo y el gráfico parece que se sale de la tarjeta.
    const PAD = 10;
    // Con un solo día no hay recta que trazar: se coloca en el centro para que
    // el punto no quede pegado al borde izquierdo.
    const x = (i) => (n === 1 ? W / 2 : PAD + (i / (n - 1)) * (W - PAD * 2));
    const y = (v) => H - (v / maximo) * (H - 12);

    const pts = serie.map((d, i) => ({ ...d, x: x(i), y: y(d.visitas) }));
    const l = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join("");
    const a = `${l}L${pts[pts.length - 1].x.toFixed(1)} ${H}L${pts[0].x.toFixed(1)} ${H}Z`;
    return { area: a, linea: l, puntos: pts, max: maximo };
  }, [serie]);

  if (serie.length === 0) {
    return <p className="text-sm text-neutral-400 py-10 text-center">Sin visitas en este periodo</p>;
  }

  return (
    <div className="relative">
      <svg viewBox="0 0 720 175" className="w-full h-40" preserveAspectRatio="none" role="img"
           aria-label={`Evolución de visitas, máximo ${max} en un día`}>
        <defs>
          <linearGradient id="se-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#se-area)" />
        <path d={linea} fill="none" stroke="var(--color-primary)" strokeWidth="2"
              strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {puntos.map((p) => (
          <g key={p.fecha}>
            {/* Franja invisible: da un objetivo cómodo al ratón sin ensuciar el trazo. */}
            <rect
              x={p.x - 720 / Math.max(puntos.length, 1) / 2}
              y="0"
              width={720 / Math.max(puntos.length, 1)}
              height="175"
              fill="transparent"
              onMouseEnter={() => setActivo(p)}
              onMouseLeave={() => setActivo(null)}
            />
            {activo?.fecha === p.fecha && (
              <circle cx={p.x} cy={p.y} r="3.5" fill="var(--color-primary)" stroke="#fff" strokeWidth="1.5"
                      vectorEffect="non-scaling-stroke" />
            )}
          </g>
        ))}
      </svg>

      <div className="flex justify-between text-[11px] text-neutral-400 mt-1">
        <span>{fechaCorta(serie[0]?.fecha)}</span>
        <span>{fechaCorta(serie[serie.length - 1]?.fecha)}</span>
      </div>

      {/* `left` en % del contenedor + `translateX(-50%)` para centrar el globo
          sobre el punto. Con transform a secas el porcentaje sería del ancho
          del propio globo, no del gráfico, y se quedaba clavado a la izquierda. */}
      {activo && (
        <div className="absolute top-0 pointer-events-none bg-[var(--ink-900)] text-white text-xs
                        rounded-lg px-2.5 py-1.5 shadow-lg whitespace-nowrap"
             style={{ left: `${(activo.x / 720) * 100}%`, transform: "translateX(-50%)" }}>
          <div className="font-medium">{fmt(activo.visitas)} visitas</div>
          <div className="text-white/60">{activo.fecha} · {fmt(activo.vistas)} páginas</div>
        </div>
      )}
    </div>
  );
}

// ── Mapa ────────────────────────────────────────────────────────────────────

function MapaVisitas({ paises, leadsPorPais }) {
  const [hover, setHover] = useState(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const contenedor = useRef(null);

  const porCodigo = useMemo(() => new Map(paises.map((p) => [p.codigo, p])), [paises]);
  const leads = useMemo(() => new Map((leadsPorPais ?? []).map((l) => [l.codigo, l.leads])), [leadsPorPais]);
  const max = useMemo(() => Math.max(...paises.map((p) => p.visitas), 1), [paises]);

  // Escala por raíz cuadrada: con un país dominante (lo normal en una web con
  // mercado local) una escala lineal deja el resto del mapa indistinguible del
  // fondo, y justo esos países pequeños son la información interesante.
  const intensidad = useCallback(
    (visitas) => (visitas <= 0 ? 0 : 0.18 + 0.82 * Math.sqrt(visitas / max)),
    [max]
  );

  const seguirRaton = useCallback((e) => {
    const caja = contenedor.current?.getBoundingClientRect();
    if (!caja) return;
    setPos({ x: e.clientX - caja.left, y: e.clientY - caja.top });
  }, []);

  return (
    <div ref={contenedor} className="relative" onMouseMove={seguirRaton}>
      <svg
        viewBox={MAPA_VIEWBOX}
        className="w-full h-auto"
        style={{ aspectRatio: `${MAPA_ANCHO} / ${MAPA_ALTO}` }}
        role="img"
        aria-label="Mapa mundial de visitas por país"
      >
        <rect width={MAPA_ANCHO} height={MAPA_ALTO} fill="#f7f9f8" />
        {Object.entries(PAISES).map(([codigo, pais]) => {
          const dato = porCodigo.get(codigo);
          const visitas = dato?.visitas ?? 0;
          const activo = hover === codigo;
          return (
            <path
              key={codigo}
              d={pais.d}
              fill={visitas > 0 ? "var(--color-primary)" : "#e4e9e7"}
              fillOpacity={visitas > 0 ? intensidad(visitas) : 1}
              stroke={activo ? "var(--ink-900)" : "#ffffff"}
              strokeWidth={activo ? 1.1 : 0.35}
              vectorEffect="non-scaling-stroke"
              onMouseEnter={() => setHover(codigo)}
              onMouseLeave={() => setHover(null)}
              style={{ cursor: visitas > 0 ? "default" : "default" }}
            >
              <title>{`${pais.n}: ${fmt(visitas)} visitas`}</title>
            </path>
          );
        })}
      </svg>

      {hover && (
        <div
          className="absolute pointer-events-none bg-[var(--ink-900)] text-white text-xs rounded-lg
                     px-2.5 py-1.5 shadow-lg whitespace-nowrap z-10"
          style={{ left: pos.x + 12, top: pos.y + 12 }}
        >
          <div className="font-medium">{NOMBRE_PAIS(hover)}</div>
          <div className="text-white/70">
            {fmt(porCodigo.get(hover)?.visitas ?? 0)} visitas
            {leads.has(hover) ? ` · ${fmt(leads.get(hover))} leads` : ""}
          </div>
        </div>
      )}

      {/* Leyenda */}
      <div className="flex items-center gap-2 mt-3 text-[11px] text-neutral-400">
        <span>Menos</span>
        <div className="flex-1 h-2 rounded-full max-w-[160px]"
             style={{ background: "linear-gradient(to right, color-mix(in srgb, var(--color-primary) 18%, transparent), var(--color-primary))" }} />
        <span>Más</span>
        <span className="ml-3 flex items-center gap-1.5">
          <span className="w-3 h-2 rounded-sm inline-block" style={{ backgroundColor: "#e4e9e7" }} />
          Sin visitas
        </span>
      </div>
    </div>
  );
}

// ── Estado sin credenciales ─────────────────────────────────────────────────

function SinConfigurar({ datos, esAdmin }) {
  return (
    <div className="bg-white border border-neutral-100 rounded-xl p-6 lg:p-8 max-w-2xl">
      <h2 className="text-base font-semibold text-[var(--ink-900)] mb-2">
        Falta conectar la cuenta de Cloudflare
      </h2>
      <p className="text-sm text-[var(--ink-500)] leading-relaxed mb-5">
        Las visitas las mide Cloudflare Web Analytics desde la propia web. Para que el CRM pueda leerlas
        hace falta un token de solo lectura.
        {datos?.faltaCuenta && !datos?.faltaToken && " Falta el identificador de cuenta."}
        {datos?.faltaToken && !datos?.faltaCuenta && " Falta el token."}
      </p>

      {esAdmin ? (
        <>
          <ol className="text-sm text-[var(--ink-500)] space-y-2.5 mb-6 list-decimal pl-5 leading-relaxed">
            <li>
              En Cloudflare, entra en <strong>Mi perfil → Tokens de API</strong> y pulsa
              {" "}<strong>Crear token → Crear token personalizado</strong>.
            </li>
            <li>
              Dale un permiso y solo uno: <strong>Cuenta · Analytics de Cloudflare Web · Lectura</strong>.
              En «Recursos de la cuenta» elige la cuenta de la web.
            </li>
            <li>Copia el token que sale al final (Cloudflare solo lo enseña una vez).</li>
            <li>
              El <strong>identificador de cuenta</strong> es el código que aparece en la dirección del panel
              de Cloudflare, justo después de <code className="text-xs bg-neutral-100 px-1 py-0.5 rounded">dash.cloudflare.com/</code>.
            </li>
            <li>
              Pega ambos en <strong>Configuración → Integraciones → Visitas de la web</strong>.
            </li>
          </ol>
          <a
            href="/configuracion"
            className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg text-white"
            style={{ backgroundColor: "var(--color-primary)" }}
          >
            Ir a Configuración
          </a>
        </>
      ) : (
        <p className="text-sm text-[var(--ink-500)]">
          Pídele a un administrador que lo conecte desde Configuración → Integraciones.
        </p>
      )}
    </div>
  );
}

// ── Pantalla ────────────────────────────────────────────────────────────────

export default function AnaliticasModule({ esAdmin = false }) {
  const [dias, setDias] = useState(30);

  // Un solo estado que lleva DE QUÉ RANGO son los datos que tiene. "Cargando"
  // se deduce de comparar ese rango con el pedido, en vez de ser una bandera
  // aparte que hay que subir y bajar a mano: así no se puede quedar
  // desincronizada, y el efecto no toca el estado hasta que la respuesta llega.
  const [resultado, setResultado] = useState({ dias: null, datos: null, error: null });

  const cargando = resultado.dias !== dias;
  const datos = cargando ? null : resultado.datos;
  const error = cargando ? null : resultado.error;

  useEffect(() => {
    let vivo = true;

    fetch(`/api/analiticas?dias=${dias}`)
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!vivo) return;
        if (!r.ok || !j.ok) {
          setResultado({ dias, datos: null, error: j.error || "No se pudieron cargar las analíticas" });
          return;
        }
        setResultado({ dias, datos: j.data, error: null });
      })
      .catch(() => {
        if (vivo) setResultado({ dias, datos: null, error: "No se pudo contactar con el servidor" });
      });

    return () => {
      vivo = false;
    };
  }, [dias]);

  const paises = datos?.paises ?? [];
  const totalVisitas = datos?.totales?.visitas ?? 0;
  const paisTop = paises[0] ?? null;
  const cuotaTop = totalVisitas > 0 && paisTop ? Math.round((paisTop.visitas / totalVisitas) * 100) : null;
  const leadsPorPais = datos?.leads?.porPais ?? null;
  const leadsMapa = useMemo(
    () => new Map((leadsPorPais ?? []).map((l) => [l.codigo, l.leads])),
    [leadsPorPais]
  );

  return (
    <div className="p-4 lg:p-8 max-w-6xl mx-auto">
      {/* Cabecera */}
      <div className="mb-6 lg:mb-8">
        <div className="eyebrow mb-1.5 lg:mb-2">Comercial · Analíticas</div>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl lg:text-4xl text-[var(--ink-900)] tracking-tight mb-3 flex items-center gap-2">
              <span>
                Analíticas <span className="font-display-italic text-[var(--ink-400)]">— de dónde vienen tus visitas</span>
              </span>
              <HelpTooltip title="Módulo de Analíticas" placement="bottom">
                Mide el tráfico de tu web: cuántas visitas llegan, desde qué países, a qué páginas y desde
                dónde vienen. La medición es anónima y sin cookies, así que verás cuántas visitas hay de cada
                país, pero nunca quién es cada visitante. Para saber quién, necesitas que rellene el
                formulario: eso llega a Leads.
              </HelpTooltip>
            </h1>
            <p className="text-sm text-[var(--ink-500)] max-w-xl leading-relaxed">
              Tráfico de la web medido sin cookies. Los datos se actualizan cada pocos minutos.
            </p>
          </div>

          {/* Selector de rango */}
          <div className="flex gap-1 bg-neutral-100 rounded-lg p-1 shrink-0">
            {RANGOS.map((r) => (
              <button
                key={r.dias}
                type="button"
                onClick={() => setDias(r.dias)}
                className={`text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${
                  dias === r.dias ? "bg-white shadow-sm text-[var(--ink-900)]" : "text-neutral-500 hover:text-neutral-700"
                }`}
              >
                {r.etiqueta}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-100 text-red-700 rounded-xl p-4 text-sm mb-6">
          <p className="font-medium mb-0.5">No se pudieron cargar las visitas</p>
          <p className="text-red-600/90">{error}</p>
        </div>
      )}

      {!cargando && datos && !datos.configurado && (
        <SinConfigurar datos={datos} esAdmin={esAdmin} />
      )}

      {(cargando || datos?.configurado) && !error && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <Kpi
              etiqueta="Visitas"
              valor={fmt(totalVisitas)}
              cargando={cargando}
              ayuda="Sesiones: una persona que entra, mira varias páginas y se va cuenta como una visita."
            />
            <Kpi
              etiqueta="Páginas vistas"
              valor={fmt(datos?.totales?.vistas)}
              cargando={cargando}
              ayuda="Total de páginas cargadas. Siempre es igual o mayor que el número de visitas."
            />
            <Kpi
              etiqueta="Países"
              valor={fmt(paises.length)}
              cargando={cargando}
              ayuda="Países distintos desde los que ha entrado al menos una visita en el periodo."
            />
            <Kpi
              etiqueta="País principal"
              valor={paisTop ? NOMBRE_PAIS(paisTop.codigo) : "—"}
              pie={cuotaTop !== null ? `${cuotaTop}% de las visitas` : null}
              cargando={cargando}
              ayuda="El país que más visitas aporta en el periodo seleccionado."
            />
          </div>

          {cargando ? (
            <div className="bg-white border border-neutral-100 rounded-xl p-5 mb-6">
              <div className="h-64 bg-neutral-50 rounded-lg animate-pulse" />
            </div>
          ) : totalVisitas === 0 ? (
            <div className="bg-white border border-neutral-100 rounded-xl p-8 text-center mb-6">
              <p className="text-sm font-medium text-[var(--ink-900)] mb-1">
                Todavía no hay visitas registradas
              </p>
              <p className="text-sm text-[var(--ink-500)] max-w-md mx-auto leading-relaxed">
                Cloudflare tarda unos minutos en mostrar las primeras. Si tras un rato sigue vacío, comprueba
                que el fragmento de medición está en la web y que el rango de fechas es el correcto.
              </p>
            </div>
          ) : (
            <>
              {/* Mapa + ranking */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
                <div className="lg:col-span-2">
                  <Panel
                    titulo="Visitas por país"
                    ayuda="Cuanto más intenso el color, más visitas. Pasa el ratón por encima de un país para ver el detalle."
                  >
                    <MapaVisitas paises={paises} leadsPorPais={leadsPorPais} />
                  </Panel>
                </div>

                <Panel
                  titulo="Ranking de países"
                  ayuda={
                    leadsPorPais
                      ? "Visitas medidas por Cloudflare y, al lado, los leads que llegaron por el formulario en el mismo periodo. El país del lead es el que la persona elige en el formulario, así que son dos mediciones distintas: sirven para comparar, no para cuadrar."
                      : "Países ordenados por número de visitas en el periodo."
                  }
                >
                  <div className="max-h-[420px] overflow-y-auto pr-1">
                    <table className="w-full text-sm">
                      <thead className="text-[11px] uppercase tracking-widest text-neutral-400">
                        <tr>
                          <th className="text-left font-medium pb-2">País</th>
                          <th className="text-right font-medium pb-2">Visitas</th>
                          {leadsPorPais && <th className="text-right font-medium pb-2">Leads</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {paises.slice(0, 40).map((p) => (
                          <tr key={p.codigo} className="border-t border-neutral-50">
                            <td className="py-1.5 text-[var(--ink-900)] truncate max-w-[140px]">
                              {NOMBRE_PAIS(p.codigo)}
                            </td>
                            <td className="py-1.5 text-right tabular-nums text-neutral-600">{fmt(p.visitas)}</td>
                            {leadsPorPais && (
                              <td className="py-1.5 text-right tabular-nums font-medium"
                                  style={{ color: leadsMapa.get(p.codigo) ? "var(--color-primary)" : "#d4d4d4" }}>
                                {leadsMapa.get(p.codigo) ? fmt(leadsMapa.get(p.codigo)) : "—"}
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {datos?.visitasSinPais > 0 && (
                      <p className="text-[11px] text-neutral-400 mt-3">
                        {fmt(datos.visitasSinPais)} visitas sin país identificado.
                      </p>
                    )}
                  </div>
                </Panel>
              </div>

              {/* Evolución */}
              <div className="mb-4">
                <Panel
                  titulo="Evolución de las visitas"
                  ayuda="Visitas por día en el periodo. Pasa el ratón por la línea para ver el dato de cada jornada."
                >
                  <SerieVisitas serie={datos?.serie ?? []} />
                </Panel>
              </div>

              {/* Páginas y fuentes */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
                <Panel
                  titulo="Páginas más vistas"
                  ayuda="Las direcciones concretas de tu web que más se han cargado. Útil para saber qué contenido tira."
                >
                  <ListaBarras
                    sufijo="vistas"
                    items={(datos?.paginas ?? []).slice(0, 10).map((p) => ({
                      clave: p.clave,
                      etiqueta: p.clave || "/",
                      valor: p.vistas,
                    }))}
                  />
                </Panel>

                <Panel
                  titulo="De dónde llegan"
                  ayuda="La web desde la que se hizo clic para llegar a la tuya. «Directo» es quien escribe la dirección o entra desde un marcador o un correo."
                >
                  <ListaBarras
                    items={(datos?.referrers ?? []).slice(0, 10).map((r) => ({
                      clave: r.clave || "(directo)",
                      etiqueta: r.clave || "Directo / sin origen",
                      valor: r.visitas,
                    }))}
                  />
                </Panel>
              </div>

              {/* Dispositivos y navegadores */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Panel titulo="Dispositivos" ayuda="Con qué tipo de aparato entran: ordenador, móvil o tableta.">
                  <ListaBarras
                    items={(datos?.dispositivos ?? []).map((d) => ({
                      clave: d.clave || "desconocido",
                      etiqueta: d.clave || "Sin identificar",
                      valor: d.visitas,
                    }))}
                  />
                </Panel>
                <Panel titulo="Navegadores" ayuda="Qué navegador usan quienes entran en la web.">
                  <ListaBarras
                    items={(datos?.navegadores ?? []).slice(0, 8).map((n) => ({
                      clave: n.clave || "desconocido",
                      etiqueta: n.clave || "Sin identificar",
                      valor: n.visitas,
                    }))}
                  />
                </Panel>
              </div>
            </>
          )}
        </>
      )}

      {/* Nota legal / de expectativas. No es decoración: sin esto, un panel con
          mapa y banderas invita a pensar que se sabe QUIÉN entró. */}
      <p className="text-xs text-neutral-400 leading-relaxed mt-6 max-w-3xl">
        La medición es anónima y sin cookies: Cloudflare cuenta visitas y las agrupa por país, página y
        origen, pero no identifica a las personas ni permite seguir a una en concreto. Por eso no requiere
        banner de consentimiento. Para saber quién está detrás de una visita hace falta que rellene el
        formulario de la web, y eso aparece en Leads.
        {datos?.filtradoPorSitio === false && datos?.configurado && (
          <> Los datos incluyen todos los sitios de la cuenta de Cloudflare.</>
        )}
      </p>
    </div>
  );
}
