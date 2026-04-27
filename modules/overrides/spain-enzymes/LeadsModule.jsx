"use client";

import { useEffect, useState, useCallback, useRef } from "react";

// ─── Configuración Spain Enzymes ──────────────────────────────────────────────

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
  qualified: { dot: "bg-amber-400", bg: "bg-amber-100 text-amber-700" },
  won: { dot: "bg-emerald-400", bg: "bg-emerald-100 text-emerald-700" },
  lost: { dot: "bg-red-400", bg: "bg-red-100 text-red-600" },
};

const PRIORITY_LABELS = { alta: "Alta", media: "Media", baja: "Baja" };
const PRIORITY_STYLE = {
  alta: "bg-red-100 text-red-700",
  media: "bg-amber-100 text-amber-700",
  baja: "bg-blue-100 text-blue-700",
};

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
}

// ─── CSV Parser ───────────────────────────────────────────────────────────────

const CSV_HEADER_MAP = {
  nombre: "name",
  name: "name",
  empresa: "empresa",
  company: "empresa",
  email: "email",
  correo: "email",
  telefono: "phone",
  teléfono: "phone",
  phone: "phone",
  "país": "pais",
  pais: "pais",
  country: "pais",
  ciudad: "ciudad",
  city: "ciudad",
  asunto: "asunto",
  subject: "asunto",
  mensaje: "mensaje",
  message: "mensaje",
  notas: "mensaje",
  notes: "mensaje",
  estado: "stage",
  stage: "stage",
  prioridad: "prioridad",
  priority: "prioridad",
};

