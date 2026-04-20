"use client";

import { useEffect, useState, useCallback } from "react";

// ─── Configuración Retorika ───────────────────────────────────────────────────

const STAGES = [
  { key: "new", label: "Nuevo" },
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

const PROMO_LABELS = {
  "pack-ia": "Pack IA",
  "formacion-presencial": "Formación Presencial",
};

const PROMO_STYLE = {
  "pack-ia": "bg-violet-100 text-violet-700",
  "formacion-presencial": "bg-sky-100 text-sky-700",
};

const ASUNTOS = {
  "pack-ia": "¡Tu Pack IA + 2 Herramientas Gratis está listo!",
  "formacion-presencial": "¡Formación Presencial confirmada!",
};

const CUERPOS = {
  "pack-ia": (name) =>
    `Hola ${name},\n\nNos complace confirmarte que tu solicitud del Pack IA + 2 Herramientas Gratis ha sido aceptada.\n\nEn breve recibirás más información.\n\nUn saludo,\nEl equipo de Retorika`,
  "formacion-presencial": (name) =>
    `Hola ${name},\n\nNos complace confirmarte que tu solicitud de Formación Presencial en Grupo ha sido aceptada.\n\nEn breve nos pondremos en contacto contigo para coordinar los detalles.\n\nUn saludo,\nEl equipo de Retorika`,
};

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function getPromo(lead) {
  return lead.customFields?.promo || lead.metadata?.promo || null;
}

function getMensaje(lead) {
  return lead.customFields?.mensaje || lead.mensaje || null;
}

function getOrigen(lead) {
  return lead.customFields?.origen || lead.source || null;
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function RetorikaLeadsModule() {
  const [leads, setLeads] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [activeStage, setActiveStage] = useState("all");
  const [promoFilter, setPromoFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchLeads = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ limit: "200" });
    if (activeStage !== "all") params.set("stage", activeStage);
    if (search.trim()) params.set("search", search.trim());

    fetch(`/api/leads?${params}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          let rows = data.data.leads;
          if (promoFilter !== "all") {
            rows = rows.filter(
              (l) => (l.customFields?.promo || l.metadata?.promo) === promoFilter
            );
          }
          setLeads(rows);
          setTotal(data.data.total);
        }
      })
      .finally(() => setLoading(false));
  }, [activeStage, promoFilter, search]);

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

  async function handleDelete(leadId) {
    await fetch(`/api/leads/${leadId}`, { method: "DELETE" });
    setLeads((prev) => prev.filter((l) => l.id !== leadId));
    setTotal((prev) => prev - 1);
    closePanel();
  }

  return (
    <div className="flex h-full bg-gray-50">
      <div
        className={`flex-1 flex flex-col min-w-0 transition-all duration-300 ${panelOpen ? "lg:mr-[460px]" : ""}`}
      >
        {/* Header */}
        <div className="px-4 lg:px-8 pt-6 lg:pt-8 pb-0">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h1 className="text-gray-900 text-xl font-semibold">Leads</h1>
              <p className="text-gray-500 text-sm mt-0.5">
                {total} solicitud{total !== 1 ? "es" : ""} en total
              </p>
            </div>
          </div>

          {/* Métricas */}
          <div className="grid grid-cols-3 lg:grid-cols-5 gap-2 lg:gap-3 mb-5">
            {STAGES.map((s) => (
              <div
                key={s.key}
                onClick={() => setActiveStage(activeStage === s.key ? "all" : s.key)}
                className={`bg-white border rounded-xl p-3 cursor-pointer transition-all ${
                  activeStage === s.key
                    ? "border-[var(--color-primary)] shadow-md"
                    : "border-gray-200 hover:border-gray-300 hover:shadow-sm"
                }`}
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

          {/* Filtros */}
          <div className="flex flex-col sm:flex-row gap-2 mb-2">
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
              value={promoFilter}
              onChange={(e) => setPromoFilter(e.target.value)}
              className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:border-[var(--color-primary)] transition-colors shadow-sm shrink-0"
            >
              <option value="all">Todas las promos</option>
              <option value="pack-ia">Pack IA</option>
              <option value="formacion-presencial">Formación Presencial</option>
              <option value="">Sin promo</option>
            </select>
          </div>

          {/* Tabs de estado */}
          <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-1 shadow-sm overflow-x-auto mb-4">
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
                      {["Nombre", "Email", "Teléfono", "Promo", "Origen", "Estado", "Recibido"].map(
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
                      const promo = getPromo(lead);
                      const origen = getOrigen(lead);
                      const style = STAGE_STYLE[lead.stage] ?? STAGE_STYLE.new;
                      return (
                        <tr
                          key={lead.id}
                          onClick={() => openLead(lead)}
                          className={`border-b border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors ${
                            selected?.id === lead.id && panelOpen ? "bg-gray-50" : ""
                          }`}
                        >
                          <td className="py-3 px-4 font-medium text-gray-900">
                            {lead.name || "—"}
                          </td>
                          <td className="py-3 px-4 text-gray-500">{lead.email || "—"}</td>
                          <td className="py-3 px-4">
                            {lead.phone ? (
                              <a
                                href={`tel:${lead.phone}`}
                                onClick={(e) => e.stopPropagation()}
                                className="text-gray-500 hover:text-[var(--color-primary)] transition-colors"
                              >
                                {lead.phone}
                              </a>
                            ) : (
                              <span className="text-gray-300">—</span>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            {promo ? (
                              <span
                                className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${PROMO_STYLE[promo] ?? "bg-gray-100 text-gray-600"}`}
                              >
                                {PROMO_LABELS[promo] ?? promo}
                              </span>
                            ) : (
                              <span className="text-gray-300">—</span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-gray-400 text-xs">{origen || "—"}</td>
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
                        <td colSpan={7} className="py-16 text-center text-gray-400 text-sm">
                          {search || activeStage !== "all" || promoFilter !== "all"
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
                  const promo = getPromo(lead);
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
                            {lead.name || "—"}
                          </div>
                          <div className="text-xs text-gray-400">{lead.email || "—"}</div>
                        </div>
                        <span
                          className={`inline-block shrink-0 text-[11px] px-2.5 py-1 rounded-full font-medium ${style.bg}`}
                        >
                          {STAGES.find((s) => s.key === lead.stage)?.label ?? lead.stage}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2 mt-1">
                        {promo && (
                          <span
                            className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${PROMO_STYLE[promo] ?? "bg-gray-100 text-gray-600"}`}
                          >
                            {PROMO_LABELS[promo] ?? promo}
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
                    Sin resultados para ese filtro
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Panel lateral */}
      <LeadDetailPanel
        lead={selected}
        open={panelOpen}
        saving={saving}
        onClose={closePanel}
        onStageChange={handleStageChange}
        onNotesChange={handleNotesChange}
        onDelete={handleDelete}
      />
    </div>
  );
}

// ─── Panel de detalle ─────────────────────────────────────────────────────────

function LeadDetailPanel({ lead, open, saving, onClose, onStageChange, onNotesChange, onDelete }) {
  const [notes, setNotes] = useState("");
  const [notesDirty, setNotesDirty] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (lead) {
      setNotes(lead.notes ?? "");
      setNotesDirty(false);
      setConfirmDelete(false);
    }
  }, [lead?.id]);

  if (!lead) return null;

  const promo = getPromo(lead);
  const mensaje = getMensaje(lead);
  const origen = getOrigen(lead);

  async function saveNotes() {
    await onNotesChange(lead.id, notes);
    setNotesDirty(false);
  }

  function aceptarPromocion() {
    const asunto = ASUNTOS[promo] ?? "Tu solicitud ha sido aceptada";
    const cuerpoFn =
      CUERPOS[promo] ??
      ((n) => `Hola ${n},\n\nTu solicitud ha sido aceptada.\n\nUn saludo,\nEl equipo de Retorika`);
    window.location.href = `mailto:${lead.email}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpoFn(lead.name ?? ""))}`;
  }

  return (
    <div
      className={`fixed inset-0 lg:inset-auto lg:top-0 lg:right-0 lg:h-full lg:w-[460px] bg-white border-l border-gray-200 shadow-2xl flex flex-col z-40 transition-transform duration-300 ${
        open ? "translate-x-0" : "translate-x-full"
      }`}
    >
      {/* Header */}
      <div className="px-5 pt-5 pb-4 border-b border-gray-100 flex items-start justify-between gap-4 border-t-[3px] border-t-[var(--color-primary)]">
        <div className="min-w-0">
          <h2 className="text-gray-900 font-semibold text-base truncate">
            {lead.name || "Sin nombre"}
          </h2>
          <p className="text-gray-400 text-xs mt-0.5">{formatDate(lead.createdAt)}</p>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 transition-colors shrink-0 mt-0.5"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            className="w-5 h-5"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

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
                      ? "border-[var(--color-primary)] bg-orange-50 text-orange-700"
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
            <InfoRow label="Email" value={lead.email} href={`mailto:${lead.email}`} />
            <InfoRow label="Teléfono" value={lead.phone} href={`tel:${lead.phone}`} />
          </div>
        </div>

        {/* Solicitud */}
        <div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-3">
            Solicitud
          </p>
          <div className="space-y-2.5">
            <div className="flex items-start gap-3">
              <span className="text-gray-400 w-20 shrink-0 text-xs mt-0.5">Promo</span>
              {promo ? (
                <span
                  className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${PROMO_STYLE[promo] ?? "bg-gray-100 text-gray-600"}`}
                >
                  {PROMO_LABELS[promo] ?? promo}
                </span>
              ) : (
                <span className="text-gray-300 text-xs">Sin promo</span>
              )}
            </div>
            <div className="flex items-start gap-3">
              <span className="text-gray-400 w-20 shrink-0 text-xs mt-0.5">Origen</span>
              <span className="text-gray-600 text-xs">{origen || "—"}</span>
            </div>
            {mensaje && (
              <div className="flex items-start gap-3">
                <span className="text-gray-400 w-20 shrink-0 text-xs mt-0.5">Mensaje</span>
                <p className="text-gray-700 text-xs leading-relaxed">{mensaje}</p>
              </div>
            )}
          </div>
        </div>

        {/* Botón aceptar promoción */}
        {promo && lead.email && (
          <button
            onClick={aceptarPromocion}
            className="w-full flex items-center justify-center gap-2 bg-[var(--color-primary)] hover:opacity-90 text-white text-sm font-semibold py-2.5 rounded-xl transition-opacity"
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
                d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"
              />
            </svg>
            Aceptar promoción
          </button>
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

        {/* Borrar */}
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
    </div>
  );
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────

function InfoRow({ label, value, href }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-gray-400 w-20 shrink-0 text-xs">{label}</span>
      {value ? (
        href ? (
          <a
            href={href}
            className="text-gray-700 text-xs hover:text-[var(--color-primary)] transition-colors"
          >
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
