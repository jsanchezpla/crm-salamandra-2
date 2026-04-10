"use client";

import { useEffect, useState, useCallback } from "react";

// ─── Aumenta brand ────────────────────────────────────────────────────────────

const PRIMARY = "#FF1F96";
const SECONDARY = "#563FA6";
const ACCENT = "#E8799A";

// ─── Configuración ────────────────────────────────────────────────────────────

const STAGES = [
  { key: "new", label: "Nuevo" },
  { key: "contacted", label: "Contactado" },
  { key: "lost", label: "Descartado" },
];

const STAGE_STYLE = {
  new: { bg: "bg-violet-100 text-violet-700", dot: "bg-violet-400" },
  contacted: { bg: "bg-sky-100 text-sky-700", dot: "bg-sky-400" },
  qualified: { bg: "bg-emerald-100 text-emerald-700", dot: "bg-emerald-400" },
  lost: { bg: "bg-red-100 text-red-600", dot: "bg-red-400" },
};

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

// ─── Componente principal ─────────────────────────────────────────────────────

export default function AumentaLeadsModule() {
  const [leads, setLeads] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filtroMotivo, setFiltroMotivo] = useState("");
  const [activeStage, setActiveStage] = useState("all");
  const [selected, setSelected] = useState(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchLeads = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ limit: "200" });
    if (activeStage !== "all") params.set("stage", activeStage);
    if (filtroMotivo) params.set("motivo", filtroMotivo);
    if (search.trim()) params.set("search", search.trim());

    fetch(`/api/leads?${params}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          setLeads(data.data.leads);
          setTotal(data.data.total);
        }
      })
      .finally(() => setLoading(false));
  }, [activeStage, filtroMotivo, search]);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  const stageCounts = leads.reduce((acc, l) => {
    acc[l.stage] = (acc[l.stage] ?? 0) + 1;
    return acc;
  }, {});

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
              <h1 className="text-gray-900 text-2xl font-bold">Leads</h1>
              <p className="text-gray-500 text-sm mt-0.5">
                Usuarios que han pedido información desde la web.{" "}
                <span className="font-semibold" style={{ color: PRIMARY }}>
                  {total} en total
                </span>
              </p>
            </div>
          </div>

          {/* Métricas */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <MetricCard
              label="Total"
              value={total}
              color={PRIMARY}
              active={activeStage === "all"}
              onClick={() => setActiveStage("all")}
            />
            {STAGES.map((s) => (
              <MetricCard
                key={s.key}
                label={s.label}
                value={stageCounts[s.key] ?? 0}
                color={s.key === "lost" ? "#ef4444" : s.key === "new" ? SECONDARY : ACCENT}
                active={activeStage === s.key}
                onClick={() => setActiveStage(activeStage === s.key ? "all" : s.key)}
              />
            ))}
          </div>

          {/* Filtros */}
          <div className="flex flex-col lg:flex-row gap-3 mb-4">
            <select
              value={filtroMotivo}
              onChange={(e) => setFiltroMotivo(e.target.value)}
              className="lg:w-52 px-4 py-2.5 rounded-xl border border-gray-200 bg-white text-gray-700 font-medium focus:outline-none text-sm shadow-sm transition-colors"
              style={{ borderColor: filtroMotivo ? PRIMARY : undefined }}
            >
              <option value="">Todos los motivos</option>
              {Object.entries(MOTIVO_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>

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
                style={{ borderColor: search ? PRIMARY : undefined }}
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
                style={{ borderColor: PRIMARY }}
              />
            </div>
          ) : (
            <>
              {/* Desktop: tabla */}
              <div className="hidden lg:block rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      {["Nombre y Email", "Motivo", "Detalle", "Tipo", "Estado", "Recibido", ""].map((h) => (
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
                    {leads.map((lead) => {
                      const style = STAGE_STYLE[lead.stage] ?? STAGE_STYLE.new;
                      return (
                        <tr key={lead.id} className="border-b border-gray-100 hover:bg-pink-50/40 transition-colors">
                          <td className="py-3.5 px-4">
                            <div className="font-semibold text-gray-900">{lead.name || "—"}</div>
                            <div className="text-xs text-gray-400">{lead.email || ""}</div>
                          </td>
                          <td className="py-3.5 px-4">
                            {lead.motivo ? (
                              <span
                                className={`inline-block px-2.5 py-1 rounded-full text-xs font-semibold ${MOTIVO_STYLE[lead.motivo] ?? "bg-gray-100 text-gray-600"}`}
                              >
                                {MOTIVO_LABEL[lead.motivo] ?? lead.motivo}
                              </span>
                            ) : (
                              <span className="text-gray-300">—</span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 max-w-[180px]">
                            <span className="text-sm text-gray-500 truncate block">{getDetalle(lead)}</span>
                          </td>
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
                          <td className="py-3.5 px-4">
                            <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-semibold ${style.bg}`}>
                              {STAGES.find((s) => s.key === lead.stage)?.label ?? lead.stage}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-xs text-gray-400">{formatDate(lead.createdAt)}</td>
                          <td className="py-3.5 px-4 text-right">
                            <AtenderButton onClick={() => openLead(lead)} />
                          </td>
                        </tr>
                      );
                    })}
                    {leads.length === 0 && (
                      <tr>
                        <td colSpan={7} className="py-16 text-center text-gray-400 text-sm">
                          {search || filtroMotivo || activeStage !== "all"
                            ? "Sin resultados para ese filtro."
                            : "Todavía no hay leads."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Mobile: tarjetas */}
              <div className="lg:hidden space-y-3">
                {leads.map((lead) => {
                  const style = STAGE_STYLE[lead.stage] ?? STAGE_STYLE.new;
                  return (
                    <div key={lead.id} className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div className="min-w-0 mr-3">
                          <div className="font-bold text-gray-900 truncate">{lead.name || "—"}</div>
                          <div className="text-xs text-gray-400 truncate">{lead.email}</div>
                        </div>
                        <span
                          className={`inline-block shrink-0 px-2.5 py-1 rounded-full text-xs font-semibold ${style.bg}`}
                        >
                          {STAGES.find((s) => s.key === lead.stage)?.label ?? lead.stage}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2 mb-3">
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
                {leads.length === 0 && (
                  <div className="py-16 text-center text-gray-400 text-sm">
                    {search || filtroMotivo || activeStage !== "all"
                      ? "Sin resultados para ese filtro."
                      : "Todavía no hay leads."}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Panel lateral ───────────────────────────────────────────────────── */}
      <AumentaLeadPanel
        lead={selected}
        open={panelOpen}
        saving={saving}
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
      style={active ? { borderColor: color, background: `${color}12` } : {}}
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
        background: hover ? PRIMARY : `${PRIMARY}15`,
        color: hover ? "white" : PRIMARY,
      }}
    >
      Atender Lead
    </button>
  );
}

// ─── Panel de detalle ─────────────────────────────────────────────────────────

function AumentaLeadPanel({ lead, open, saving, onClose, onStageChange, onNotesChange }) {
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

  return (
    <div
      className={`fixed top-0 right-0 h-full w-full lg:w-[460px] bg-white border-l border-gray-200 shadow-2xl flex flex-col z-40 transition-transform duration-300 ${
        open ? "translate-x-0" : "translate-x-full"
      }`}
    >
      {/* Header */}
      <div
        className="px-6 pt-6 pb-4 border-b border-gray-100 flex items-start justify-between gap-4"
        style={{ borderTopColor: PRIMARY, borderTopWidth: 3 }}
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
          <div className="grid grid-cols-3 gap-2">
            {STAGES.map((s) => {
              const isActive = lead.stage === s.key;
              const style = STAGE_STYLE[s.key];
              return (
                <button
                  key={s.key}
                  disabled={saving}
                  onClick={() => onStageChange(lead.id, s.key)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold border transition-all disabled:opacity-50 ${
                    isActive ? "border-transparent shadow-sm" : "border-gray-200 text-gray-500 hover:border-gray-300 bg-white"
                  }`}
                  style={isActive ? { background: `${PRIMARY}15`, color: PRIMARY, borderColor: `${PRIMARY}40` } : {}}
                >
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${style.dot}`} />
                  {s.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Contacto */}
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Contacto</p>
          <div className="space-y-2">
            <PanelRow label="Email" value={lead.email} href={`mailto:${lead.email}`} />
            <PanelRow label="Teléfono" value={lead.phone} href={`tel:${lead.phone}`} />
            {lead.tipo_usuario && (
              <PanelRow
                label="Tipo"
                value={lead.tipo_usuario === "profesional" ? "Profesional" : "Ciudadano"}
              />
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
                  <p className="text-sm text-gray-700 whitespace-pre-line leading-relaxed">{lead.mensaje}</p>
                </div>
              )}
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
            placeholder="Añade notas sobre este lead…"
            rows={4}
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-700 placeholder-gray-400 focus:outline-none resize-none transition-colors"
            style={{ borderColor: notesDirty ? PRIMARY : undefined }}
          />
          {notesDirty && (
            <button
              onClick={saveNotes}
              className="mt-2 text-xs font-semibold transition-opacity hover:opacity-80"
              style={{ color: PRIMARY }}
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
