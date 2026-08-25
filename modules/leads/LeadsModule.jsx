"use client";

import { useEffect, useState, useCallback } from "react";
import Select from "@/components/ui/Select.jsx";
import HelpTooltip from "@/components/ui/HelpTooltip.jsx";

/**
 * Leads Profesionales — el módulo por defecto (rehecho el 18/08/2026).
 *
 * ── DE DÓNDE VIENE ─────────────────────────────────────────────────────────
 *
 * Es el módulo de aumenta (`modules/overrides/aumenta/LeadsModule.jsx`)
 * promocionado a base, con tres cosas parametrizadas en vez de escritas:
 *
 *   · el COLOR sale de la marca del cliente (`var(--color-primary)`, como ya
 *     hacen Formularios y Outreach), no de tres hex de Aumenta;
 *   · las ETAPAS llegan por props desde la página, que las lee de
 *     `lib/leads/embudos.js` — la única fuente que el servidor también conoce,
 *     y por eso la que vigila `_smoke-leads-etapas.mjs`;
 *   · los RÓTULOS («Leads» / «Interesados») llegan por props también.
 *
 * Todo lo demás —métricas por etapa que filtran al pulsar, buscador, filtro por
 * motivo, tabla en escritorio y tarjetas en móvil, panel lateral con cambio de
 * etapa y notas— es lo que aumenta lleva usando en real desde julio.
 *
 * ── POR QUÉ ────────────────────────────────────────────────────────────────
 *
 * El módulo base tenía 94 líneas y era una tabla sin botonera. Su cabecera
 * decía «hoy no lo ve nadie — todos los clientes con Leads tienen su override».
 * Dejó de ser cierto: en producción lo veían somos, gm_alvar_alonso y las tres
 * demos por oficio. Los clientes MÁS NUEVOS veían la PEOR pantalla, y los seis
 * veteranos la buena, cada uno en su copia de 600-1.060 líneas.
 *
 * Decisión de Jorge (18/08/2026): el base pasa a ser el de aumenta. Los seis
 * overrides NO se tocan —siguen cargándose por el mapa `UI_OVERRIDES` de
 * `app/(dashboard)/leads/page.jsx`— y se encogen por oportunidad, no en un
 * sprint. Detalle en CLAUDE.md, «En Leads la pirámide está al revés».
 *
 * ── LO QUE NO ES DE NADIE Y POR ESO ESTÁ AQUÍ ──────────────────────────────
 *
 * `motivo`, `servicio`, `curso`, `taller` y `tipo_usuario` NO son campos de
 * Aumenta: son columnas de `models/tenant/Lead.model.js` para todos los
 * tenants (con su ENUM). Un cliente que no los rellene ve «—», nada más.
 *
 * Las ofertas de empleo (`customFields.tipo_lead = "oferta_empleo"`) sí nacen
 * de la web de Aumenta, pero el botón y la insignia solo aparecen si en la
 * lista HAY alguna: quien no reciba candidaturas no ve nada raro (decisión de
 * Jorge, 18/08). Sin configuración, sin puerta.
 *
 * ── PROPS ──────────────────────────────────────────────────────────────────
 *
 *   stages   [{ key, label }]  las etapas del embudo, en orden. Obligatorio.
 *   titulo   string            «Leads Profesionales» por defecto.
 *   sujeto   string            cómo se llama a un lead en los textos: «leads»
 *                              por defecto, «interesados» en aumenta.
 *   descripcion string         la línea bajo el título. Por defecto habla de la
 *                              web, que es de donde vienen los leads de casi
 *                              todos; con `booking` no vienen de ahí —los manda
 *                              la representante— y decirlo sería mentir.
 */

// ─── Estilos por etapa ────────────────────────────────────────────────────────
//
// Cubre TODA la lista canónica de `lib/leads/stages.js`, no solo las cinco por
// defecto: un lead puede llegar con una etapa extendida (importación, cambio
// de embudo) y tiene que verse, no tirar la pantalla. Lo que no esté aquí cae
// al gris del `??`.

