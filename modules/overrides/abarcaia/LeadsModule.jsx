"use client";

import { useEffect, useState, useCallback, useRef } from "react";

// ─── Configuración QEC ────────────────────────────────────────────────────────

const EMPRESAS = [
  { key: "Quality Energy Consulting", label: "Quality Energy" },
  { key: "Made of Energy", label: "Made of Energy" },
  { key: "Iluminia Quantum", label: "Iluminia Quantum" },
];

const EMPRESA_STYLE = {
  "Quality Energy Consulting": "bg-green-100 text-green-700",
  "Made of Energy": "bg-amber-100 text-amber-700",
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

const CARGO_STYLE = {
  Autónomo: "bg-amber-100 text-amber-700",
  "Trabajador por cuenta ajena": "bg-blue-100 text-blue-700",
};

const CARGOS = ["Autónomo", "Trabajador por cuenta ajena"];

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
}

// ─── Parser CSV ───────────────────────────────────────────────────────────────

const CSV_HEADER_MAP = {
  nombre: "name",
  name: "name",
  candidato: "name",
  email: "email",
  correo: "email",
  "e-mail": "email",
  telefono: "phone",
  teléfono: "phone",
  phone: "phone",
  movil: "phone",
  móvil: "phone",
  empresa: "empresa",
  company: "empresa",
  cargo: "cargo",
  "empresa actual": "empresa_actual",
  empresa_actual: "empresa_actual",
  notas: "notes",
  notes: "notes",
  observaciones: "notes",
  comentarios: "notes",
  estado: "stage",
  stage: "stage",
  fase: "stage",
  origen: "source",
  source: "source",
  fuente: "source",
  experiencia: "experience",
  experience: "experience",
  zona: "zona",
  zone: "zona",
  linkedin: "linkedin",
  "linkedin url": "linkedin",
  "perfil linkedin": "linkedin",
};