const STAGE_MAP = {
  "nuevo lead": "new",
  nuevo: "new",
  new: "new",
  contactado: "contacted",
  contacted: "contacted",
  "en seguimiento": "qualified",
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
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = !inQuotes;
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
    mappedHeaders.forEach((key, idx) => { obj[key] = values[idx] ?? ""; });
    if (obj.stage) obj.stage = STAGE_MAP[obj.stage.toLowerCase()] || "new";
    rows.push(obj);
  }
  return { headers: mappedHeaders, rows };
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function SpainEnzymesLeadsModule() {
  const [leads, setLeads] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [activeStage, setActiveStage] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importTab, setImportTab] = useState("csv");
  const [csvText, setCsvText] = useState("");
  const [csvParsed, setCsvParsed] = useState(null);
  const [csvError, setCsvError] = useState("");
  const [importLoading, setImportLoading] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [checkedIds, setCheckedIds] = useState(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [bulkStageOpen, setBulkStageOpen] = useState(false);
  const fileInputRef = useRef(null);

  const fetchLeads = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ limit: "200" });
    if (activeStage !== "all") params.set("stage", activeStage);
    if (search.trim()) params.set("search", search.trim());
    fetch(`/api/leads?${params}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          setLeads(data.data.leads);
          setTotal(data.data.total ?? data.data.leads.length);
        }
      })
      .finally(() => setLoading(false));
  }, [activeStage, search]);

  useEffect(() => {
    const t = setTimeout(fetchLeads, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [fetchLeads, search]);

  const stageCounts = leads.reduce((acc, l) => { acc[l.stage] = (acc[l.stage] || 0) + 1; return acc; }, {});

  function openPanel(lead) { setSelected(lead); setPanelOpen(true); setEditMode(false); }
  function closePanel() { setPanelOpen(false); setSelected(null); setEditMode(false); }

  function openEdit(lead) {
    setEditForm({
      name: lead.name || "",
      email: lead.email || "",
      phone: lead.phone || "",
      stage: lead.stage || "new",
      notes: lead.notes || "",
      empresa: lead.customFields?.empresa || "",
      pais: lead.customFields?.pais || "",
      ciudad: lead.customFields?.ciudad || "",
      asunto: lead.customFields?.asunto || "",
      prioridad: lead.customFields?.prioridad || "",
    });
    setEditMode(true);
  }

  async function saveEdit(leadId) {
    setSaving(true);
    try {
      const body = {
        name: editForm.name.trim() || null,
        email: editForm.email.trim() || null,
        phone: editForm.phone.trim() || null,
        stage: editForm.stage,
        notes: editForm.notes.trim() || null,
        customFields: {
          ...(selected?.customFields || {}),
          empresa: editForm.empresa.trim() || null,
          pais: editForm.pais.trim() || null,
          ciudad: editForm.ciudad.trim() || null,
          asunto: editForm.asunto.trim() || null,
          prioridad: editForm.prioridad || null,
        },
      };
      const res = await fetch(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) {
        const updated = { ...selected, ...body };
        setSelected(updated);
        setLeads((prev) => prev.map((l) => (l.id === leadId ? updated : l)));
        setEditMode(false);
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (activeStage !== "all") params.set("stage", activeStage);
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

  async function handleDownloadTemplate() {
    const res = await fetch("/api/leads/import/template");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "plantilla_leads.xlsx";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleDelete(leadId) {
    await fetch(`/api/leads/${leadId}`, { method: "DELETE" });
    setLeads((prev) => prev.filter((l) => l.id !== leadId));
    setTotal((prev) => prev - 1);
    closePanel();
  }

  function toggleCheck(id, e) {
    e.stopPropagation();
    setCheckedIds((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  function toggleCheckAll() {
    if (checkedIds.size === leads.length) setCheckedIds(new Set());
    else setCheckedIds(new Set(leads.map((l) => l.id)));
  }

  async function handleBulkStageChange(stage) {
    setSaving(true);
    setBulkStageOpen(false);
    try {
      await Promise.all([...checkedIds].map((id) =>
        fetch(`/api/leads/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage }) })
      ));
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

  function handleCsvTextChange(text) {
    setCsvText(text);
    setCsvError("");
    setCsvParsed(null);
    setImportResult(null);
    if (!text.trim()) return;
    const result = parseCSV(text);
    if (result.error) setCsvError(result.error);
    else setCsvParsed(result);
  }

  async function handleCsvImport() {
    if (!csvParsed) return;
    setImportLoading(true);
    setImportResult(null);
    try {
      const payload = csvParsed.rows.map((row) => ({
        name: row.name || null,
        email: row.email || null,
        phone: row.phone || null,
        notes: row.mensaje || null,
        stage: row.stage || "new",
        source: "csv_import",
        customFields: {
          empresa: row.empresa || null,
          pais: row.pais || null,
          ciudad: row.ciudad || null,
          asunto: row.asunto || null,
          prioridad: row.prioridad || null,
        },
      }));
      const res = await fetch("/api/leads/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leads: payload }),
      });
      const data = await res.json();
      setImportResult(data);
      if (data.ok) { fetchLeads(); setCsvText(""); setCsvParsed(null); }
    } finally {
      setImportLoading(false);
    }
  }

  async function handleExcelImport(file) {
    if (!file) return;
    setImportLoading(true);
    setImportResult(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/leads/import/excel", { method: "POST", body: formData });
      const data = await res.json();
      setImportResult(data);
      if (data.ok) fetchLeads();
    } finally {
      setImportLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  const allChecked = leads.length > 0 && checkedIds.size === leads.length;
  const someChecked = checkedIds.size > 0;

  return (
    <div className="flex h-full bg-gray-50">
      {/* ── Lista principal ───────────────────────────────────────────────── */}
      <div className={`flex-1 flex flex-col min-w-0 transition-all duration-300 ${panelOpen ? "lg:mr-[440px]" : ""}`}>

        {/* Header */}
        <div className="px-4 lg:px-8 pt-6 lg:pt-8 pb-0">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h1 className="text-gray-900 text-xl font-semibold">Leads</h1>
              <p className="text-gray-500 text-sm mt-0.5">{total} lead{total !== 1 ? "s" : ""} en total</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleDownloadTemplate}
                className="flex items-center gap-2 bg-white border border-gray-200 hover:border-gray-300 text-gray-700 text-sm font-medium px-4 py-2 rounded-lg transition-colors shadow-sm"
                title="Descargar plantilla de importación"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                </svg>
                <span className="hidden sm:inline">Plantilla</span>
              </button>
              <button
                onClick={handleExport}
                disabled={exporting}
                className="flex items-center gap-2 bg-white border border-gray-200 hover:border-gray-300 text-gray-700 text-sm font-medium px-4 py-2 rounded-lg transition-colors shadow-sm disabled:opacity-50"
              >
                {exporting ? (
                  <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M12 3v13.5m0 0l-4.5-4.5M12 16.5l4.5-4.5" />
                  </svg>
                )}
                <span className="hidden sm:inline">Exportar Excel</span>
              </button>
              <button
                onClick={() => { setImportOpen(true); setImportResult(null); setCsvText(""); setCsvParsed(null); setCsvError(""); }}
                className="flex items-center gap-2 bg-[var(--color-primary)] hover:opacity-90 text-white text-sm font-medium px-4 py-2 rounded-lg transition-opacity shadow-sm"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
                Importar
              </button>
            </div>
          </div>

          {/* Métricas */}
          <div className="grid grid-cols-3 lg:grid-cols-5 gap-2 lg:gap-3 mb-5">
            {STAGES.map((s) => (
              <div
                key={s.key}
                className={`bg-white border rounded-xl p-3 cursor-pointer transition-all ${
                  activeStage === s.key ? "border-[var(--color-primary)] shadow-md" : "border-gray-200 hover:border-gray-300 hover:shadow-sm"
                }`}
                onClick={() => setActiveStage(activeStage === s.key ? "all" : s.key)}
              >
                <div className="flex items-center gap-1.5 mb-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STAGE_STYLE[s.key].dot}`} />
                  <span className="text-[9px] lg:text-[10px] text-gray-500 uppercase tracking-wide truncate leading-none">{s.label}</span>
                </div>
                <div className="text-gray-900 text-lg lg:text-xl font-semibold">{stageCounts[s.key] ?? 0}</div>
              </div>
            ))}
          </div>

          {/* Búsqueda */}
          <div className="flex items-center gap-2 mb-2">
            <div className="relative flex-1">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
              </svg>
              <input
                type="text"
                placeholder="Buscar por nombre, empresa, email…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-white border border-gray-200 rounded-lg pl-8 pr-3 py-2 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:border-[var(--color-primary)] transition-colors shadow-sm"
              />
            </div>
          </div>

          {/* Stage tabs */}
          <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-1 shadow-sm overflow-x-auto min-w-0 mb-3">
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
                  activeStage === s.key ? "bg-[var(--color-primary)] text-white" : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Bulk bar */}
        {someChecked && (
          <div className="mx-4 lg:mx-8 mb-3 bg-[var(--color-secondary)] text-white rounded-xl px-4 py-2.5 flex items-center gap-3 flex-wrap">
            <span className="text-sm font-medium">{checkedIds.size} seleccionado{checkedIds.size !== 1 ? "s" : ""}</span>
            <div className="flex-1" />
            <div className="relative" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setBulkStageOpen(false); }}>
              <button
                onClick={() => setBulkStageOpen((v) => !v)}
                disabled={saving}
                className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
              >
                Cambiar estado
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3">
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
            {!confirmBulkDelete ? (
              <button
                onClick={() => setConfirmBulkDelete(true)}
                disabled={saving}
                className="flex items-center gap-1.5 bg-red-500/80 hover:bg-red-500 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                </svg>
                Eliminar
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs text-white/80">¿Eliminar {checkedIds.size} leads?</span>
                <button onClick={handleBulkDelete} disabled={saving} className="bg-red-500 hover:bg-red-600 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                  Confirmar
                </button>
                <button onClick={() => setConfirmBulkDelete(false)} className="bg-white/20 text-white text-xs px-2 py-1.5 rounded-lg">
                  Cancelar
                </button>
              </div>
            )}
          </div>
        )}

        {/* Tabla */}
        <div className="flex-1 overflow-auto px-4 lg:px-8 pb-8">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-6 h-6 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : leads.length === 0 ? (
            <div className="text-center py-20 text-gray-400 text-sm">
              No hay leads{activeStage !== "all" ? " en este estado" : ""}
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="w-10 px-3 py-3">
                      <input type="checkbox" checked={allChecked} onChange={toggleCheckAll} className="rounded" />
                    </th>
                    <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Nombre / Empresa</th>
                    <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider hidden md:table-cell">Email</th>
                    <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider hidden lg:table-cell">País / Ciudad</th>
                    <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider hidden xl:table-cell">Asunto</th>
                    <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Estado</th>
                    <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider hidden sm:table-cell">Prioridad</th>
                    <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider hidden sm:table-cell">Recibido</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((lead, i) => {
                    const st = STAGE_STYLE[lead.stage] ?? STAGE_STYLE.new;
                    const isSelected = selected?.id === lead.id;
                    return (
                      <tr
                        key={lead.id}
                        onClick={() => openPanel(lead)}
                        className={`border-b border-gray-50 cursor-pointer transition-colors ${
                          isSelected ? "bg-blue-50" : i % 2 === 0 ? "hover:bg-gray-50" : "bg-gray-50/50 hover:bg-gray-100/50"
                        }`}
                      >
                        <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" checked={checkedIds.has(lead.id)} onChange={(e) => toggleCheck(lead.id, e)} className="rounded" />
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900 truncate max-w-[160px]">{lead.name || "—"}</div>
                          <div className="text-xs text-gray-400 truncate max-w-[160px]">{lead.customFields?.empresa || ""}</div>
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell">
                          <span className="text-gray-600 truncate max-w-[180px] block">{lead.email || "—"}</span>
                        </td>
                        <td className="px-4 py-3 hidden lg:table-cell">
                          <span className="text-gray-600 text-xs">
                            {[lead.customFields?.pais, lead.customFields?.ciudad].filter(Boolean).join(" / ") || "—"}
                          </span>
                        </td>
                        <td className="px-4 py-3 hidden xl:table-cell">
                          <span className="text-gray-600 truncate max-w-[160px] block">{lead.customFields?.asunto || "—"}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${st.bg}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
                            {STAGES.find((s) => s.key === lead.stage)?.label ?? lead.stage}
                          </span>
                        </td>
                        <td className="px-4 py-3 hidden sm:table-cell">
                          {lead.customFields?.prioridad ? (
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium ${PRIORITY_STYLE[lead.customFields.prioridad] || ""}`}>
                              {PRIORITY_LABELS[lead.customFields.prioridad] || lead.customFields.prioridad}
                            </span>
                          ) : (
                            <span className="text-gray-300 text-xs">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 hidden sm:table-cell">
                          <span className="text-gray-500 text-xs">{formatDate(lead.createdAt)}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── Panel lateral ─────────────────────────────────────────────────── */}
      {panelOpen && selected && (
        <div className="fixed lg:absolute top-0 right-0 h-full w-full lg:w-[440px] bg-white border-l border-gray-200 shadow-2xl flex flex-col z-40 overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${(STAGE_STYLE[selected.stage] ?? STAGE_STYLE.new).bg}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${(STAGE_STYLE[selected.stage] ?? STAGE_STYLE.new).dot}`} />
                {STAGES.find((s) => s.key === selected.stage)?.label ?? selected.stage}
              </span>
              {selected.customFields?.prioridad && (
                <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${PRIORITY_STYLE[selected.customFields.prioridad] || ""}`}>
                  {PRIORITY_LABELS[selected.customFields.prioridad] || selected.customFields.prioridad}
                </span>
              )}
            </div>
            <button onClick={closePanel} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {editMode ? (
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Nombre</label>
                  <input type="text" value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)]" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Empresa</label>
                  <input type="text" value={editForm.empresa} onChange={(e) => setEditForm((f) => ({ ...f, empresa: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)]" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Email</label>
                  <input type="email" value={editForm.email} onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)]" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Teléfono <span className="text-gray-300">(opcional)</span></label>
                  <input type="tel" value={editForm.phone} onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)]" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">País</label>
                    <input type="text" value={editForm.pais} onChange={(e) => setEditForm((f) => ({ ...f, pais: e.target.value }))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Ciudad</label>
                    <input type="text" value={editForm.ciudad} onChange={(e) => setEditForm((f) => ({ ...f, ciudad: e.target.value }))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)]" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Asunto</label>
                  <input type="text" value={editForm.asunto} onChange={(e) => setEditForm((f) => ({ ...f, asunto: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)]" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Mensaje</label>
                  <textarea rows={4} value={editForm.notes} onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)] resize-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-2">Estado</label>
                  <div className="flex flex-wrap gap-1.5">
                    {STAGES.map((s) => (
                      <button
                        key={s.key}
                        onClick={() => setEditForm((f) => ({ ...f, stage: s.key }))}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                          editForm.stage === s.key ? `${STAGE_STYLE[s.key].bg} border-transparent` : "bg-white border-gray-200 text-gray-500 hover:border-gray-300"
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${STAGE_STYLE[s.key].dot}`} />
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-2">Prioridad</label>
                  <div className="flex gap-1.5">
                    {["", "baja", "media", "alta"].map((p) => (
                      <button
                        key={p}
                        onClick={() => setEditForm((f) => ({ ...f, prioridad: p }))}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                          editForm.prioridad === p
                            ? p === "" ? "bg-gray-100 text-gray-600 border-transparent" : `${PRIORITY_STYLE[p]} border-transparent`
                            : "bg-white border-gray-200 text-gray-500 hover:border-gray-300"
                        }`}
                      >
                        {p === "" ? "Sin" : PRIORITY_LABELS[p]}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-6 space-y-6">
                <div>
                  <div className="text-lg font-semibold text-gray-900">{selected.name || "Sin nombre"}</div>
                  {selected.customFields?.empresa && (
                    <div className="text-sm text-gray-500 mt-0.5">{selected.customFields.empresa}</div>
                  )}
                </div>

                <div>
                  <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Contacto</div>
                  <div className="space-y-1.5">
                    {selected.email && (
                      <div className="flex items-center gap-2 text-sm text-gray-700">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4 text-gray-400 shrink-0">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                        </svg>
                        <a href={`mailto:${selected.email}`} className="hover:text-[var(--color-primary)] transition-colors">{selected.email}</a>
                      </div>
                    )}
                    {selected.phone && (
                      <div className="flex items-center gap-2 text-sm text-gray-700">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4 text-gray-400 shrink-0">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
                        </svg>
                        <a href={`tel:${selected.phone}`} className="hover:text-[var(--color-primary)] transition-colors">{selected.phone}</a>
                      </div>
                    )}
                  </div>
                </div>

                {(selected.customFields?.pais || selected.customFields?.ciudad) && (
                  <div>
                    <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Ubicación</div>
                    <div className="text-sm text-gray-700">
                      {[selected.customFields?.pais, selected.customFields?.ciudad].filter(Boolean).join(" — ")}
                    </div>
                  </div>
                )}

                {(selected.customFields?.asunto || selected.notes) && (
                  <div>
                    <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Consulta</div>
                    {selected.customFields?.asunto && (
                      <div className="font-medium text-sm text-gray-800 mb-2">{selected.customFields.asunto}</div>
                    )}
                    {selected.notes && (
                      <div className="text-sm text-gray-600 whitespace-pre-wrap leading-relaxed">{selected.notes}</div>
                    )}
                  </div>
                )}

                <div>
                  <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Recibido</div>
                  <div className="text-sm text-gray-600">{formatDate(selected.createdAt)}</div>
                </div>
              </div>
            )}
          </div>

          <div className="px-6 py-4 border-t border-gray-100 flex items-center gap-2">
            {editMode ? (
              <>
                <button onClick={() => saveEdit(selected.id)} disabled={saving}
                  className="flex-1 bg-[var(--color-primary)] hover:opacity-90 text-white text-sm font-medium py-2 rounded-lg transition-opacity disabled:opacity-50">
                  {saving ? "Guardando…" : "Guardar"}
                </button>
                <button onClick={() => setEditMode(false)} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg">
                  Cancelar
                </button>
              </>
            ) : (
              <>
                <button onClick={() => openEdit(selected)}
                  className="flex-1 flex items-center justify-center gap-2 border border-gray-200 hover:border-gray-300 text-gray-700 text-sm font-medium py-2 rounded-lg transition-colors">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
                  </svg>
                  Editar
                </button>
                <button onClick={() => handleDelete(selected.id)}
                  className="px-4 py-2 text-sm text-red-500 hover:text-red-700 border border-red-100 hover:border-red-200 rounded-lg transition-colors">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                  </svg>
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Modal de importación ───────────────────────────────────────────── */}
      {importOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">Importar leads</h2>
              <button onClick={() => setImportOpen(false)} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex border-b border-gray-100 px-6">
              {["csv", "excel"].map((tab) => (
                <button
                  key={tab}
                  onClick={() => { setImportTab(tab); setImportResult(null); setCsvError(""); }}
                  className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                    importTab === tab ? "border-[var(--color-primary)] text-[var(--color-primary)]" : "border-transparent text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {tab === "csv" ? "CSV / pegar datos" : "Excel (.xlsx)"}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {importTab === "csv" ? (
                <div className="space-y-3">
                  <p className="text-xs text-gray-500">
                    Pega el contenido CSV. Columnas: <strong>Nombre, Empresa, Email, Teléfono, País, Ciudad, Asunto, Mensaje, Estado, Prioridad</strong>
                  </p>
                  <textarea
                    rows={8}
                    value={csvText}
                    onChange={(e) => handleCsvTextChange(e.target.value)}
                    placeholder={"Nombre,Empresa,Email,Teléfono,País,Ciudad,Asunto,Mensaje,Estado,Prioridad\nJohn Doe,Acme Corp,john@acme.com,+34600000000,España,Madrid,Consulta producto,Quiero más información,Nuevo lead,media"}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-[var(--color-primary)] resize-none"
                  />
                  {csvError && <p className="text-xs text-red-500">{csvError}</p>}
                  {csvParsed && (
                    <p className="text-xs text-emerald-600">{csvParsed.rows.length} fila{csvParsed.rows.length !== 1 ? "s" : ""} detectada{csvParsed.rows.length !== 1 ? "s" : ""}</p>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-gray-500">Sube un archivo .xlsx. Usa la plantilla para asegurarte de que las columnas son correctas.</p>
                  <label className="flex flex-col items-center justify-center border-2 border-dashed border-gray-200 rounded-xl p-8 cursor-pointer hover:border-[var(--color-primary)] transition-colors">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-8 h-8 text-gray-300 mb-2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                    </svg>
                    <span className="text-sm text-gray-500">Haz clic para seleccionar archivo .xlsx</span>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".xlsx"
                      className="hidden"
                      onChange={(e) => { if (e.target.files[0]) handleExcelImport(e.target.files[0]); }}
                    />
                  </label>
                </div>
              )}

              {importLoading && (
                <div className="flex items-center gap-2 mt-3 text-sm text-gray-500">
                  <div className="w-4 h-4 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />
                  Importando…
                </div>
              )}

              {importResult && (
                <div className={`mt-3 p-3 rounded-lg text-sm ${importResult.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
                  {importResult.ok ? (
                    <>
                      <div className="font-medium">Importación completada</div>
                      <div className="text-xs mt-1">
                        {importResult.data.imported} importados · {importResult.data.skipped} saltados
                        {importResult.data.errors?.length ? ` · ${importResult.data.errors.length} errores` : ""}
                      </div>
                    </>
                  ) : (
                    <div>{importResult.error}</div>
                  )}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex gap-2">
              {importTab === "csv" && (
                <button
                  onClick={handleCsvImport}
                  disabled={!csvParsed || importLoading}
                  className="flex-1 bg-[var(--color-primary)] hover:opacity-90 text-white text-sm font-medium py-2 rounded-lg transition-opacity disabled:opacity-40"
                >
                  Importar {csvParsed ? `${csvParsed.rows.length} leads` : ""}
                </button>
              )}
              <button onClick={() => setImportOpen(false)} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg">
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