const STAGE_STYLE = {
  new: { bg: "bg-violet-100 text-violet-700", dot: "bg-violet-400" },
  contacted: { bg: "bg-sky-100 text-sky-700", dot: "bg-sky-400" },
  qualified: { bg: "bg-emerald-100 text-emerald-700", dot: "bg-emerald-400" },
  proposal: { bg: "bg-indigo-100 text-indigo-700", dot: "bg-indigo-400" },
  negotiation: { bg: "bg-amber-100 text-amber-700", dot: "bg-amber-400" },
  won: { bg: "bg-green-100 text-green-700", dot: "bg-green-500" },
  lost: { bg: "bg-red-100 text-red-600", dot: "bg-red-400" },
  in_progress: { bg: "bg-cyan-100 text-cyan-700", dot: "bg-cyan-400" },
  demo_scheduled: { bg: "bg-fuchsia-100 text-fuchsia-700", dot: "bg-fuchsia-400" },
  demo_done: { bg: "bg-purple-100 text-purple-700", dot: "bg-purple-400" },
  closed_yes: { bg: "bg-green-100 text-green-700", dot: "bg-green-500" },
  closed_no: { bg: "bg-red-100 text-red-600", dot: "bg-red-400" },
  consulta_agendada: { bg: "bg-teal-100 text-teal-700", dot: "bg-teal-400" },
  consulta_realizada: { bg: "bg-lime-100 text-lime-700", dot: "bg-lime-500" },
  paciente: { bg: "bg-green-100 text-green-700", dot: "bg-green-500" },
  // Booking (24/08/2026). El embudo va de frío a cerrado, así que los colores
  // van de azul a verde: propuesta enviada (sky) → han respondido (cyan) →
  // negociando (amber, que es donde se decide) → fecha cerrada (green, es el
  // ganado) → actuación realizada (emerald, ya pasó).
  propuesta_enviada: { bg: "bg-sky-100 text-sky-700", dot: "bg-sky-400" },
  respuesta_recibida: { bg: "bg-cyan-100 text-cyan-700", dot: "bg-cyan-400" },
  negociando_cache: { bg: "bg-amber-100 text-amber-700", dot: "bg-amber-400" },
  fecha_confirmada: { bg: "bg-green-100 text-green-700", dot: "bg-green-500" },
  actuacion_realizada: { bg: "bg-emerald-100 text-emerald-700", dot: "bg-emerald-500" },
};
const STAGE_STYLE_FALLBACK = { bg: "bg-gray-100 text-gray-600", dot: "bg-gray-400" };
const estiloDe = (key) => STAGE_STYLE[key] ?? STAGE_STYLE_FALLBACK;

// Las tarjetas de arriba: la de «Descartado» va en rojo siempre; la primera
// etapa en el color de marca; el resto, un tono más apagado del mismo. Es la
// misma jerarquía visual que tenía aumenta con sus tres hex, sin los hex.
const COLOR_MARCA = "var(--color-primary)";
const COLOR_MARCA_SUAVE = "color-mix(in srgb, var(--color-primary) 60%, white)";
const COLOR_PERDIDO = "#ef4444";
function colorDeTarjeta(stageKey, indice) {
  if (stageKey === "lost" || stageKey === "closed_no") return COLOR_PERDIDO;
  return indice === 0 ? COLOR_MARCA : COLOR_MARCA_SUAVE;
}

// ─── Motivo (columnas del modelo Lead, comunes a todos) ───────────────────────

const MOTIVO_LABEL = {
  diagnostico: "Diagnóstico",
  servicios: "Servicios",
  cursos: "Cursos",
  talleres: "Talleres",
};

const MOTIVO_STYLE = {
  diagnostico: "bg-orange-100 text-orange-700 border border-orange-200",
  servicios: "bg-teal-100 text-teal-700 border border-teal-200",
  cursos: "bg-blue-100 text-blue-700 border border-blue-200",
  talleres: "bg-purple-100 text-purple-700 border border-purple-200",
};