const STAGE_MAP = {
  nuevo: "new",
  new: "new",
  "nuevo lead": "new",
  contactado: "contacted",
  contacted: "contacted",
  "en seguimiento": "qualified",
  seguimiento: "qualified",
  qualified: "qualified",
  convertido: "won",
  won: "won",
  descartado: "lost",
  lost: "lost",
};

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) {
    return { error: "El CSV debe tener al menos una fila de cabeceras y una de datos." };
  }
  const firstLine = lines[0];
  const sep = firstLine.includes(";") && !firstLine.includes(",") ? ";" : ",";

  function splitLine(line) {
    const result = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else inQuotes = !inQuotes;
      } else if (ch === sep && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  }

  const rawHeaders = splitLine(lines[0]).map((h) => h.toLowerCase().trim());
  const mappedHeaders = rawHeaders.map((h) => CSV_HEADER_MAP[h] || h);

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const values = splitLine(lines[i]);
    const obj = {};
    mappedHeaders.forEach((key, idx) => {
      obj[key] = values[idx] ?? "";
    });
    if (obj.stage) obj.stage = STAGE_MAP[obj.stage.toLowerCase()] || "new";
    rows.push(obj);
  }
  return { headers: mappedHeaders, rows };
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
  const [importOpen, setImportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [checkedIds, setCheckedIds] = useState(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [bulkStageOpen, setBulkStageOpen] = useState(false);

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
          const filtered = data.data.leads.filter(
            (l) => l.customFields?.source !== "referido_abarcaia"
          );
          setLeads(filtered);
          setTotal(data.data.total - (data.data.leads.length - filtered.length));
        }
      })
      .finally(() => setLoading(false));
  }, [activeStage, activeEmpresa, search]);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  useEffect(() => {
    setCheckedIds(new Set());
    setConfirmBulkDelete(false);
    setBulkStageOpen(false);
  }, [activeStage, activeEmpresa, search]);

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

  async function handleSaveLead(leadId, updates) {
    setSaving(true);
    try {
      const res = await fetch(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      if (data.ok) {
        const updated = data.data;
        setLeads((prev) => prev.map((l) => (l.id === leadId ? { ...l, ...updated } : l)));
        if (selected?.id === leadId) setSelected((prev) => ({ ...prev, ...updated }));
        return true;
      }
      return false;
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

  async function handleExport() {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (activeStage !== "all") params.set("stage", activeStage);
      if (activeEmpresa !== "all") params.set("empresa", activeEmpresa);
      if (search.trim()) params.set("search", search.trim());

      const res = await fetch(`/api/leads/export?${params}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `leads_${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  async function handleDelete(leadId) {
    await fetch(`/api/leads/${leadId}`, { method: "DELETE" });
    setLeads((prev) => prev.filter((l) => l.id !== leadId));
    setTotal((prev) => prev - 1);
    closePanel();
  }

  function toggleCheck(id, e) {
    e.stopPropagation();
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleCheckAll() {
    if (checkedIds.size === leads.length) {
      setCheckedIds(new Set());
    } else {
      setCheckedIds(new Set(leads.map((l) => l.id)));
    }
  }

  async function handleBulkStageChange(stage) {
    setSaving(true);
    setBulkStageOpen(false);
    try {
      await Promise.all(
        [...checkedIds].map((id) =>
          fetch(`/api/leads/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ stage }),
          })
        )
      );
      setLeads((prev) => prev.map((l) => (checkedIds.has(l.id) ? { ...l, stage } : l)));
      if (selected && checkedIds.has(selected.id)) setSelected((prev) => ({ ...prev, stage }));
      setCheckedIds(new Set());
    } finally {
      setSaving(false);
    }
  }

  async function handleBulkDelete() {
    setSaving(true);
    try {
      await Promise.all([...checkedIds].map((id) => fetch(`/api/leads/${id}`, { method: "DELETE" })));
      const deletedCount = checkedIds.size;
      setLeads((prev) => prev.filter((l) => !checkedIds.has(l.id)));
      setTotal((prev) => prev - deletedCount);
      if (selected && checkedIds.has(selected.id)) closePanel();
      setCheckedIds(new Set());
      setConfirmBulkDelete(false);
    } finally {
      setSaving(false);
    }
  }

  const allChecked = leads.length > 0 && checkedIds.size === leads.length;
  const someChecked = checkedIds.size > 0;

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
            <div className="flex items-center gap-2">
              <button
                onClick={handleExport}
                disabled={exporting}
                className="flex items-center gap-2 bg-white border border-gray-200 hover:border-gray-300 text-gray-700 text-sm font-medium px-4 py-2 rounded-lg transition-colors shadow-sm disabled:opacity-50"
              >
                {exporting ? (
                  <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    className="w-4 h-4"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M12 3v13.5m0 0l-4.5-4.5M12 16.5l4.5-4.5"
                    />
                  </svg>
                )}
                <span className="hidden sm:inline">Exportar Excel</span>
              </button>
              <button
                onClick={() => setImportOpen(true)}
                className="flex items-center gap-2 bg-[var(--color-primary)] hover:opacity-90 text-white text-sm font-medium px-4 py-2 rounded-lg transition-opacity shadow-sm"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  className="w-4 h-4"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
                  />
                </svg>
                Importar
              </button>
            </div>
          </div>

          {/* Métricas rápidas */}
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
                <div className="text-gray-900 text-lg lg:text-xl font-semibold">
                  {stageCounts[s.key] ?? 0}
                </div>
              </div>
            ))}
          </div>

          {/* Filtros fila 1 */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 mb-2">
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

          {/* Filtros fila 2: tabs de estado */}
          <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-1 shadow-sm overflow-x-auto min-w-0 mb-3">
            <button
              onClick={() => setActiveStage("all")}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                activeStage === "all"
                  ? "bg-[var(--color-primary)] text-white"
                  : "text-gray-500 hover:text-gray-700"
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

        {/* Barra bulk */}
        {someChecked && (
          <div className="mx-4 lg:mx-8 mb-3 bg-[var(--color-secondary)] text-white rounded-xl px-4 py-2.5 flex items-center gap-3 flex-wrap">
            <span className="text-sm font-medium">
              {checkedIds.size} seleccionado{checkedIds.size !== 1 ? "s" : ""}
            </span>
            <div className="flex-1" />

            {/* Cambiar estado */}
            <div
              className="relative"
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget)) setBulkStageOpen(false);
              }}
            >
              <button
                onClick={() => setBulkStageOpen((v) => !v)}
                disabled={saving}
                className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
              >
                Cambiar estado
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  className="w-3 h-3"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                </svg>
              </button>
              {bulkStageOpen && (
                <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-50 py-1 min-w-[170px]">
                  {STAGES.map((s) => (
                    <button
                      key={s.key}
                      onClick={() => handleBulkStageChange(s.key)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors text-left"
                    >
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STAGE_STYLE[s.key].dot}`} />
                      {s.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Eliminar bulk */}
            {!confirmBulkDelete ? (
              <button
                onClick={() => setConfirmBulkDelete(true)}
                disabled={saving}
                className="flex items-center gap-1.5 bg-red-500/80 hover:bg-red-500 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  className="w-3.5 h-3.5"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
                  />
                </svg>
                Eliminar
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs text-white/80">¿Eliminar {checkedIds.size} leads?</span>
                <button
                  onClick={handleBulkDelete}
                  disabled={saving}
                  className="bg-red-500 hover:bg-red-600 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                >
                  {saving ? "…" : "Sí, eliminar"}
                </button>
                <button
                  onClick={() => setConfirmBulkDelete(false)}
                  className="bg-white/20 hover:bg-white/30 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                >
                  Cancelar
                </button>
              </div>
            )}

            {/* Deseleccionar */}
            <button
              onClick={() => {
                setCheckedIds(new Set());
                setConfirmBulkDelete(false);
                setBulkStageOpen(false);
              }}
              className="text-white/60 hover:text-white transition-colors"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                className="w-4 h-4"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

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
                      <th className="py-3 px-4 w-10">
                        <input
                          type="checkbox"
                          checked={allChecked}
                          onChange={toggleCheckAll}
                          className="rounded border-gray-300 accent-[var(--color-primary)]"
                        />
                      </th>
                      {[
                        "Nombre",
                        "Teléfono",
                        "Email",
                        "Empresa",
                        "Cargo",
                        "Zona",
                        "Estado",
                        "Recibido",
                      ].map((h) => (
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
                      const cargo = lead.customFields?.cargo;
                      const zone = lead.customFields?.zona ?? lead.customFields?.zone;
                      const empresa = lead.customFields?.empresa;
                      const style = STAGE_STYLE[lead.stage] ?? STAGE_STYLE.new;
                      const isChecked = checkedIds.has(lead.id);
                      return (
                        <tr
                          key={lead.id}
                          onClick={() => openLead(lead)}
                          className={`border-b border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors ${
                            selected?.id === lead.id && panelOpen ? "bg-gray-50" : ""
                          } ${isChecked ? "bg-green-50/40" : ""}`}
                        >
                          <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => toggleCheck(lead.id, e)}
                              className="rounded border-gray-300 accent-[var(--color-primary)]"
                            />
                          </td>
                          <td className="py-3 px-4">
                            <span className="text-gray-900 font-medium">
                              {lead.name || lead.title || "—"}
                            </span>
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
                            {cargo ? (
                              <span
                                className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${CARGO_STYLE[cargo] ?? "bg-gray-100 text-gray-600"}`}
                              >
                                {cargo}
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
                          <td className="py-3 px-4 text-gray-400 text-xs">
                            {formatDate(lead.createdAt)}
                          </td>
                        </tr>
                      );
                    })}
                    {leads.length === 0 && (
                      <tr>
                        <td colSpan={9} className="py-16 text-center text-gray-400 text-sm">
                          {search || activeStage !== "all"
                            ? "Sin resultados para ese filtro"
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
                  const cargo = lead.customFields?.cargo;
                  const zone = lead.customFields?.zona ?? lead.customFields?.zone;
                  const empresa = lead.customFields?.empresa;
                  const style = STAGE_STYLE[lead.stage] ?? STAGE_STYLE.new;
                  const isChecked = checkedIds.has(lead.id);
                  return (
                    <div
                      key={lead.id}
                      onClick={() => openLead(lead)}
                      className={`bg-white rounded-2xl border shadow-sm p-4 cursor-pointer active:scale-[0.99] transition-all ${
                        isChecked ? "border-[var(--color-primary)] bg-green-50/30" : "border-gray-200"
                      }`}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-start gap-2.5 min-w-0 mr-2">
                          <div className="mt-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => toggleCheck(lead.id, e)}
                              className="rounded border-gray-300 accent-[var(--color-primary)]"
                            />
                          </div>
                          <div className="min-w-0">
                            <div className="font-semibold text-gray-900 truncate">
                              {lead.name || lead.title || "—"}
                            </div>
                            <div className="text-xs text-gray-400">{lead.email || "—"}</div>
                          </div>
                        </div>
                        <span
                          className={`inline-block shrink-0 text-[11px] px-2.5 py-1 rounded-full font-medium ${style.bg}`}
                        >
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
                        {cargo && (
                          <span
                            className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${CARGO_STYLE[cargo] ?? "bg-gray-100 text-gray-600"}`}
                          >
                            {cargo}
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
                      : "Todavía no hay leads."}
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
        onSave={handleSaveLead}
        onNotesChange={handleNotesChange}
        onDelete={handleDelete}
      />

      {/* ── Modal de importación ────────────────────────────────────────────── */}
      {importOpen && (
        <ImportModal
          onClose={() => setImportOpen(false)}
          onImported={() => {
            setImportOpen(false);
            fetchLeads();
          }}
        />
      )}
    </div>
  );
}

// ─── Modal de importación (CSV + Excel) ──────────────────────────────────────

function ImportModal({ onClose, onImported }) {
  const [tab, setTab] = useState("file");
  const [csvText, setCsvText] = useState("");
  const [parsed, setParsed] = useState(null);
  const [currentFile, setCurrentFile] = useState(null);
  const [fileType, setFileType] = useState("csv");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  function isExcel(file) {
    const name = file.name?.toLowerCase() ?? "";
    return name.endsWith(".xlsx") || name.endsWith(".xls");
  }

  function handleFileRead(file) {
    if (!file) return;
    setCurrentFile(file);
    if (isExcel(file)) {
      setFileType("excel");
      setParsed({ isExcel: true, fileName: file.name });
    } else {
      setFileType("csv");
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target.result;
        setCsvText(text);
        setParsed(parseCSV(text));
      };
      reader.readAsText(file, "UTF-8");
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileRead(file);
  }

  function handlePasteChange(e) {
    const text = e.target.value;
    setCsvText(text);
    setCurrentFile(null);
    setFileType("csv");
    setParsed(text.trim() ? parseCSV(text) : null);
  }

  async function handleImport() {
    if (!parsed) return;
    setImporting(true);
    try {
      let res;
      if (fileType === "excel" && currentFile) {
        const formData = new FormData();
        formData.append("file", currentFile);
        res = await fetch("/api/leads/import/excel", { method: "POST", body: formData });
      } else {
        if (!parsed.rows?.length) return;
        res = await fetch("/api/leads/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leads: parsed.rows }),
        });
      }
      const data = await res.json();
      setResult(data.ok ? data.data : { error: data.error || "Error desconocido" });
    } catch {
      setResult({ error: "Error de red al importar" });
    } finally {
      setImporting(false);
    }
  }

  function handleClose() {
    if (result?.imported > 0) onImported();
    else onClose();
  }

  function resetFile() {
    setParsed(null);
    setCurrentFile(null);
    setCsvText("");
    setFileType("csv");
  }

  const canImport =
    parsed &&
    !parsed.error &&
    (parsed.isExcel || (parsed.rows?.length ?? 0) > 0);

  const PREVIEW_COLS = ["name", "email", "phone", "empresa", "cargo", "zona", "linkedin", "stage"];
  const PREVIEW_LABELS = {
    name: "Nombre",
    email: "Email",
    phone: "Teléfono",
    empresa: "Empresa",
    cargo: "Cargo",
    zona: "Zona",
    linkedin: "LinkedIn",
    stage: "Estado",
  };
  const previewCols = parsed?.headers
    ? PREVIEW_COLS.filter((c) => parsed.headers.includes(c))
    : [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4"
      onClick={(e) => e.target === e.currentTarget && handleClose()}
    >
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-5 pt-5 pb-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-gray-900 font-semibold text-base">Importar leads</h2>
            <p className="text-gray-400 text-xs mt-0.5">
              Excel (.xlsx) o CSV · Campos: nombre, email, teléfono, empresa, cargo, zona, linkedin,
              notas
            </p>
          </div>
          <button onClick={handleClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {result ? (
            <div className="py-6 text-center">
              {result.error ? (
                <>
                  <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-3">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      className="w-6 h-6 text-red-500"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
                      />
                    </svg>
                  </div>
                  <p className="text-red-600 font-medium">{result.error}</p>
                </>
              ) : (
                <>
                  <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-3">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      className="w-6 h-6 text-green-600"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  </div>
                  <p className="text-gray-900 font-semibold text-lg">{result.imported} leads importados</p>
                  {result.skipped > 0 && (
                    <p className="text-gray-400 text-sm mt-1">
                      {result.skipped} filas omitidas (sin datos)
                    </p>
                  )}
                  {result.errors?.length > 0 && (
                    <p className="text-red-500 text-sm mt-1">
                      {result.errors.length} errores en filas:{" "}
                      {result.errors.map((e) => e.row).join(", ")}
                    </p>
                  )}
                </>
              )}
              <button
                onClick={handleClose}
                className="mt-5 bg-[var(--color-primary)] text-white px-5 py-2 rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
              >
                {result.imported > 0 ? "Ver leads" : "Cerrar"}
              </button>
            </div>
          ) : (
            <>
              {/* Tabs */}
              <div className="flex gap-1 bg-gray-100 rounded-lg p-1 mb-4">
                {[
                  {
                    key: "file",
                    label: "Subir archivo",
                    icon: "M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z",
                  },
                  {
                    key: "paste",
                    label: "Pegar CSV",
                    icon: "M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z",
                  },
                ].map(({ key, label, icon }) => (
                  <button
                    key={key}
                    onClick={() => {
                      setTab(key);
                      resetFile();
                    }}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-sm font-medium transition-colors ${
                      tab === key ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
                    }`}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      className="w-4 h-4"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
                    </svg>
                    {label}
                  </button>
                ))}
              </div>

              {/* Zona drop archivo */}
              {tab === "file" && !parsed && (
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                  className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer ${
                    dragOver
                      ? "border-[var(--color-primary)] bg-green-50"
                      : "border-gray-200 hover:border-gray-300 bg-gray-50"
                  }`}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    className="w-10 h-10 text-gray-300 mx-auto mb-3"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
                    />
                  </svg>
                  <p className="text-gray-500 text-sm mb-1">
                    Arrastra tu archivo o haz clic para seleccionar
                  </p>
                  <p className="text-gray-400 text-xs mt-1">Excel (.xlsx) o CSV (.csv) · UTF-8</p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    onChange={(e) => handleFileRead(e.target.files[0])}
                    className="hidden"
                  />
                </div>
              )}

              {/* Pegar texto */}
              {tab === "paste" && !parsed && (
                <div>
                  <textarea
                    value={csvText}
                    onChange={handlePasteChange}
                    placeholder={`Pega aquí el CSV. Ejemplo:\n\nnombre,email,telefono,empresa,cargo,zona,linkedin\nJuan García,juan@qec.com,600123456,Quality Energy Consulting,Autónomo,Madrid,https://linkedin.com/in/juangarcia`}
                    rows={10}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-700 placeholder-gray-300 focus:outline-none focus:border-[var(--color-primary)] transition-colors resize-none font-mono"
                  />
                  <p className="text-gray-400 text-xs mt-2">
                    Cabeceras reconocidas en español e inglés. Separador: coma o punto y coma.
                  </p>
                </div>
              )}

              {/* Preview Excel */}
              {parsed?.isExcel && (
                <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    className="w-8 h-8 text-green-600 shrink-0"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                    />
                  </svg>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-green-800 truncate">{parsed.fileName}</p>
                    <p className="text-xs text-green-600 mt-0.5">Archivo Excel listo para importar</p>
                  </div>
                  <button
                    onClick={resetFile}
                    className="text-green-400 hover:text-green-600 transition-colors shrink-0"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      className="w-4 h-4"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              )}

              {/* Preview CSV */}
              {parsed && !parsed.isExcel && (
                <div>
                  {parsed.error ? (
                    <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-600">
                      {parsed.error}
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-sm text-gray-700 font-medium">
                          {parsed.rows.length} fila{parsed.rows.length !== 1 ? "s" : ""} detectada
                          {parsed.rows.length !== 1 ? "s" : ""}
                        </p>
                        <button
                          onClick={resetFile}
                          className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                        >
                          Limpiar
                        </button>
                      </div>
                      {previewCols.length > 0 && (
                        <div className="rounded-xl border border-gray-200 overflow-hidden mb-3">
                          <div className="overflow-x-auto max-h-48">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="bg-gray-50 border-b border-gray-200">
                                  {previewCols.map((c) => (
                                    <th
                                      key={c}
                                      className="text-left py-2 px-3 text-[10px] font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap"
                                    >
                                      {PREVIEW_LABELS[c] ?? c}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {parsed.rows.slice(0, 5).map((row, i) => (
                                  <tr key={i} className="border-b border-gray-100">
                                    {previewCols.map((c) => (
                                      <td
                                        key={c}
                                        className="py-2 px-3 text-gray-600 max-w-[140px] truncate"
                                      >
                                        {row[c] || <span className="text-gray-300">—</span>}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          {parsed.rows.length > 5 && (
                            <div className="px-3 py-2 bg-gray-50 border-t border-gray-200 text-xs text-gray-400">
                              + {parsed.rows.length - 5} filas más
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {!result && (
          <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-between gap-3">
            <button
              onClick={handleClose}
              className="text-sm text-gray-500 hover:text-gray-700 transition-colors font-medium"
            >
              Cancelar
            </button>
            <button
              onClick={handleImport}
              disabled={!canImport || importing}
              className="flex items-center gap-2 bg-[var(--color-primary)] hover:opacity-90 disabled:opacity-40 text-white text-sm font-medium px-5 py-2 rounded-lg transition-opacity"
            >
              {importing ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Importando…
                </>
              ) : (
                <>
                  Importar
                  {!parsed?.isExcel && parsed?.rows?.length
                    ? ` ${parsed.rows.length} leads`
                    : ""}
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Panel de detalle ─────────────────────────────────────────────────────────

function LeadDetailPanel({ lead, open, saving, onClose, onStageChange, onSave, onNotesChange, onDelete }) {
  const [notes, setNotes] = useState("");
  const [notesDirty, setNotesDirty] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState({});

  useEffect(() => {
    if (lead) {
      setNotes(lead.notes ?? "");
      setNotesDirty(false);
      setConfirmDelete(false);
      setEditMode(false);
    }
  }, [lead?.id]);

  function openEdit() {
    setEditForm({
      name: lead.name || "",
      phone: lead.phone || "",
      email: lead.email || "",
      empresa: lead.customFields?.empresa || "",
      cargo: lead.customFields?.cargo || "",
      empresa_actual: lead.customFields?.empresa_actual || "",
      zona: lead.customFields?.zona ?? lead.customFields?.zone ?? "",
      linkedin: lead.customFields?.linkedin || "",
    });
    setEditMode(true);
  }

  async function saveEdit() {
    const updates = {
      name: editForm.name.trim() || null,
      phone: editForm.phone.trim() || null,
      email: editForm.email.trim() || null,
      customFields: {
        empresa: editForm.empresa || null,
        cargo: editForm.cargo || null,
        empresa_actual:
          editForm.cargo === "Trabajador por cuenta ajena"
            ? editForm.empresa_actual.trim() || null
            : null,
        zona: editForm.zona.trim() || null,
        linkedin: editForm.linkedin.trim() || null,
      },
    };
    const ok = await onSave(lead.id, updates);
    if (ok) setEditMode(false);
  }

  async function saveNotes() {
    await onNotesChange(lead.id, notes);
    setNotesDirty(false);
  }

  if (!lead) return null;

  const cargo = lead.customFields?.cargo;
  const empresaActual = lead.customFields?.empresa_actual;
  const zone = lead.customFields?.zona ?? lead.customFields?.zone;
  const empresa = lead.customFields?.empresa;
  const linkedin = lead.customFields?.linkedin;
  const utmSource = lead.customFields?.utmSource;
  const utmMedium = lead.customFields?.utmMedium;
  const utmCampaign = lead.customFields?.utmCampaign;

  return (
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
        <div className="flex items-center gap-2 shrink-0 mt-0.5">
          {!editMode && (
            <button
              onClick={openEdit}
              title="Editar lead"
              className="text-gray-400 hover:text-gray-700 transition-colors"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10"
                />
              </svg>
            </button>
          )}
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {editMode ? (
        /* ── Modo edición ── */
        <div className="flex-1 overflow-y-auto px-5 py-5">
          <div className="space-y-4">
            <div>
              <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                Nombre
              </label>
              <input
                type="text"
                value={editForm.name}
                onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:border-[var(--color-primary)] transition-colors"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                Teléfono
              </label>
              <input
                type="tel"
                value={editForm.phone}
                onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))}
                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:border-[var(--color-primary)] transition-colors"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                Email
              </label>
              <input
                type="email"
                value={editForm.email}
                onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:border-[var(--color-primary)] transition-colors"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                Empresa QEC
              </label>
              <select
                value={editForm.empresa}
                onChange={(e) => setEditForm((f) => ({ ...f, empresa: e.target.value }))}
                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:border-[var(--color-primary)] transition-colors"
              >
                <option value="">Sin asignar</option>
                {EMPRESAS.map((e) => (
                  <option key={e.key} value={e.key}>
                    {e.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                Cargo
              </label>
              <select
                value={editForm.cargo}
                onChange={(e) => setEditForm((f) => ({ ...f, cargo: e.target.value }))}
                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:border-[var(--color-primary)] transition-colors"
              >
                <option value="">Sin especificar</option>
                {CARGOS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            {editForm.cargo === "Trabajador por cuenta ajena" && (
              <div>
                <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                  Empresa actual
                </label>
                <input
                  type="text"
                  value={editForm.empresa_actual}
                  onChange={(e) => setEditForm((f) => ({ ...f, empresa_actual: e.target.value }))}
                  placeholder="Empresa donde trabaja actualmente"
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:border-[var(--color-primary)] transition-colors"
                />
              </div>
            )}
            <div>
              <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                Zona
              </label>
              <input
                type="text"
                value={editForm.zona}
                onChange={(e) => setEditForm((f) => ({ ...f, zona: e.target.value }))}
                placeholder="Madrid, Barcelona…"
                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:border-[var(--color-primary)] transition-colors"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                LinkedIn <span className="text-gray-300 font-normal normal-case">(opcional)</span>
              </label>
              <input
                type="url"
                value={editForm.linkedin}
                onChange={(e) => setEditForm((f) => ({ ...f, linkedin: e.target.value }))}
                placeholder="https://linkedin.com/in/…"
                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:border-[var(--color-primary)] transition-colors"
              />
            </div>
          </div>
          <div className="flex gap-2 mt-6">
            <button
              onClick={saveEdit}
              disabled={saving}
              className="flex-1 bg-[var(--color-primary)] hover:opacity-90 text-white text-sm font-semibold py-2.5 rounded-lg transition-opacity disabled:opacity-50"
            >
              {saving ? "Guardando…" : "Guardar cambios"}
            </button>
            <button
              onClick={() => setEditMode(false)}
              className="px-4 bg-white border border-gray-200 text-gray-600 text-sm font-medium py-2.5 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        /* ── Modo vista ── */
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
          {/* Estado */}
          <div>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">
              Estado
            </p>
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

          {/* Contacto */}
          <div>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-3">
              Contacto
            </p>
            <div className="space-y-2.5">
              <DetailRow icon="phone" label="Teléfono" value={lead.phone} href={`tel:${lead.phone}`} />
              <DetailRow icon="email" label="Email" value={lead.email} href={`mailto:${lead.email}`} />
              {linkedin && (
                <div className="flex items-center gap-3">
                  <span className="text-gray-400 shrink-0">
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
                      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                    </svg>
                  </span>
                  <span className="text-gray-400 w-20 shrink-0 text-xs">LinkedIn</span>
                  <a
                    href={linkedin}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:text-blue-700 text-xs transition-colors"
                  >
                    Ver perfil →
                  </a>
                </div>
              )}
            </div>
          </div>

          {/* Perfil comercial */}
          <div>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-3">
              Perfil comercial
            </p>
            <div className="space-y-2.5">
              <div className="flex items-start gap-3">
                <span className="text-gray-400 w-28 shrink-0 text-xs mt-0.5">Empresa</span>
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
                <span className="text-gray-400 w-28 shrink-0 text-xs mt-0.5">Cargo</span>
                {cargo ? (
                  <span
                    className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${CARGO_STYLE[cargo] ?? "bg-gray-100 text-gray-600"}`}
                  >
                    {cargo}
                  </span>
                ) : (
                  <span className="text-gray-300 text-xs">No indicado</span>
                )}
              </div>
              {cargo === "Trabajador por cuenta ajena" && (
                <div className="flex items-start gap-3">
                  <span className="text-gray-400 w-28 shrink-0 text-xs mt-0.5">Empresa actual</span>
                  <span className="text-gray-700 text-xs">{empresaActual || "No indicado"}</span>
                </div>
              )}
              <div className="flex items-start gap-3">
                <span className="text-gray-400 w-28 shrink-0 text-xs mt-0.5">Zona</span>
                <span className="text-gray-700 text-xs">{zone || "No indicado"}</span>
              </div>
            </div>
          </div>

          {/* UTMs */}
          {(utmSource || utmMedium || utmCampaign) && (
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-3">
                Origen
              </p>
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-1.5">
                {utmSource && <UtmRow label="Fuente" value={utmSource} />}
                {utmMedium && <UtmRow label="Medio" value={utmMedium} />}
                {utmCampaign && <UtmRow label="Campaña" value={utmCampaign} />}
              </div>
            </div>
          )}

          {/* Notas */}
          <div>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">
              Notas internas
            </p>
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

          {/* Eliminar */}
          <div className="pt-2 border-t border-gray-100">
            {confirmDelete ? (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                <p className="text-red-700 text-xs font-medium mb-3">
                  ¿Eliminar este lead? Esta acción no se puede deshacer.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => onDelete(lead.id)}
                    className="flex-1 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold py-2 rounded-lg transition-colors"
                  >
                    Sí, eliminar
                  </button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="flex-1 bg-white border border-gray-200 text-gray-600 text-xs font-semibold py-2 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="flex items-center gap-2 text-gray-400 hover:text-red-500 text-xs font-medium transition-colors py-1"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  className="w-3.5 h-3.5"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
                  />
                </svg>
                Eliminar lead
              </button>
            )}
          </div>
        </div>
      )}
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
