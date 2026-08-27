"use client";

import { useEffect, useState, useCallback } from "react";

import HelpTooltip from "@/components/ui/HelpTooltip.jsx";
import { ImportModal } from "./LeadsImportModal.jsx";
import { LeadDetailPanel } from "./LeadsDetailPanel.jsx";

// ─── Configuración nutri-laura ────────────────────────────────────────────────

// Embudo de PROFESIONALES (marcas y nutricionistas que quieren trabajar con
// Laura). Las claves se mantienen (están en BD); solo cambian las etiquetas.
export const STAGES = [
  { key: "new", label: "Nuevo" },
  { key: "contacted", label: "Contactado" },
  { key: "consulta_agendada", label: "En conversación" },
  { key: "consulta_realizada", label: "Propuesta enviada" },
  { key: "paciente", label: "Colaboración activa" },
  { key: "lost", label: "Descartado" },
];

export const STAGE_STYLE = {
  new: { dot: "bg-gray-400", bg: "bg-gray-100 text-gray-600" },
  contacted: { dot: "bg-blue-400", bg: "bg-blue-100 text-blue-700" },
  consulta_agendada: { dot: "bg-amber-400", bg: "bg-amber-100 text-amber-700" },
  consulta_realizada: { dot: "bg-[var(--color-primary)]", bg: "bg-green-100 text-green-700" },
  paciente: { dot: "bg-emerald-500", bg: "bg-emerald-100 text-emerald-700" },
  lost: { dot: "bg-red-400", bg: "bg-red-100 text-red-600" },
};

