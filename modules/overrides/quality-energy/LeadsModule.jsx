"use client";

import { useEffect, useState, useCallback } from "react";

// ─── Configuración QEC ────────────────────────────────────────────────────────

const EMPRESAS = [
  { key: "Quality Energy Consulting", label: "Quality Energy" },
  { key: "Made of Energy", label: "Made of Energy" },
  { key: "AbarcaIA", label: "AbarcaIA" },
  { key: "Iluminia Quantum", label: "Iluminia Quantum" },
];

const EMPRESA_STYLE = {
  "Quality Energy Consulting": "bg-green-100 text-green-700",
  "Made of Energy": "bg-amber-100 text-amber-700",
  AbarcaIA: "bg-blue-100 text-blue-700",
  "Iluminia Quantum": "bg-purple-100 text-purple-700",
};

const STAGES = [
  { key: "new", label: "Nuevo lead" },
  { key: "contacted", label: "Contactado" },
  { key: "qualified", label: "En seguimiento" },
  { key: "won", label: "Convertido" },
  { key: "lost", label: "Descartado" },
];

const STAGE_STYLE = {
  new: { dot: "bg-gray-400", bg: "bg-gray-100 text-gray-600" },
  contacted: { dot: "bg-blue-400", bg: "bg-blue-100 text-blue-700" },
  qualified: { dot: "bg-[var(--color-primary)]", bg: "bg-green-100 text-green-700" },
  won: { dot: "bg-emerald-400", bg: "bg-emerald-100 text-emerald-700" },
  lost: { dot: "bg-red-400", bg: "bg-red-100 text-red-600" },
};

const EXPERIENCE_LABELS = {
  experienced: "Con experiencia",
  other_sector: "Otro sector",
  freelancer: "Autónomo",
};