function getDetalle(lead) {
  if (lead.motivo === "diagnostico") return lead.mensaje || "—";
  if (lead.motivo === "servicios") return lead.servicio || "—";
  if (lead.motivo === "cursos") return lead.curso || "—";
  if (lead.motivo === "talleres") return lead.taller || "—";
  return lead.mensaje || "—";
}

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
}

// Un lead de «oferta de empleo» se marca desde el formulario público con
// customFields.tipo_lead = "oferta_empleo" (ver /api/public/leads, que pasa
// customFields tal cual).
function isJobLead(lead) {
  return lead?.customFields?.tipo_lead === "oferta_empleo";
}

function JobBadge() {
  return (
    <span
      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold text-white whitespace-nowrap"
      style={{ background: COLOR_MARCA }}
    >
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3">
        <path d="M8 4a1 1 0 011-1h2a1 1 0 011 1v1h2.5A1.5 1.5 0 0117 6.5V8H3V6.5A1.5 1.5 0 014.5 5H7V4zm1 0v1h2V4H9z" />
        <path d="M3 9.5V14a1.5 1.5 0 001.5 1.5h11A1.5 1.5 0 0017 14V9.5H3z" />
      </svg>
      Oferta de empleo
    </span>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function LeadsModule({
  stages,
  titulo = "Leads Profesionales",
  sujeto = "leads",
  descripcion = "Usuarios que han pedido información desde la web.",
}) {
  const [leads, setLeads] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filtroMotivo, setFiltroMotivo] = useState("");
  const [activeStage, setActiveStage] = useState("all");
  const [selected, setSelected] = useState(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [soloEmpleo, setSoloEmpleo] = useState(false);

  // El desglose por etapa lo cuenta el SERVIDOR (`/api/leads?desglose=1`), con
  // los demás filtros aplicados. Si saliera de un `reduce` sobre `leads` —la
  // lista YA filtrada— al pulsar una etapa las demás caerían a cero.
  const [stageCounts, setStageCounts] = useState({});

  /**
   * Qué campos heredados del embudo de Aumenta usa de verdad este cliente.
   *
   * `motivo` (diagnóstico / servicios / cursos / talleres), `tipo_usuario`
   * (ciudadano / profesional) y su detalle son columnas de `Lead` para todos,
   * y esta tabla las pintaba SIEMPRE. En un CRM de booking eso eran tres
   * columnas fijas en «—» y un filtro «Todos los motivos» que no filtraba nada.
   *
   * Lo dice el SERVIDOR (`campos` de /api/leads?desglose=1), contando sobre
   * toda la tabla: calcularlo aquí sobre `leads` —que llega ya filtrado— haría
   * desaparecer una columna al acotar por etapa. Arranca en `true` para que la
   * tabla no parpadee mientras carga: quien no los use los ve un instante, que
   * es mucho menos malo que ver saltar las columnas.
   */
  const [campos, setCampos] = useState({ motivo: true, tipoUsuario: true, detalle: true });

  // `silencioso` para volver a pedirlo tras un cambio de etapa sin que la lista
  // parpadee con el cargando.
  const fetchLeads = useCallback(
    (silencioso = false) => {
      if (!silencioso) setLoading(true);
      const params = new URLSearchParams({ limit: "200", desglose: "1" });
      if (activeStage !== "all") params.set("stage", activeStage);
      if (filtroMotivo) params.set("motivo", filtroMotivo);
      if (search.trim()) params.set("search", search.trim());

      fetch(`/api/leads?${params}`)
        .then((r) => r.json())
        .then((data) => {
          if (data.ok) {
            setLeads(data.data.leads);
            setStageCounts(data.data.desglose ?? {});
            if (data.data.campos) setCampos(data.data.campos);
            setTotal(data.data.totalSinEtapa ?? data.data.total);
          }
        })
        .finally(() => {
          if (!silencioso) setLoading(false);
        });
    },
    [activeStage, filtroMotivo, search]
  );

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  const jobCount = leads.filter(isJobLead).length;
  const hayEmpleo = jobCount > 0 || soloEmpleo;
  const visibleLeads = soloEmpleo ? leads.filter(isJobLead) : leads;
  const labelDe = (key) => stages.find((s) => s.key === key)?.label ?? key;

  function openLead(lead) {
    setSelected({ ...lead });
    setPanelOpen(true);
  }

  function closePanel() {
    setPanelOpen(false);
    setTimeout(() => setSelected(null), 300);
  }

  async function handleStageChange(leadId, newStage) {
    setSaving(true);
    try {
      const res = await fetch(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: newStage }),
      });
      const data = await res.json();
      if (data.ok) {
        setLeads((prev) => prev.map((l) => (l.id === leadId ? { ...l, stage: newStage } : l)));
        fetchLeads(true);
        if (selected?.id === leadId) setSelected((prev) => ({ ...prev, stage: newStage }));
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleNotesChange(leadId, notes) {
    await fetch(`/api/leads/${leadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes }),
    });
    setLeads((prev) => prev.map((l) => (l.id === leadId ? { ...l, notes } : l)));
  }

  const hayFiltro = search || filtroMotivo || activeStage !== "all" || soloEmpleo;

  return (
    <div className="flex h-full bg-gray-50">
      {/* ── Lista principal ─────────────────────────────────────────────────── */}
      <div
        className={`flex-1 flex flex-col min-w-0 transition-all duration-300 ${panelOpen ? "lg:mr-[460px]" : ""}`}
      >
        {/* Header */}
        <div className="px-6 lg:px-8 pt-8 pb-0">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
            <div>
              <h1 className="text-gray-900 text-2xl font-bold flex items-center gap-2">
                {titulo}
                <HelpTooltip title="La lista enseña 200 como mucho" placement="bottom">
                  Se cargan siempre los 200 {sujeto} más recientes, y no hay forma de seguir bajando a
                  partir de ahí. <strong className="text-white">Los anteriores no se han borrado</strong>:
                  para llegar a uno hay que buscarlo por nombre, email o teléfono{campos.motivo ? ", o acotar por motivo" : ""}.
                </HelpTooltip>
              </h1>
              <p className="text-gray-500 text-sm mt-0.5">
                {descripcion}{" "}
                <span className="font-semibold" style={{ color: COLOR_MARCA }}>
                  {total} en total
                </span>
              </p>
            </div>
          </div>

          {/* Métricas: una por etapa, más el total. Pulsar una filtra por ella. */}
          <div
            className="grid grid-cols-2 gap-3 mb-6"
            style={{ gridTemplateColumns: `repeat(auto-fit, minmax(140px, 1fr))` }}
          >
            <MetricCard
              label="Total"
              value={total}
              color={COLOR_MARCA}
              active={activeStage === "all"}
              onClick={() => setActiveStage("all")}
            />
            {stages.map((s, i) => (
              <MetricCard
                key={s.key}
                label={s.label}
                value={stageCounts[s.key] ?? 0}
                color={colorDeTarjeta(s.key, i)}
                active={activeStage === s.key}
                onClick={() => setActiveStage(activeStage === s.key ? "all" : s.key)}
              />
            ))}
          </div>

          {/* Filtros */}
          <div className="flex flex-col lg:flex-row gap-3 mb-4">
            {/* El filtro por motivo solo donde hay motivos: un desplegable
                «Todos los motivos» con diagnóstico, servicios, cursos y
                talleres no filtra nada en un CRM de booking. */}
            {campos.motivo && (
              <Select
                value={filtroMotivo}
                onChange={(v) => setFiltroMotivo(v)}
                options={[
                  { value: "", label: "Todos los motivos" },
                  ...Object.entries(MOTIVO_LABEL).map(([k, v]) => ({ value: k, label: v })),
                ]}
                // Por CLASES y no por `style`: `Select` no acepta esa prop (se
                // perdía en silencio y el borde salía en currentColor). Con la
                // clase arbitraria el color de marca llega igual.
                className={`lg:w-52 px-4 py-2.5 rounded-xl border ${
                  filtroMotivo ? "border-[var(--color-primary)]" : "border-gray-200"
                } bg-white text-gray-700 font-medium focus:outline-none text-sm shadow-sm transition-colors`}
              />
            )}

            {hayEmpleo && (
              <button
                type="button"
                onClick={() => setSoloEmpleo((v) => !v)}
                className="px-4 py-2.5 rounded-xl border font-medium text-sm shadow-sm transition-colors inline-flex items-center justify-center gap-2"
                style={
                  soloEmpleo
                    ? { background: COLOR_MARCA, color: "white", borderColor: COLOR_MARCA }
                    : { background: "white", color: "#374151", borderColor: "#e5e7eb" }
                }
              >
                <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                  <path d="M8 4a1 1 0 011-1h2a1 1 0 011 1v1h2.5A1.5 1.5 0 0117 6.5V8H3V6.5A1.5 1.5 0 014.5 5H7V4zm1 0v1h2V4H9z" />
                  <path d="M3 9.5V14a1.5 1.5 0 001.5 1.5h11A1.5 1.5 0 0017 14V9.5H3z" />
                </svg>
                Ofertas de empleo{jobCount ? ` (${jobCount})` : ""}
              </button>
            )}

            <div className="relative flex-1">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
              </svg>
              <input
                type="text"
                placeholder="Buscar por nombre, email o teléfono…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-white border border-gray-200 rounded-xl pl-9 pr-4 py-2.5 text-sm text-gray-700 placeholder-gray-400 focus:outline-none shadow-sm transition-colors"
                style={{ borderColor: search ? COLOR_MARCA : undefined }}
              />
            </div>
          </div>
        </div>

        {/* Contenido */}
        <div className="flex-1 px-6 lg:px-8 pb-8 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div
                className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin"
                style={{ borderColor: COLOR_MARCA, borderTopColor: "transparent" }}
              />
            </div>
          ) : (
            <>
              {/* Desktop: tabla */}
              <div className="hidden lg:block rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      {[
                        "Nombre y Email",
                        // Las ofertas de empleo se pintan en la columna de
                        // Motivo, así que esa columna también hace falta si las
                        // hay, aunque nadie tenga un motivo puesto.
                        ...(campos.motivo || jobCount > 0 ? ["Motivo"] : []),
                        ...(campos.detalle ? ["Detalle"] : []),
                        ...(campos.tipoUsuario ? ["Tipo"] : []),
                        "Estado",
                        "Recibido",
                        "",
                      ].map((h) => (
                        <th
                          key={h}
                          className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wide"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleLeads.map((lead) => {
                      const style = estiloDe(lead.stage);
                      return (
                        <tr
                          key={lead.id}
                          role="link"
                          tabIndex={-1}
                          onClick={(e) => {
                            // No abrir el panel si el click viene de un elemento interactivo interno.
                            if (e.target.closest("a, button, input, select, textarea, label")) return;
                            openLead(lead);
                          }}
                          className="border-b border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer"
                        >
                          <td className="py-3.5 px-4">
                            <div className="font-semibold text-gray-900">{lead.name || "—"}</div>
                            <div className="text-xs text-gray-400">{lead.email || ""}</div>
                          </td>
                          {/* Las tres columnas heredadas solo se pintan si este
                              cliente las usa (ver `campos`). Tienen que casar
                              EXACTAMENTE con las cabeceras de arriba o la tabla
                              se descuadra. */}
                          {(campos.motivo || jobCount > 0) && (
                            <td className="py-3.5 px-4">
                              {isJobLead(lead) ? (
                                <JobBadge />
                              ) : lead.motivo ? (
                                <span
                                  className={`inline-block px-2.5 py-1 rounded-full text-xs font-semibold ${MOTIVO_STYLE[lead.motivo] ?? "bg-gray-100 text-gray-600"}`}
                                >
                                  {MOTIVO_LABEL[lead.motivo] ?? lead.motivo}
                                </span>
                              ) : (
                                <span className="text-gray-300">—</span>
                              )}
                            </td>
                          )}
                          {campos.detalle && (
                            <td className="py-3.5 px-4 max-w-[180px]">
                              <span className="text-sm text-gray-500 truncate block">{getDetalle(lead)}</span>
                            </td>
                          )}
                          {campos.tipoUsuario && (
                            <td className="py-3.5 px-4">
                              {lead.tipo_usuario ? (
                                <span
                                  className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                                    lead.tipo_usuario === "profesional"
                                      ? "bg-purple-100 text-purple-700"
                                      : "bg-gray-100 text-gray-600"
                                  }`}
                                >
                                  {lead.tipo_usuario === "profesional" ? "Profesional" : "Ciudadano"}
                                </span>
                              ) : (
                                <span className="text-gray-300">—</span>
                              )}
                            </td>
                          )}
                          <td className="py-3.5 px-4">
                            <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-semibold ${style.bg}`}>
                              {labelDe(lead.stage)}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-xs text-gray-400">{formatDate(lead.createdAt)}</td>
                          <td className="py-3.5 px-4 text-right">
                            <AtenderButton onClick={() => openLead(lead)} />
                          </td>
                        </tr>
                      );
                    })}
                    {visibleLeads.length === 0 && (
                      <tr>
                        <td colSpan={7} className="py-16 text-center text-gray-400 text-sm">
                          {hayFiltro ? "Sin resultados para ese filtro." : `Todavía no hay ${sujeto}.`}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Mobile: tarjetas */}
              <div className="lg:hidden space-y-3">
                {visibleLeads.map((lead) => {
                  const style = estiloDe(lead.stage);
                  return (
                    <div
                      key={lead.id}
                      role="link"
                      tabIndex={-1}
                      onClick={(e) => {
                        if (e.target.closest("a, button, input, select, textarea, label")) return;
                        openLead(lead);
                      }}
                      className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 cursor-pointer"
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="min-w-0 mr-3">
                          <div className="font-bold text-gray-900 truncate">{lead.name || "—"}</div>
                          <div className="text-xs text-gray-400 truncate">{lead.email}</div>
                        </div>
                        <span
                          className={`inline-block shrink-0 px-2.5 py-1 rounded-full text-xs font-semibold ${style.bg}`}
                        >
                          {labelDe(lead.stage)}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2 mb-3">
                        {isJobLead(lead) && <JobBadge />}
                        {lead.motivo && (
                          <span
                            className={`px-2.5 py-1 rounded-full text-xs font-semibold ${MOTIVO_STYLE[lead.motivo] ?? "bg-gray-100 text-gray-600"}`}
                          >
                            {MOTIVO_LABEL[lead.motivo] ?? lead.motivo}
                          </span>
                        )}
                        {lead.tipo_usuario && (
                          <span
                            className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                              lead.tipo_usuario === "profesional"
                                ? "bg-purple-100 text-purple-700"
                                : "bg-gray-100 text-gray-600"
                            }`}
                          >
                            {lead.tipo_usuario === "profesional" ? "Profesional" : "Ciudadano"}
                          </span>
                        )}
                      </div>
                      {getDetalle(lead) !== "—" && (
                        <p className="text-xs text-gray-500 mb-3 line-clamp-2">{getDetalle(lead)}</p>
                      )}
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-400">{formatDate(lead.createdAt)}</span>
                        <AtenderButton onClick={() => openLead(lead)} />
                      </div>
                    </div>
                  );
                })}
                {visibleLeads.length === 0 && (
                  <div className="py-16 text-center text-gray-400 text-sm">
                    {hayFiltro ? "Sin resultados para ese filtro." : `Todavía no hay ${sujeto}.`}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Panel lateral ───────────────────────────────────────────────────── */}
      <LeadPanel
        lead={selected}
        open={panelOpen}
        saving={saving}
        stages={stages}
        sujeto={sujeto}
        onClose={closePanel}
        onStageChange={handleStageChange}
        onNotesChange={handleNotesChange}
      />
    </div>
  );
}

