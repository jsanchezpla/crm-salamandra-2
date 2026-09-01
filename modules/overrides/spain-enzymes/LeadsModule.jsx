"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { createPortal } from "react-dom";

function useMounted() {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}

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

// Flujo principal de leads: new → contacted → qualified → won.
// 'lost' es terminal aparte; click en su badge no avanza.
const STAGE_FLOW = ["new", "contacted", "qualified", "won"];
function nextStage(current) {
  const idx = STAGE_FLOW.indexOf(current);
  if (idx < 0 || idx >= STAGE_FLOW.length - 1) return null;
  return STAGE_FLOW[idx + 1];
}

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
  const mounted = useMounted();
  const [leads, setLeads] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [activeStage, setActiveStage] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [panelOpen, setPanelOpen] = useState(false);
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
  const [converting, setConverting] = useState(false);
  const [convertDone, setConvertDone] = useState(false);
  const [checkedIds, setCheckedIds] = useState(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [bulkStageOpen, setBulkStageOpen] = useState(false);
  const fileInputRef = useRef(null);

  // `silencioso` para volver a pedirlo tras una baja o un cambio de etapa sin
  // que la lista parpadee con el cargando.
  const fetchLeads = useCallback((silencioso = false) => {
    if (!silencioso) setLoading(true);
    const params = new URLSearchParams({ limit: "200", desglose: "1" });
    if (activeStage !== "all") params.set("stage", activeStage);
    if (search.trim()) params.set("search", search.trim());
    fetch(`/api/leads?${params}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          setLeads(data.data.leads);
          setStageCounts(data.data.desglose ?? {});
          setTotal(data.data.totalSinEtapa ?? data.data.total);
        }
      })
      .finally(() => {
        if (!silencioso) setLoading(false);
      });
  }, [activeStage, search]);

  useEffect(() => {
    const t = setTimeout(fetchLeads, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [fetchLeads, search]);

  /**
   * El desglose por etapa lo cuenta el SERVIDOR (12/08/2026).
   *
   * Antes salía de un `reduce` sobre `leads`, que es la lista YA FILTRADA: al
   * pulsar una etapa, las demás caían a cero y el total de la cabecera se
   * contagiaba. Ahora `/api/leads?desglose=1` cuenta todas las etapas con los
   * demás filtros aplicados. Estaba igual en los ocho overrides de leads.
   */
  const [stageCounts, setStageCounts] = useState({});

  function openPanel(lead) {
    setSelected(lead);
    setPanelOpen(true);
    setConvertDone(false);
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
  }
  function closePanel() { setPanelOpen(false); setSelected(null); setConvertDone(false); setConfirmDelete(false); }

  async function handleDeleteLead(leadId) {
    setDeleting(true);
    try {
      const res = await fetch(`/api/leads/${leadId}`, { method: "DELETE" });
      if (res.ok) {
        setLeads((prev) => prev.filter((l) => l.id !== leadId));
        // El desglose lo cuenta el servidor: sin volver a pedirlo, los números de arriba se quedan en los de antes.
        fetchLeads(true);
        setTotal((prev) => prev - 1);
        closePanel();
      }
    } finally {
      setDeleting(false);
    }
  }

  useEffect(() => {
    if (!panelOpen) return;
    function onKey(e) { if (e.key === "Escape") closePanel(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panelOpen]);

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
        // El desglose lo cuenta el servidor: sin volver a pedirlo, los números de arriba se quedan en los de antes.
        fetchLeads(true);
      }
    } finally {
      setSaving(false);
    }
  }

  async function advanceLeadStage(lead) {
    const next = nextStage(lead.stage);
    if (!next) return;
    try {
      const res = await fetch(`/api/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!data.ok) return;
      setLeads((prev) => prev.map((l) => (l.id === lead.id ? { ...l, stage: next } : l)));
      // El desglose lo cuenta el servidor: sin volver a pedirlo, los números de arriba se quedan en los de antes.
      fetchLeads(true);
      if (selected?.id === lead.id) setSelected((prev) => (prev ? { ...prev, stage: next } : prev));
    } catch {
      // silencioso a propósito
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

  async function handleConvertToClient(lead) {
    // Idempotencia: si el lead ya tiene clientId, no recrear el cliente.
    if (lead.clientId) {
      setConvertDone(true);
      return;
    }

    setConverting(true);
    setConvertDone(false);
    try {
      const clientRes = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: lead.name,
          email: lead.email,
          phone: lead.phone,
          company: lead.customFields?.empresa,
          country: lead.customFields?.pais,
          city: lead.customFields?.ciudad,
          topic: lead.customFields?.asunto,
          origin: "lead",
          leadId: lead.id,
          status: "new",
        }),
      });
      const clientData = await clientRes.json();
      if (!clientData.ok) return;

      const newClientId = clientData.data.id;

      const patchRes = await fetch(`/api/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: "won", clientId: newClientId }),
      });
      // Si el PATCH falla tras crear el cliente, el cliente queda creado
      // pero el lead no vinculado. No hacemos rollback desde el browser;
      // el guard de idempotencia evita un segundo cliente al reintentar.
      if (!patchRes.ok) return;

      setLeads((prev) =>
        prev.map((l) => (l.id === lead.id ? { ...l, stage: "won", clientId: newClientId } : l))
      );
      setSelected((prev) =>
        prev ? { ...prev, stage: "won", clientId: newClientId } : prev
      );
      setConvertDone(true);
    } finally {
      setConverting(false);
    }
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
      // El desglose lo cuenta el servidor: sin volver a pedirlo, los números de arriba se quedan en los de antes.
      fetchLeads(true);
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
      // El desglose lo cuenta el servidor: sin volver a pedirlo, los números de arriba se quedan en los de antes.
      fetchLeads(true);
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
    <div className="flex h-full bg-[var(--color-accent)]">
      {/* ── Lista principal ───────────────────────────────────────────────── */}
      <div className={`flex-1 flex flex-col min-w-0 transition-all duration-300 ${panelOpen ? "lg:mr-[440px]" : ""}`}>

        {/* Header */}
        <div className="px-4 lg:px-10 pt-5 lg:pt-12 pb-0">
          <div className="flex items-end justify-between mb-5 lg:mb-7 gap-4 flex-wrap">
            <div>
              <div className="eyebrow mb-1.5 lg:mb-2">Comercial · Pipeline</div>
              <h1 className="font-display text-[26px] lg:text-[40px] leading-[1.05] text-[var(--ink-900)] tracking-tight">
                Leads Profesionales <span className="font-display-italic text-[var(--ink-400)]">— {total} {total === 1 ? "oportunidad" : "oportunidades"}</span>
              </h1>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleDownloadTemplate}
                className="flex items-center gap-2 bg-white border border-[var(--ink-200)] hover:border-[var(--ink-300)] text-[var(--ink-700)] text-[13px] font-medium px-4 py-2 rounded-[var(--radius-control)] transition-colors"
                title="Descargar plantilla de importación"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                </svg>
                <span className="hidden sm:inline">Plantilla</span>
              </button>
              <button
                onClick={handleExport}
                disabled={exporting}
                className="flex items-center gap-2 bg-white border border-[var(--ink-200)] hover:border-[var(--ink-300)] text-[var(--ink-700)] text-[13px] font-medium px-4 py-2 rounded-[var(--radius-control)] transition-colors disabled:opacity-50"
              >
                {exporting ? (
                  <div className="w-4 h-4 border-2 border-[var(--ink-400)] border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-4 h-4">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M12 3v13.5m0 0l-4.5-4.5M12 16.5l4.5-4.5" />
                  </svg>
                )}
                <span className="hidden sm:inline">Exportar Excel</span>
              </button>
              <button
                onClick={() => { setImportOpen(true); setImportResult(null); setCsvText(""); setCsvParsed(null); setCsvError(""); }}
                className="flex items-center gap-2 bg-[var(--color-primary)] hover:opacity-90 text-white text-[13px] font-medium px-4 py-2 rounded-[var(--radius-control)] transition-opacity"
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
                    <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider hidden xl:table-cell">Mensaje</th>
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
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          {(() => {
                            const canAdvance = nextStage(lead.stage) !== null;
                            const nextLabel = canAdvance
                              ? STAGES.find((s) => s.key === nextStage(lead.stage))?.label
                              : null;
                            return (
                              <button
                                type="button"
                                onClick={() => canAdvance && advanceLeadStage(lead)}
                                disabled={!canAdvance}
                                title={canAdvance ? `Pasar a "${nextLabel}"` : "Estado final"}
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium transition ${st.bg} ${
                                  canAdvance ? "hover:ring-2 hover:ring-offset-1 hover:ring-[var(--color-primary)]/40 cursor-pointer" : "cursor-default"
                                }`}
                              >
                                <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
                                {STAGES.find((s) => s.key === lead.stage)?.label ?? lead.stage}
                              </button>
                            );
                          })()}
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
      {panelOpen && selected && mounted && createPortal(
        <>
          <div
            className="lg:hidden fixed inset-0 bg-black/50 z-[70] fade-in"
            onClick={closePanel}
            aria-hidden="true"
          />
          <div
            className="fixed top-0 right-0 h-full w-full lg:w-[440px] bg-white border-l border-gray-200 shadow-2xl flex flex-col z-[80] overflow-hidden slide-right"
            style={{ paddingTop: "env(safe-area-inset-top)" }}
          >
            {/* Barra "Atrás" — solo móvil */}
            <button
              onClick={closePanel}
              className="lg:hidden flex items-center gap-2 px-4 py-3 border-b border-gray-100 bg-gray-50 text-gray-700 hover:bg-gray-100 transition-colors shrink-0 w-full text-left"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
              <span className="text-sm font-medium">Volver al listado</span>
            </button>

            <div className="flex items-center justify-between px-4 lg:px-6 py-3 lg:py-4 border-b border-gray-100 shrink-0 gap-3">
              <div className="flex items-center gap-2 flex-wrap min-w-0">
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
              <button
                onClick={closePanel}
                className="hidden lg:flex w-10 h-10 shrink-0 items-center justify-center rounded-lg text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors"
                aria-label="Cerrar panel"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

          <div className="flex-1 overflow-y-auto">
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
                  <label className="block text-xs font-medium text-gray-500 mb-1">Mensaje</label>
                  <input type="text" value={editForm.asunto} onChange={(e) => setEditForm((f) => ({ ...f, asunto: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)]" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Notas internas</label>
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
          </div>

          <div className="px-6 py-4 border-t border-gray-100 flex flex-col gap-2">
            {selected.stage !== "won" && (
              convertDone ? (
                <div className="w-full flex items-center justify-center gap-2 bg-emerald-50 text-emerald-700 text-sm font-medium py-2 rounded-lg border border-emerald-200">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                  Convertido a cliente
                </div>
              ) : (
                <button
                  onClick={() => handleConvertToClient(selected)}
                  disabled={converting}
                  className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium py-2 rounded-lg transition-colors disabled:opacity-50"
                >
                  {converting ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM4 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 0110.374 21c-2.331 0-4.512-.645-6.374-1.766z" />
                    </svg>
                  )}
                  {converting ? "Convirtiendo…" : "Convertir a cliente"}
                </button>
              )
            )}
            <button onClick={() => saveEdit(selected.id)} disabled={saving}
              className="w-full bg-[var(--color-primary)] hover:opacity-90 text-white text-sm font-medium py-2 rounded-lg transition-opacity disabled:opacity-50">
              {saving ? "Guardando…" : "Guardar"}
            </button>
            {!confirmDelete ? (
              <button
                onClick={() => setConfirmDelete(true)}
                disabled={saving || deleting}
                className="w-full flex items-center justify-center gap-2 bg-white hover:bg-red-50 text-red-600 border border-red-200 text-sm font-medium py-2 rounded-lg transition-colors disabled:opacity-50"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                </svg>
                Eliminar lead
              </button>
            ) : (
              <div className="flex flex-col gap-2 bg-red-50 border border-red-200 rounded-lg p-3">
                <div className="text-xs text-red-700 font-medium text-center">¿Eliminar este lead? No se puede deshacer.</div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setConfirmDelete(false)}
                    disabled={deleting}
                    className="flex-1 bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 text-xs font-medium py-2 rounded-lg transition-colors disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={() => handleDeleteLead(selected.id)}
                    disabled={deleting}
                    className="flex-1 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold py-2 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {deleting ? "Eliminando…" : "Sí, eliminar"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
        </>,
        document.body
      )}

      {/* ── Modal de importación ───────────────────────────────────────────── */}
      {importOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90dvh] flex flex-col">
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