const EXPERIENCE_STYLE = {
  experienced: "bg-green-100 text-green-700",
  other_sector: "bg-gray-100 text-gray-600",
  freelancer: "bg-amber-100 text-amber-700",
};

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function QECLeadsModule() {
  const [leads, setLeads] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [activeStage, setActiveStage] = useState("all");
  const [activeEmpresa, setActiveEmpresa] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchLeads = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ limit: "200" });
    if (activeStage !== "all") params.set("stage", activeStage);
    if (activeEmpresa !== "all") params.set("empresa", activeEmpresa);
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
  }, [activeStage, activeEmpresa, search]);

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
        className={`flex-1 flex flex-col min-w-0 transition-all duration-300 ${panelOpen ? "lg:mr-[440px]" : ""}`}
      >
        {/* Header */}
        <div className="px-4 lg:px-8 pt-6 lg:pt-8 pb-0">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h1 className="text-gray-900 text-xl font-semibold">Leads</h1>
              <p className="text-gray-500 text-sm mt-0.5">
                {total} candidato{total !== 1 ? "s" : ""} en total
              </p>
            </div>
          </div>

          {/* Métricas rápidas — 3 cols móvil, 5 cols desktop */}
          <div className="grid grid-cols-3 lg:grid-cols-5 gap-2 lg:gap-3 mb-5">
            {STAGES.map((s) => (
              <div
                key={s.key}
                className={`bg-white border rounded-xl p-3 cursor-pointer transition-all ${
                  activeStage === s.key
                    ? "border-[var(--color-primary)] shadow-md"
                    : "border-gray-200 hover:border-gray-300 hover:shadow-sm"
                }`}
                onClick={() => setActiveStage(activeStage === s.key ? "all" : s.key)}
              >
                <div className="flex items-center gap-1.5 mb-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STAGE_STYLE[s.key].dot}`} />
                  <span className="text-[9px] lg:text-[10px] text-gray-500 uppercase tracking-wide truncate leading-none">
                    {s.label}
                  </span>
                </div>
                <div className="text-gray-900 text-lg lg:text-xl font-semibold">{stageCounts[s.key] ?? 0}</div>
              </div>
            ))}
          </div>

          {/* Filtros — fila 1: buscador + empresa */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 mb-2">
            {/* Búsqueda */}
            <div className="relative flex-1">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400"
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
                placeholder="Buscar por nombre, email…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-white border border-gray-200 rounded-lg pl-8 pr-3 py-2 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:border-[var(--color-primary)] transition-colors shadow-sm"
              />
            </div>

            {/* Filtro empresa */}
            <select
              value={activeEmpresa}
              onChange={(e) => setActiveEmpresa(e.target.value)}
              className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:border-[var(--color-primary)] transition-colors shadow-sm shrink-0"
            >
              <option value="all">Todas las empresas</option>
              {EMPRESAS.map((e) => (
                <option key={e.key} value={e.key}>
                  {e.label}
                </option>
              ))}
            </select>
          </div>

          {/* Filtros — fila 2: tabs de estado */}
          <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-1 shadow-sm overflow-x-auto min-w-0 mb-4">
            <button
              onClick={() => setActiveStage("all")}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                activeStage === "all" ? "bg-[var(--color-primary)] text-white" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              Todos
            </button>
            {STAGES.map((s) => (
              <button
                key={s.key}
                onClick={() => setActiveStage(s.key)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  activeStage === s.key
                    ? "bg-[var(--color-primary)] text-white"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Contenido */}
        <div className="flex-1 px-4 lg:px-8 pb-8 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-5 h-5 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              {/* Desktop: tabla */}
              <div className="hidden lg:block rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      {["Nombre", "Teléfono", "Email", "Empresa", "Experiencia", "Zona", "Estado", "Recibido"].map((h) => (
                        <th
                          key={h}
                          className="text-left py-3 px-4 text-[10px] font-semibold text-gray-500 uppercase tracking-wide"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {leads.map((lead) => {
                      const exp = lead.customFields?.experience;
                      const zone = lead.customFields?.zone;
                      const empresa = lead.customFields?.empresa;
                      const style = STAGE_STYLE[lead.stage] ?? STAGE_STYLE.new;
                      return (
                        <tr
                          key={lead.id}
                          onClick={() => openLead(lead)}
                          className={`border-b border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors ${
                            selected?.id === lead.id && panelOpen ? "bg-gray-50" : ""
                          }`}
                        >
                          <td className="py-3 px-4">
                            <span className="text-gray-900 font-medium">{lead.name || lead.title || "—"}</span>
                          </td>
                          <td className="py-3 px-4">
                            <a
                              href={`tel:${lead.phone}`}
                              onClick={(e) => e.stopPropagation()}
                              className="text-gray-500 hover:text-[var(--color-primary)] transition-colors"
                            >
                              {lead.phone || "—"}
                            </a>
                          </td>
                          <td className="py-3 px-4">
                            <span className="text-gray-500">{lead.email || "—"}</span>
                          </td>
                          <td className="py-3 px-4">
                            {empresa ? (
                              <span
                                className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${EMPRESA_STYLE[empresa] ?? "bg-gray-100 text-gray-600"}`}
                              >
                                {empresa}
                              </span>
                            ) : (
                              <span className="text-gray-300">—</span>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            {exp ? (
                              <span
                                className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${EXPERIENCE_STYLE[exp] ?? "bg-gray-100 text-gray-600"}`}
                              >
                                {EXPERIENCE_LABELS[exp] ?? exp}
                              </span>
                            ) : (
                              <span className="text-gray-300">—</span>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <span className="text-gray-500">{zone || "—"}</span>
                          </td>
                          <td className="py-3 px-4">
                            <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${style.bg}`}>
                              {STAGES.find((s) => s.key === lead.stage)?.label ?? lead.stage}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-gray-400 text-xs">{formatDate(lead.createdAt)}</td>
                        </tr>
                      );
                    })}
                    {leads.length === 0 && (
                      <tr>
                        <td colSpan={7} className="py-16 text-center text-gray-400 text-sm">
                          {search || activeStage !== "all"
                            ? "Sin resultados para ese filtro"
                            : "Todavía no hay leads. Los nuevos llegarán aquí desde n8n."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Mobile: tarjetas */}
              <div className="lg:hidden space-y-3">
                {leads.map((lead) => {
                  const exp = lead.customFields?.experience;
                  const zone = lead.customFields?.zone;
                  const empresa = lead.customFields?.empresa;
                  const style = STAGE_STYLE[lead.stage] ?? STAGE_STYLE.new;
                  return (
                    <div
                      key={lead.id}
                      onClick={() => openLead(lead)}
                      className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 cursor-pointer active:scale-[0.99] transition-transform"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="min-w-0 mr-3">
                          <div className="font-semibold text-gray-900 truncate">
                            {lead.name || lead.title || "—"}
                          </div>
                          <div className="text-xs text-gray-400">{lead.email || "—"}</div>
                        </div>
                        <span className={`inline-block shrink-0 text-[11px] px-2.5 py-1 rounded-full font-medium ${style.bg}`}>
                          {STAGES.find((s) => s.key === lead.stage)?.label ?? lead.stage}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {empresa && (
                          <span
                            className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${EMPRESA_STYLE[empresa] ?? "bg-gray-100 text-gray-600"}`}
                          >
                            {empresa}
                          </span>
                        )}
                        {exp && (
                          <span
                            className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${EXPERIENCE_STYLE[exp] ?? "bg-gray-100 text-gray-600"}`}
                          >
                            {EXPERIENCE_LABELS[exp] ?? exp}
                          </span>
                        )}
                        {zone && (
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium">
                            {zone}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center justify-between mt-3">
                        <span className="text-xs text-gray-400">{formatDate(lead.createdAt)}</span>
                        {lead.phone && (
                          <a
                            href={`tel:${lead.phone}`}
                            onClick={(e) => e.stopPropagation()}
                            className="text-xs text-[var(--color-primary)] font-medium"
                          >
                            {lead.phone}
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
                {leads.length === 0 && (
                  <div className="py-16 text-center text-gray-400 text-sm">
                    {search || activeStage !== "all"
                      ? "Sin resultados para ese filtro"
                      : "Todavía no hay leads. Los nuevos llegarán aquí desde n8n."}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Panel lateral ───────────────────────────────────────────────────── */}
      <LeadDetailPanel
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

// ─── Panel de detalle ─────────────────────────────────────────────────────────

function LeadDetailPanel({ lead, open, saving, onClose, onStageChange, onNotesChange }) {
  const [notes, setNotes] = useState("");
  const [notesDirty, setNotesDirty] = useState(false);

  useEffect(() => {
    if (lead) {
      setNotes(lead.notes ?? "");
      setNotesDirty(false);
    }
  }, [lead?.id]);

  if (!lead) return null;

  const exp = lead.customFields?.experience;
  const zone = lead.customFields?.zone;
  const empresa = lead.customFields?.empresa;
  const utmSource = lead.customFields?.utmSource;
  const utmMedium = lead.customFields?.utmMedium;
  const utmCampaign = lead.customFields?.utmCampaign;

  async function saveNotes() {
    await onNotesChange(lead.id, notes);
    setNotesDirty(false);
  }

  return (
    /* Full-screen en móvil, sidebar en desktop */
    <div
      className={`fixed inset-0 lg:inset-auto lg:top-0 lg:right-0 lg:h-full lg:w-[440px] bg-white border-l border-gray-200 shadow-2xl flex flex-col z-40 transition-transform duration-300 ${
        open ? "translate-x-0" : "translate-x-full"
      }`}
    >
      {/* Header panel */}
      <div className="px-5 pt-5 pb-4 border-b border-gray-100 flex items-start justify-between gap-4 border-t-[3px] border-t-[var(--color-primary)]">
        <div className="min-w-0">
          <h2 className="text-gray-900 font-semibold text-base truncate">
            {lead.name || lead.title || "Sin nombre"}
          </h2>
          <p className="text-gray-400 text-xs mt-0.5">{formatDate(lead.createdAt)}</p>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors shrink-0 mt-0.5">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
        {/* Cambiar estado */}
        <div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Estado</p>
          <div className="grid grid-cols-2 gap-1.5">
            {STAGES.map((s) => {
              const isActive = lead.stage === s.key;
              const style = STAGE_STYLE[s.key];
              return (
                <button
                  key={s.key}
                  disabled={saving}
                  onClick={() => onStageChange(lead.id, s.key)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border transition-colors disabled:opacity-50 ${
                    isActive
                      ? "border-[var(--color-primary)] bg-green-50 text-green-700"
                      : "border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-700 bg-white"
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${style.dot}`} />
                  {s.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Datos de contacto */}
        <div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-3">Contacto</p>
          <div className="space-y-2.5">
            <DetailRow icon="phone" label="Teléfono" value={lead.phone} href={`tel:${lead.phone}`} />
            <DetailRow icon="email" label="Email" value={lead.email} href={`mailto:${lead.email}`} />
          </div>
        </div>

        {/* Perfil comercial */}
        <div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-3">Perfil comercial</p>
          <div className="space-y-2.5">
            <div className="flex items-start gap-3">
              <span className="text-gray-400 w-24 shrink-0 text-xs mt-0.5">Empresa</span>
              {empresa ? (
                <span
                  className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${EMPRESA_STYLE[empresa] ?? "bg-gray-100 text-gray-600"}`}
                >
                  {empresa}
                </span>
              ) : (
                <span className="text-gray-300 text-xs">No indicado</span>
              )}
            </div>
            <div className="flex items-start gap-3">
              <span className="text-gray-400 w-24 shrink-0 text-xs mt-0.5">Experiencia</span>
              {exp ? (
                <span
                  className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${EXPERIENCE_STYLE[exp] ?? "bg-gray-100 text-gray-600"}`}
                >
                  {EXPERIENCE_LABELS[exp] ?? exp}
                </span>
              ) : (
                <span className="text-gray-300 text-xs">No indicado</span>
              )}
            </div>
            <div className="flex items-start gap-3">
              <span className="text-gray-400 w-24 shrink-0 text-xs mt-0.5">Zona</span>
              <span className="text-gray-700 text-xs">{zone || "No indicado"}</span>
            </div>
          </div>
        </div>

        {/* UTMs */}
        {(utmSource || utmMedium || utmCampaign) && (
          <div>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-3">Origen</p>
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-1.5">
              {utmSource && <UtmRow label="Fuente" value={utmSource} />}
              {utmMedium && <UtmRow label="Medio" value={utmMedium} />}
              {utmCampaign && <UtmRow label="Campaña" value={utmCampaign} />}
            </div>
          </div>
        )}

        {/* Notas */}
        <div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Notas internas</p>
          <textarea
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
              setNotesDirty(true);
            }}
            placeholder="Añade notas sobre este lead…"
            rows={4}
            className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:border-[var(--color-primary)] transition-colors resize-none"
          />
          {notesDirty && (
            <button
              onClick={saveNotes}
              className="mt-2 text-xs text-[var(--color-primary)] hover:opacity-80 transition-opacity font-medium"
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

function DetailRow({ icon, label, value, href }) {
  const icons = {
    phone: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-3.5 h-3.5">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z"
        />
      </svg>
    ),
    email: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-3.5 h-3.5">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"
        />
      </svg>
    ),
  };

  return (
    <div className="flex items-center gap-3">
      <span className="text-gray-400 shrink-0">{icons[icon]}</span>
      <span className="text-gray-400 w-20 shrink-0 text-xs">{label}</span>
      {value ? (
        href ? (
          <a href={href} className="text-gray-700 text-xs hover:text-[var(--color-primary)] transition-colors">
            {value}
          </a>
        ) : (
          <span className="text-gray-700 text-xs">{value}</span>
        )
      ) : (
        <span className="text-gray-300 text-xs">—</span>
      )}
    </div>
  );
}

function UtmRow({ label, value }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-gray-400 w-16 shrink-0">{label}</span>
      <span className="text-gray-600 font-mono">{value}</span>
    </div>
  );
}