export function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function NutriLauraLeadsModule() {
  const [leads, setLeads] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [activeStage, setActiveStage] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [checkedIds, setCheckedIds] = useState(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [bulkStageOpen, setBulkStageOpen] = useState(false);
  const [converting, setConverting] = useState(false);
  const [convertDone, setConvertDone] = useState(false);

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
    fetchLeads();
  }, [fetchLeads]);

  useEffect(() => {
    setCheckedIds(new Set());
    setConfirmBulkDelete(false);
    setBulkStageOpen(false);
  }, [activeStage, search]);

  /**
   * El desglose por etapa lo cuenta el SERVIDOR (12/08/2026).
   *
   * Antes salía de un `reduce` sobre `leads`, que es la lista YA FILTRADA: al
   * pulsar una etapa, las demás caían a cero y el total de la cabecera se
   * contagiaba. Ahora `/api/leads?desglose=1` cuenta todas las etapas con los
   * demás filtros aplicados. Estaba igual en los ocho overrides de leads.
   */
  const [stageCounts, setStageCounts] = useState({});

  function openLead(lead) {
    setSelected({ ...lead });
    setConvertDone(false);
    setPanelOpen(true);
  }

  function closePanel() {
    setPanelOpen(false);
    setTimeout(() => setSelected(null), 300);
  }

  async function handleConvertToClient(lead) {
    // Idempotencia: si el lead ya tiene clientId, no recrear el cliente
    // (el botón solo aparece si stage !== "paciente", pero un reload con
    // el seed legacy podría re-abrir el panel sobre un lead ya vinculado).
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
          type: "individual",
          notes: lead.notes || null,
          origin: "lead",
          leadId: lead.id,
          status: "new",
          customFields: {
            edad: lead.customFields?.edad ?? null,
            motivo: lead.customFields?.motivo ?? null,
            info_adicional: lead.customFields?.info_adicional ?? null,
          },
        }),
      });
      const clientData = await clientRes.json();
      if (!clientData.ok) return;

      const newClientId = clientData.data.id;

      const patchRes = await fetch(`/api/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: "paciente", clientId: newClientId }),
      });
      // Si el PATCH falla tras crear el cliente, el cliente queda creado
      // pero el lead no vinculado. No hacemos rollback (sería complejo
      // desde el browser); el usuario tendrá que vincularlo manualmente
      // o reintentar — el guard de idempotencia evitará un segundo cliente.
      if (!patchRes.ok) return;

      setLeads((prev) =>
        prev.map((l) =>
          l.id === lead.id ? { ...l, stage: "paciente", clientId: newClientId } : l
        )
      );
      setSelected((prev) =>
        prev ? { ...prev, stage: "paciente", clientId: newClientId } : prev
      );
      setConvertDone(true);
    } finally {
      setConverting(false);
    }
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
        // El desglose lo cuenta el servidor: sin volver a pedirlo, los números de arriba se quedan en los de antes.
        fetchLeads(true);
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
        // El desglose lo cuenta el servidor: sin volver a pedirlo, los números de arriba se quedan en los de antes.
        fetchLeads(true);
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
    // El desglose lo cuenta el servidor: sin volver a pedirlo, los números de arriba se quedan en los de antes.
    fetchLeads(true);
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
      await Promise.all(
        [...checkedIds].map((id) => fetch(`/api/leads/${id}`, { method: "DELETE" }))
      );
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
              <h1 className="text-gray-900 text-xl font-semibold">
                Leads Profesionales
                <HelpTooltip title="Convertir a paciente" className="ml-2">
                  El botón está dentro de la ficha de cada lead: crea una ficha NUEVA en
                  Pacientes y pasa el lead a «Colaboración activa» (el lead no se borra).{" "}
                  <strong className="text-white">
                    Solo ha entrado si sale el aviso verde «Convertido a paciente»
                  </strong>
                  ; si no sale, búscalo en Pacientes antes de volver a pulsar, porque la
                  ficha puede estar creada ya y saldría repetida.
                </HelpTooltip>
              </h1>
              <p className="text-gray-500 text-sm mt-0.5">
                {total} lead{total !== 1 ? "s" : ""} en total
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleDownloadTemplate}
                className="flex items-center gap-2 bg-white border border-gray-200 hover:border-gray-300 text-gray-700 text-sm font-medium px-4 py-2 rounded-lg transition-colors shadow-sm"
                title="Descargar plantilla de importación"
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
                    d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                  />
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
          <div className="grid grid-cols-3 lg:grid-cols-6 gap-2 lg:gap-3 mb-5">
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
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M19.5 8.25l-7.5 7.5-7.5-7.5"
                  />
                </svg>
              </button>
              {bulkStageOpen && (
                <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-50 py-1 min-w-[180px]">
                  {STAGES.map((s) => (
                    <button
                      key={s.key}
                      onClick={() => handleBulkStageChange(s.key)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors text-left"
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${STAGE_STYLE[s.key].dot}`}
                      />
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
                      {["Nombre", "Teléfono", "Email", "Empresa", "Propuesta", "Estado", "Recibido"].map(
                        (h) => (
                          <th
                            key={h}
                            className="text-left py-3 px-4 text-[10px] font-semibold text-gray-500 uppercase tracking-wide"
                          >
                            {h}
                          </th>
                        )
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {leads.map((lead) => {
                      const empresa = lead.customFields?.empresa;
                      const tipo = lead.customFields?.tipo;
                      const motivo = lead.customFields?.motivo;
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
                            <span className="text-gray-500 text-xs">{[tipo, empresa].filter(Boolean).join(" · ") || "—"}</span>
                          </td>
                          <td className="py-3 px-4 max-w-[260px]">
                            <span className="text-gray-600 text-xs line-clamp-2">
                              {motivo || <span className="text-gray-300">—</span>}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <span
                              className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${style.bg}`}
                            >
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
                  const empresa = lead.customFields?.empresa;
                  const tipo = lead.customFields?.tipo;
                  const motivo = lead.customFields?.motivo;
                  const style = STAGE_STYLE[lead.stage] ?? STAGE_STYLE.new;
                  const isChecked = checkedIds.has(lead.id);
                  return (
                    <div
                      key={lead.id}
                      onClick={() => openLead(lead)}
                      className={`bg-white rounded-2xl border shadow-sm p-4 cursor-pointer active:scale-[0.99] transition-all ${
                        isChecked
                          ? "border-[var(--color-primary)] bg-green-50/30"
                          : "border-gray-200"
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
                        {(tipo || empresa) && (
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium">
                            {[tipo, empresa].filter(Boolean).join(" · ")}
                          </span>
                        )}
                      </div>
                      {motivo && (
                        <p className="text-xs text-gray-500 mt-2 line-clamp-2">{motivo}</p>
                      )}
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
        converting={converting}
        convertDone={convertDone}
        onClose={closePanel}
        onStageChange={handleStageChange}
        onSave={handleSaveLead}
        onNotesChange={handleNotesChange}
        onDelete={handleDelete}
        onConvert={handleConvertToClient}
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
