"use client";

import { useEffect, useState, useCallback } from "react";

// ─── Configuración ────────────────────────────────────────────────────────────

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
  qualified: { dot: "bg-cyan-400", bg: "bg-cyan-100 text-cyan-700" },
  won: { dot: "bg-emerald-400", bg: "bg-emerald-100 text-emerald-700" },
  lost: { dot: "bg-red-400", bg: "bg-red-100 text-red-600" },
};

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function AbarcaIAReferidosModule() {
  const [referidos, setReferidos] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [activeStage, setActiveStage] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchReferidos = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ limit: "200" });
    if (activeStage !== "all") params.set("stage", activeStage);
    if (search.trim()) params.set("search", search.trim());

    fetch(`/api/referidos?${params}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          setReferidos(data.data.referidos);
          setTotal(data.data.total);
        }
      })
      .finally(() => setLoading(false));
  }, [activeStage, search]);

  useEffect(() => {
    fetchReferidos();
  }, [fetchReferidos]);

  const stageCounts = referidos.reduce((acc, r) => {
    acc[r.stage] = (acc[r.stage] ?? 0) + 1;
    return acc;
  }, {});

  function openReferido(ref) {
    setSelected({ ...ref });
    setPanelOpen(true);
  }

  function closePanel() {
    setPanelOpen(false);
    setTimeout(() => setSelected(null), 300);
  }

  async function handleStageChange(refId, newStage) {
    setSaving(true);
    try {
      const res = await fetch(`/api/referidos/${refId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: newStage }),
      });
      const data = await res.json();
      if (data.ok) {
        setReferidos((prev) => prev.map((r) => (r.id === refId ? { ...r, stage: newStage } : r)));
        if (selected?.id === refId) setSelected((prev) => ({ ...prev, stage: newStage }));
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleNotesChange(refId, notes) {
    await fetch(`/api/referidos/${refId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes }),
    });
    setReferidos((prev) => prev.map((r) => (r.id === refId ? { ...r, notes } : r)));
  }

  return (
    <div className="flex h-full bg-gray-50">
      <div className={`flex-1 flex flex-col min-w-0 transition-all duration-300 ${panelOpen ? "lg:mr-[440px]" : ""}`}>
        {/* Header */}
        <div className="px-4 lg:px-8 pt-6 lg:pt-8 pb-0">
          <div className="flex items-center justify-between mb-5">
            <div>
              <div className="flex items-center gap-2.5">
                <div className="w-6 h-6 rounded-md bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center shrink-0">
                  <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2} className="w-3.5 h-3.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
                  </svg>
                </div>
                <h1 className="text-gray-900 text-xl font-semibold">Referidos AbarcaIA</h1>
              </div>
              <p className="text-gray-500 text-sm mt-0.5 pl-8.5">
                {total} referido{total !== 1 ? "s" : ""} en total
              </p>
            </div>
          </div>

          {/* Métricas por estado */}
          <div className="grid grid-cols-3 lg:grid-cols-5 gap-2 lg:gap-3 mb-5">
            {STAGES.map((s) => (
              <div
                key={s.key}
                className={`bg-white border rounded-xl p-3 cursor-pointer transition-all ${
                  activeStage === s.key
                    ? "border-cyan-400 shadow-md"
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

          {/* Buscador + tabs de estado */}
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
                placeholder="Buscar por nombre, email, teléfono…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-white border border-gray-200 rounded-lg pl-8 pr-3 py-2 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:border-cyan-400 transition-colors shadow-sm"
              />
            </div>
          </div>

          <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-1 shadow-sm overflow-x-auto min-w-0 mb-4">
            <button
              onClick={() => setActiveStage("all")}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                activeStage === "all" ? "bg-cyan-500 text-white" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              Todos
            </button>
            {STAGES.map((s) => (
              <button
                key={s.key}
                onClick={() => setActiveStage(s.key)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  activeStage === s.key ? "bg-cyan-500 text-white" : "text-gray-500 hover:text-gray-700"
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
              <div className="w-5 h-5 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              {/* Desktop: tabla */}
              <div className="hidden lg:block rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      {["Nombre", "Teléfono", "Email", "Cód. Referido", "Estado", "Recibido"].map((h) => (
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
                    {referidos.map((ref) => {
                      const codigo = ref.customFields?.codigo_referido;
                      const style = STAGE_STYLE[ref.stage] ?? STAGE_STYLE.new;
                      return (
                        <tr
                          key={ref.id}
                          onClick={() => openReferido(ref)}
                          className={`border-b border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors ${
                            selected?.id === ref.id && panelOpen ? "bg-gray-50" : ""
                          }`}
                        >
                          <td className="py-3 px-4">
                            <span className="text-gray-900 font-medium">{ref.name || ref.title || "—"}</span>
                          </td>
                          <td className="py-3 px-4">
                            <a
                              href={`tel:${ref.phone}`}
                              onClick={(e) => e.stopPropagation()}
                              className="text-gray-500 hover:text-cyan-500 transition-colors"
                            >
                              {ref.phone || "—"}
                            </a>
                          </td>
                          <td className="py-3 px-4">
                            <span className="text-gray-500">{ref.email || "—"}</span>
                          </td>
                          <td className="py-3 px-4">
                            {codigo ? (
                              <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded bg-cyan-50 text-cyan-700 border border-cyan-100 tracking-widest">
                                {codigo}
                              </span>
                            ) : (
                              <span className="text-gray-300">—</span>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${style.bg}`}>
                              {STAGES.find((s) => s.key === ref.stage)?.label ?? ref.stage}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-gray-400 text-xs">{formatDate(ref.createdAt)}</td>
                        </tr>
                      );
                    })}
                    {referidos.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-16 text-center text-gray-400 text-sm">
                          {search || activeStage !== "all"
                            ? "Sin resultados para ese filtro"
                            : "Todavía no hay referidos. Llegarán aquí desde el formulario de AbarcaIA."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Mobile: tarjetas */}
              <div className="lg:hidden space-y-3">
                {referidos.map((ref) => {
                  const codigo = ref.customFields?.codigo_referido;
                  const style = STAGE_STYLE[ref.stage] ?? STAGE_STYLE.new;
                  return (
                    <div
                      key={ref.id}
                      onClick={() => openReferido(ref)}
                      className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 cursor-pointer active:scale-[0.99] transition-transform"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="min-w-0 mr-3">
                          <div className="font-semibold text-gray-900 truncate">
                            {ref.name || ref.title || "—"}
                          </div>
                          <div className="text-xs text-gray-400">{ref.email || "—"}</div>
                        </div>
                        <span
                          className={`inline-block shrink-0 text-[11px] px-2.5 py-1 rounded-full font-medium ${style.bg}`}
                        >
                          {STAGES.find((s) => s.key === ref.stage)?.label ?? ref.stage}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {codigo && (
                          <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded bg-cyan-50 text-cyan-700 border border-cyan-100 tracking-widest">
                            {codigo}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center justify-between mt-3">
                        <span className="text-xs text-gray-400">{formatDate(ref.createdAt)}</span>
                        {ref.phone && (
                          <a
                            href={`tel:${ref.phone}`}
                            onClick={(e) => e.stopPropagation()}
                            className="text-xs text-cyan-500 font-medium"
                          >
                            {ref.phone}
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
                {referidos.length === 0 && (
                  <div className="py-16 text-center text-gray-400 text-sm">
                    {search || activeStage !== "all"
                      ? "Sin resultados para ese filtro"
                      : "Todavía no hay referidos. Llegarán aquí desde el formulario de AbarcaIA."}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Panel lateral */}
      <ReferidoDetailPanel
        ref={selected}
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

function ReferidoDetailPanel({ ref: referido, open, saving, onClose, onStageChange, onNotesChange }) {
  const [notes, setNotes] = useState("");
  const [notesDirty, setNotesDirty] = useState(false);

  useEffect(() => {
    if (referido) {
      setNotes(referido.notes ?? "");
      setNotesDirty(false);
    }
  }, [referido?.id]);

  if (!referido) return null;

  const codigo = referido.customFields?.codigo_referido;
  const fechaEnvio = referido.customFields?.fecha_envio;

  async function saveNotes() {
    await onNotesChange(referido.id, notes);
    setNotesDirty(false);
  }

  return (
    <div
      className={`fixed inset-0 lg:inset-auto lg:top-0 lg:right-0 lg:h-full lg:w-[440px] bg-white border-l border-gray-200 shadow-2xl flex flex-col z-40 transition-transform duration-300 ${
        open ? "translate-x-0" : "translate-x-full"
      }`}
    >
      {/* Header con acento cyan/azul AbarcaIA */}
      <div className="px-5 pt-5 pb-4 border-b border-gray-100 flex items-start justify-between gap-4 border-t-[3px] border-t-cyan-400">
        <div className="min-w-0">
          <h2 className="text-gray-900 font-semibold text-base truncate">
            {referido.name || referido.title || "Sin nombre"}
          </h2>
          <p className="text-gray-400 text-xs mt-0.5">{formatDate(referido.createdAt)}</p>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors shrink-0 mt-0.5">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
        {/* Código de referido destacado */}
        <div className="bg-gradient-to-r from-cyan-50 to-blue-50 border border-cyan-100 rounded-xl p-4 text-center">
          <p className="text-[10px] font-semibold text-cyan-600 uppercase tracking-widest mb-1.5">
            Código de referido
          </p>
          {codigo ? (
            <p className="text-2xl font-black text-cyan-700 tracking-[0.2em] font-mono">{codigo}</p>
          ) : (
            <p className="text-gray-400 text-sm italic">Sin código</p>
          )}
        </div>

        {/* Cambiar estado */}
        <div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Estado</p>
          <div className="grid grid-cols-2 gap-1.5">
            {STAGES.map((s) => {
              const isActive = referido.stage === s.key;
              const style = STAGE_STYLE[s.key];
              return (
                <button
                  key={s.key}
                  disabled={saving}
                  onClick={() => onStageChange(referido.id, s.key)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border transition-colors disabled:opacity-50 ${
                    isActive
                      ? "border-cyan-400 bg-cyan-50 text-cyan-700"
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
            <ContactRow icon="phone" label="Teléfono" value={referido.phone} href={`tel:${referido.phone}`} />
            <ContactRow icon="email" label="Email" value={referido.email} href={`mailto:${referido.email}`} />
          </div>
        </div>

        {/* Fecha del formulario */}
        {fechaEnvio && (
          <div>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Origen</p>
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
              <div className="flex items-center gap-2 text-xs">
                <span className="text-gray-400 w-20 shrink-0">Envío form</span>
                <span className="text-gray-600">{new Date(fechaEnvio).toLocaleString("es-ES")}</span>
              </div>
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
            placeholder="Añade notas sobre este referido…"
            rows={4}
            className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:border-cyan-400 transition-colors resize-none"
          />
          {notesDirty && (
            <button
              onClick={saveNotes}
              className="mt-2 text-xs text-cyan-500 hover:opacity-80 transition-opacity font-medium"
            >
              Guardar notas
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ContactRow({ icon, label, value, href }) {
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
        <a href={href} className="text-gray-700 text-xs hover:text-cyan-500 transition-colors">
          {value}
        </a>
      ) : (
        <span className="text-gray-300 text-xs">—</span>
      )}
    </div>
  );
}
