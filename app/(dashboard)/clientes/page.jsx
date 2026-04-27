"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

const STATUSES = [
  { key: "new", label: "Nuevo" },
  { key: "contacted", label: "Contactado" },
  { key: "following", label: "En seguimiento" },
  { key: "converted", label: "Convertido" },
  { key: "discarded", label: "Descartado" },
];

const STATUS_STYLE = {
  new: { dot: "bg-gray-400", bg: "bg-gray-100 text-gray-600" },
  contacted: { dot: "bg-blue-400", bg: "bg-blue-100 text-blue-700" },
  following: { dot: "bg-amber-400", bg: "bg-amber-100 text-amber-700" },
  converted: { dot: "bg-emerald-400", bg: "bg-emerald-100 text-emerald-700" },
  discarded: { dot: "bg-red-400", bg: "bg-red-100 text-red-600" },
};

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
}

export default function ClientesPage() {
  const [clients, setClients] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [activeStatus, setActiveStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [newClientOpen, setNewClientOpen] = useState(false);
  const [newClientForm, setNewClientForm] = useState({
    name: "", email: "", phone: "", company: "",
    country: "", city: "", topic: "", interestedProduct: "",
  });
  const [creatingClient, setCreatingClient] = useState(false);

  const fetchClients = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ limit: "200" });
    if (activeStatus !== "all") params.set("status", activeStatus);
    if (search.trim()) params.set("search", search.trim());
    fetch(`/api/clients?${params}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          setClients(data.data.clients);
          setTotal(data.data.total ?? data.data.clients.length);
        }
      })
      .finally(() => setLoading(false));
  }, [activeStatus, search]);

  useEffect(() => {
    const t = setTimeout(fetchClients, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [fetchClients, search]);

  const statusCounts = clients.reduce((acc, c) => {
    const s = c.customFields?.seStatus || "new";
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {});

  function openPanel(client) { setSelected(client); setPanelOpen(true); setEditMode(false); }
  function closePanel() { setPanelOpen(false); setSelected(null); setEditMode(false); }

  function openEdit(client) {
    setEditForm({
      name: client.name || "",
      email: client.email || "",
      phone: client.phone || "",
      notes: client.notes || "",
      status: client.customFields?.seStatus || "new",
      company: client.customFields?.company || "",
      country: client.customFields?.country || "",
      city: client.customFields?.city || "",
      topic: client.customFields?.topic || "",
      interestedProduct: client.customFields?.interestedProduct || "",
    });
    setEditMode(true);
  }

  async function saveEdit(clientId) {
    setSaving(true);
    try {
      const res = await fetch(`/api/clients/${clientId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });
      const data = await res.json();
      if (data.ok) {
        setSelected(data.data);
        setClients((prev) => prev.map((c) => (c.id === clientId ? data.data : c)));
        setEditMode(false);
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(clientId) {
    if (!confirm("¿Eliminar este cliente?")) return;
    await fetch(`/api/clients/${clientId}`, { method: "DELETE" });
    setClients((prev) => prev.filter((c) => c.id !== clientId));
    setTotal((prev) => prev - 1);
    closePanel();
  }

  async function handleExport() {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (activeStatus !== "all") params.set("status", activeStatus);
      if (search.trim()) params.set("search", search.trim());
      const res = await fetch(`/api/clients/export?${params}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `clientes_${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  async function handleCreateClient() {
    if (!newClientForm.name.trim()) return;
    setCreatingClient(true);
    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newClientForm),
      });
      const data = await res.json();
      if (data.ok) {
        fetchClients();
        setNewClientOpen(false);
        setNewClientForm({ name: "", email: "", phone: "", company: "", country: "", city: "", topic: "", interestedProduct: "" });
      }
    } finally {
      setCreatingClient(false);
    }
  }

  return (
    <div className="flex h-full bg-gray-50">
      <div className={`flex-1 flex flex-col min-w-0 transition-all duration-300 ${panelOpen ? "lg:mr-[440px]" : ""}`}>
        {/* Header */}
        <div className="px-4 lg:px-8 pt-6 lg:pt-8 pb-0">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h1 className="text-gray-900 text-xl font-semibold">Clientes</h1>
              <p className="text-gray-500 text-sm mt-0.5">{total} cliente{total !== 1 ? "s" : ""} en total</p>
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
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M12 3v13.5m0 0l-4.5-4.5M12 16.5l4.5-4.5" />
                  </svg>
                )}
                <span className="hidden sm:inline">Exportar Excel</span>
              </button>
              <button
                onClick={() => setNewClientOpen(true)}
                className="flex items-center gap-2 bg-[var(--color-primary)] hover:opacity-90 text-white text-sm font-medium px-4 py-2 rounded-lg transition-opacity shadow-sm"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Nuevo cliente
              </button>
            </div>
          </div>

          {/* Status cards */}
          <div className="grid grid-cols-3 lg:grid-cols-5 gap-2 lg:gap-3 mb-5">
            {STATUSES.map((s) => (
              <div
                key={s.key}
                onClick={() => setActiveStatus(activeStatus === s.key ? "all" : s.key)}
                className={`bg-white border rounded-xl p-3 cursor-pointer transition-all ${
                  activeStatus === s.key ? "border-[var(--color-primary)] shadow-md" : "border-gray-200 hover:border-gray-300 hover:shadow-sm"
                }`}
              >
                <div className="flex items-center gap-1.5 mb-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_STYLE[s.key].dot}`} />
                  <span className="text-[9px] lg:text-[10px] text-gray-500 uppercase tracking-wide truncate leading-none">{s.label}</span>
                </div>
                <div className="text-gray-900 text-lg lg:text-xl font-semibold">{statusCounts[s.key] ?? 0}</div>
              </div>
            ))}
          </div>

          {/* Search */}
          <div className="flex items-center gap-2 mb-2">
            <div className="relative flex-1">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
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

          {/* Tabs */}
          <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-1 shadow-sm overflow-x-auto min-w-0 mb-3">
            <button
              onClick={() => setActiveStatus("all")}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                activeStatus === "all" ? "bg-[var(--color-primary)] text-white" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              Todos
            </button>
            {STATUSES.map((s) => (
              <button
                key={s.key}
                onClick={() => setActiveStatus(s.key)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  activeStatus === s.key ? "bg-[var(--color-primary)] text-white" : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto px-4 lg:px-8 pb-8">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-6 h-6 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : clients.length === 0 ? (
            <div className="text-center py-20 text-gray-400 text-sm">
              No hay clientes{activeStatus !== "all" ? " con este estado" : ""}
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Nombre / Empresa</th>
                    <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider hidden md:table-cell">Email</th>
                    <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider hidden lg:table-cell">Teléfono</th>
                    <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Estado</th>
                    <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider hidden sm:table-cell">Alta</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {clients.map((client, i) => {
                    const st = STATUS_STYLE[client.customFields?.seStatus] ?? STATUS_STYLE.new;
                    const statusLabel = STATUSES.find((s) => s.key === client.customFields?.seStatus)?.label ?? "Nuevo";
                    const isSelected = selected?.id === client.id;
                    return (
                      <tr
                        key={client.id}
                        onClick={() => openPanel(client)}
                        className={`border-b border-gray-50 cursor-pointer transition-colors ${
                          isSelected ? "bg-blue-50" : i % 2 === 0 ? "hover:bg-gray-50" : "bg-gray-50/50 hover:bg-gray-100/50"
                        }`}
                      >
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900 truncate max-w-[160px]">{client.name || "—"}</div>
                          <div className="text-xs text-gray-400 truncate max-w-[160px]">{client.customFields?.company || ""}</div>
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell">
                          <span className="text-gray-600 truncate max-w-[180px] block">{client.email || "—"}</span>
                        </td>
                        <td className="px-4 py-3 hidden lg:table-cell">
                          <span className="text-gray-600">{client.phone || "—"}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${st.bg}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
                            {statusLabel}
                          </span>
                        </td>
                        <td className="px-4 py-3 hidden sm:table-cell">
                          <span className="text-gray-500 text-xs">{formatDate(client.createdAt)}</span>
                        </td>
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <Link href={`/clientes/${client.id}`} className="text-xs text-[var(--color-primary)] hover:underline whitespace-nowrap">
                            Ver ficha →
                          </Link>
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

      {/* Side panel */}
      {panelOpen && selected && (
        <div className="fixed lg:absolute top-0 right-0 h-full w-full lg:w-[440px] bg-white border-l border-gray-200 shadow-2xl flex flex-col z-40 overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${(STATUS_STYLE[selected.customFields?.seStatus] ?? STATUS_STYLE.new).bg}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${(STATUS_STYLE[selected.customFields?.seStatus] ?? STATUS_STYLE.new).dot}`} />
              {STATUSES.find((s) => s.key === selected.customFields?.seStatus)?.label ?? "Nuevo"}
            </span>
            <button onClick={closePanel} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {editMode ? (
              <div className="p-6 space-y-4">
                {[
                  { label: "Nombre", key: "name", type: "text" },
                  { label: "Empresa", key: "company", type: "text" },
                  { label: "Email", key: "email", type: "email" },
                  { label: "Teléfono", key: "phone", type: "tel" },
                  { label: "País", key: "country", type: "text" },
                  { label: "Ciudad", key: "city", type: "text" },
                  { label: "Tema de interés", key: "topic", type: "text" },
                  { label: "Producto de interés", key: "interestedProduct", type: "text" },
                ].map(({ label, key, type }) => (
                  <div key={key}>
                    <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
                    <input
                      type={type}
                      value={editForm[key] || ""}
                      onChange={(e) => setEditForm((f) => ({ ...f, [key]: e.target.value }))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)]"
                    />
                  </div>
                ))}
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Notas</label>
                  <textarea
                    rows={3}
                    value={editForm.notes || ""}
                    onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)] resize-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-2">Estado</label>
                  <div className="flex flex-wrap gap-1.5">
                    {STATUSES.map((s) => (
                      <button
                        key={s.key}
                        onClick={() => setEditForm((f) => ({ ...f, status: s.key }))}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                          editForm.status === s.key ? `${STATUS_STYLE[s.key].bg} border-transparent` : "bg-white border-gray-200 text-gray-500 hover:border-gray-300"
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${STATUS_STYLE[s.key].dot}`} />
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-6 space-y-6">
                <div>
                  <div className="text-lg font-semibold text-gray-900">{selected.name || "Sin nombre"}</div>
                  {selected.customFields?.company && (
                    <div className="text-sm text-gray-500 mt-0.5">{selected.customFields.company}</div>
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
                        <a href={`mailto:${selected.email}`} className="hover:text-[var(--color-primary)]">{selected.email}</a>
                      </div>
                    )}
                    {selected.phone && (
                      <div className="flex items-center gap-2 text-sm text-gray-700">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4 text-gray-400 shrink-0">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
                        </svg>
                        {selected.phone}
                      </div>
                    )}
                    {!selected.email && !selected.phone && (
                      <span className="text-sm text-gray-400">Sin datos de contacto</span>
                    )}
                  </div>
                </div>

                {(selected.customFields?.country || selected.customFields?.city) && (
                  <div>
                    <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Ubicación</div>
                    <div className="text-sm text-gray-700">
                      {[selected.customFields.country, selected.customFields.city].filter(Boolean).join(" — ")}
                    </div>
                  </div>
                )}

                {(selected.customFields?.topic || selected.customFields?.interestedProduct) && (
                  <div>
                    <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Interés</div>
                    {selected.customFields?.topic && <div className="text-sm text-gray-700">{selected.customFields.topic}</div>}
                    {selected.customFields?.interestedProduct && (
                      <div className="text-xs text-gray-500 mt-0.5">Producto: {selected.customFields.interestedProduct}</div>
                    )}
                  </div>
                )}

                {selected.notes && (
                  <div>
                    <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Notas</div>
                    <div className="text-sm text-gray-600 whitespace-pre-wrap leading-relaxed">{selected.notes}</div>
                  </div>
                )}

                <div>
                  <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Alta</div>
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
                <Link
                  href={`/clientes/${selected.id}`}
                  className="flex-1 flex items-center justify-center gap-1.5 bg-[var(--color-primary)] hover:opacity-90 text-white text-sm font-medium py-2 rounded-lg transition-opacity"
                >
                  Ver ficha completa →
                </Link>
                <button onClick={() => openEdit(selected)}
                  className="px-4 py-2 flex items-center gap-1.5 border border-gray-200 hover:border-gray-300 text-gray-700 text-sm font-medium rounded-lg transition-colors">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
                  </svg>
                </button>
                <button onClick={() => handleDelete(selected.id)}
                  className="px-3 py-2 text-red-500 hover:text-red-700 border border-red-100 hover:border-red-200 rounded-lg transition-colors">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                  </svg>
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* New client modal */}
      {newClientOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">Nuevo cliente</h2>
              <button onClick={() => setNewClientOpen(false)} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {[
                { label: "Nombre *", key: "name", type: "text" },
                { label: "Empresa", key: "company", type: "text" },
                { label: "Email", key: "email", type: "email" },
                { label: "Teléfono", key: "phone", type: "tel" },
                { label: "País", key: "country", type: "text" },
                { label: "Ciudad", key: "city", type: "text" },
                { label: "Tema de interés", key: "topic", type: "text" },
                { label: "Producto de interés", key: "interestedProduct", type: "text" },
              ].map(({ label, key, type }) => (
                <div key={key}>
                  <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
                  <input
                    type={type}
                    value={newClientForm[key] || ""}
                    onChange={(e) => setNewClientForm((f) => ({ ...f, [key]: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)]"
                  />
                </div>
              ))}
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex gap-2">
              <button
                onClick={handleCreateClient}
                disabled={!newClientForm.name.trim() || creatingClient}
                className="flex-1 bg-[var(--color-primary)] hover:opacity-90 text-white text-sm font-medium py-2 rounded-lg transition-opacity disabled:opacity-40"
              >
                {creatingClient ? "Creando…" : "Crear cliente"}
              </button>
              <button onClick={() => setNewClientOpen(false)} className="px-4 py-2 text-sm text-gray-500 border border-gray-200 rounded-lg">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