// ─── MetricCard ───────────────────────────────────────────────────────────────

function MetricCard({ label, value, color, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`text-left rounded-2xl p-4 border transition-all ${
        active ? "shadow-md" : "border-gray-200 bg-white hover:shadow-sm"
      }`}
      style={
        active
          ? { borderColor: color, background: `color-mix(in srgb, ${color} 8%, white)` }
          : {}
      }
    >
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className="text-2xl font-bold" style={{ color: active ? color : "#111827" }}>
        {value}
      </div>
    </button>
  );
}

// ─── AtenderButton ────────────────────────────────────────────────────────────

function AtenderButton({ onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="text-xs font-semibold px-4 py-2 rounded-xl transition-all"
      style={{
        background: hover ? COLOR_MARCA : `color-mix(in srgb, ${COLOR_MARCA} 10%, white)`,
        color: hover ? "white" : COLOR_MARCA,
      }}
    >
      Atender
    </button>
  );
}

// ─── Panel de detalle ─────────────────────────────────────────────────────────

function LeadPanel({ lead, open, saving, stages, sujeto, onClose, onStageChange, onNotesChange }) {
  const [notes, setNotes] = useState("");
  const [notesDirty, setNotesDirty] = useState(false);

  useEffect(() => {
    if (lead) {
      setNotes(lead.notes ?? "");
      setNotesDirty(false);
    }
  }, [lead?.id]);

  if (!lead) return null;

  async function saveNotes() {
    await onNotesChange(lead.id, notes);
    setNotesDirty(false);
  }

  // Los botones de etapa: 3 por fila hasta cinco etapas, 2 por fila con más,
  // para que las etiquetas largas («Consulta realizada») no se rompan.
  const columnasEtapa = stages.length <= 3 ? "grid-cols-3" : stages.length <= 5 ? "grid-cols-3" : "grid-cols-2";

  return (
    <div
      className={`fixed top-14 lg:top-0 bottom-0 right-0 w-full lg:w-[460px] bg-white border-l border-gray-200 shadow-2xl flex flex-col z-50 transition-transform duration-300 ${
        open ? "translate-x-0" : "translate-x-full"
      }`}
    >
      {/* Header */}
      <div
        className="px-6 pt-6 pb-4 border-b border-gray-100 flex items-start justify-between gap-4"
        style={{ borderTopColor: COLOR_MARCA, borderTopWidth: 3 }}
      >
        <div className="min-w-0">
          <h2 className="text-gray-900 font-bold text-lg truncate">{lead.name || "Sin nombre"}</h2>
          <p className="text-gray-400 text-xs mt-0.5">{formatDate(lead.createdAt)}</p>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors shrink-0">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
        {/* Estado */}
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Estado</p>
          <div className={`grid ${columnasEtapa} gap-2`}>
            {stages.map((s) => {
              const isActive = lead.stage === s.key;
              const style = estiloDe(s.key);
              return (
                <button
                  key={s.key}
                  disabled={saving}
                  onClick={() => onStageChange(lead.id, s.key)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold border transition-all disabled:opacity-50 ${
                    isActive
                      ? "border-transparent shadow-sm"
                      : "border-gray-200 text-gray-500 hover:border-gray-300 bg-white"
                  }`}
                  style={
                    isActive
                      ? {
                          background: `color-mix(in srgb, ${COLOR_MARCA} 10%, white)`,
                          color: COLOR_MARCA,
                          borderColor: `color-mix(in srgb, ${COLOR_MARCA} 25%, white)`,
                        }
                      : {}
                  }
                >
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${style.dot}`} />
                  {s.label}
                </button>
              );
            })}
          </div>
          {/* Si el lead está en una etapa que este embudo no ofrece (importado,
              o el embudo cambió), se dice en vez de esconderlo. */}
          {!stages.some((s) => s.key === lead.stage) && (
            <p className="text-[11px] text-amber-600 mt-2">
              Está en «{lead.stage}», una etapa que este embudo no ofrece. Elige una de arriba para moverlo.
            </p>
          )}
        </div>

        {/* Contacto */}
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Contacto</p>
          <div className="space-y-2">
            <PanelRow label="Email" value={lead.email} href={lead.email ? `mailto:${lead.email}` : undefined} />
            <PanelRow label="Teléfono" value={lead.phone} href={lead.phone ? `tel:${lead.phone}` : undefined} />
            {lead.tipo_usuario && (
              <PanelRow label="Tipo" value={lead.tipo_usuario === "profesional" ? "Profesional" : "Ciudadano"} />
            )}
          </div>
        </div>

        {/* Consulta */}
        {lead.motivo && (
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Consulta</p>
            <div className="bg-gray-50 rounded-xl p-4 space-y-2.5">
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-400 w-20 shrink-0">Motivo</span>
                <span
                  className={`px-2.5 py-1 rounded-full text-xs font-semibold ${MOTIVO_STYLE[lead.motivo] ?? "bg-gray-100 text-gray-600"}`}
                >
                  {MOTIVO_LABEL[lead.motivo] ?? lead.motivo}
                </span>
              </div>
              {lead.servicio && <PanelRow label="Servicio" value={lead.servicio} />}
              {lead.curso && <PanelRow label="Curso" value={lead.curso} />}
              {lead.taller && <PanelRow label="Taller" value={lead.taller} />}
              {lead.mensaje && (
                <div>
                  <span className="text-xs text-gray-400 block mb-1">Mensaje</span>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed max-h-[240px] overflow-y-auto">
                    {lead.mensaje}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Sin motivo pero con mensaje (formulario genérico) */}
        {!lead.motivo && lead.mensaje && (
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Mensaje</p>
            <div className="bg-gray-50 rounded-xl p-4">
              <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed max-h-[240px] overflow-y-auto">
                {lead.mensaje}
              </p>
            </div>
          </div>
        )}

        {/* Candidatura (oferta de empleo) */}
        {isJobLead(lead) && (
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Candidatura</p>
            <div className="bg-gray-50 rounded-xl p-4 space-y-2.5">
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-400 w-20 shrink-0">Tipo</span>
                <JobBadge />
              </div>
              {lead.customFields?.puesto && <PanelRow label="Puesto" value={lead.customFields.puesto} />}
            </div>
          </div>
        )}

        {/* Notas */}
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Notas internas</p>
          <textarea
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
              setNotesDirty(true);
            }}
            placeholder={`Añade notas sobre este ${sujeto.replace(/s$/, "")}…`}
            rows={4}
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-700 placeholder-gray-400 focus:outline-none resize-none transition-colors"
            style={{ borderColor: notesDirty ? COLOR_MARCA : undefined }}
          />
          {notesDirty && (
            <button
              onClick={saveNotes}
              className="mt-2 text-xs font-semibold transition-opacity hover:opacity-80"
              style={{ color: COLOR_MARCA }}
            >
              Guardar notas
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────

function PanelRow({ label, value, href }) {
  return (
    <div className="flex items-start gap-3">
      <span className="text-xs text-gray-400 w-20 shrink-0 mt-0.5">{label}</span>
      {value ? (
        href ? (
          <a href={href} className="text-sm text-gray-700 hover:underline font-medium">
            {value}
          </a>
        ) : (
          <span className="text-sm text-gray-700 font-medium">{value}</span>
        )
      ) : (
        <span className="text-sm text-gray-300">—</span>
      )}
    </div>
  );
}
