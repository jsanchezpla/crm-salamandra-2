"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
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

const INTERACTION_TYPES = [
  { key: "note", label: "Nota" },
  { key: "call", label: "Llamada" },
  { key: "email", label: "Email" },
  { key: "meeting", label: "Reunión" },
];

const TYPE_STYLE = {
  note: "bg-gray-100 text-gray-600",
  call: "bg-blue-100 text-blue-700",
  email: "bg-purple-100 text-purple-700",
  meeting: "bg-emerald-100 text-emerald-700",
};

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
}

export default function ClienteDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const [client, setClient] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [interactions, setInteractions] = useState([]);
  const [newInteraction, setNewInteraction] = useState({
    type: "note",
    content: "",
    date: new Date().toISOString().slice(0, 10),
  });
  const [addingInteraction, setAddingInteraction] = useState(false);

  useEffect(() => {
    fetch(`/api/clients/${id}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          setClient(data.data);
          setInteractions(data.data.interactions || []);
        }
      })
      .finally(() => setLoading(false));
  }, [id]);

  function openEdit() {
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

  async function saveEdit() {
    setSaving(true);
    try {
      const res = await fetch(`/api/clients/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });
      const data = await res.json();
      if (data.ok) {
        setClient(data.data);
        setEditMode(false);
      }
    } finally {
      setSaving(false);
    }
  }

  async function addInteraction() {
    if (!newInteraction.content.trim() || !newInteraction.date) return;
    setAddingInteraction(true);
    try {
      const res = await fetch(`/api/clients/${id}/interactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newInteraction),
      });
      const data = await res.json();
      if (data.ok) {
        setInteractions((prev) => [data.data, ...prev]);
        setNewInteraction({ type: "note", content: "", date: new Date().toISOString().slice(0, 10) });
      }
    } finally {
      setAddingInteraction(false);
    }
  }

  async function handleDelete() {
    if (!confirm("¿Eliminar este cliente y todas sus interacciones?")) return;
    await fetch(`/api/clients/${id}`, { method: "DELETE" });
    router.push("/clientes");
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-6 h-6 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!client) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-gray-500">Cliente no encontrado</p>
        <Link href="/clientes" className="text-[var(--color-primary)] hover:underline text-sm">
          ← Volver a clientes
        </Link>
      </div>
    );
  }

  const status = client.customFields?.seStatus || "new";
  const st = STATUS_STYLE[status] ?? STATUS_STYLE.new;

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <div className="px-4 lg:px-8 pt-6 pb-4 border-b border-gray-100 bg-white">
        <div className="flex items-center gap-3 mb-1">
          <Link href="/clientes" className="text-gray-400 hover:text-gray-600 transition-colors">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
            </svg>
          </Link>
          <h1 className="text-gray-900 text-lg font-semibold">{client.name}</h1>
          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${st.bg}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
            {STATUSES.find((s) => s.key === status)?.label ?? status}
          </span>
        </div>
        {client.customFields?.company && (
          <p className="text-sm text-gray-500 ml-7">{client.customFields.company}</p>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto px-4 lg:px-8 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 max-w-5xl">

          {/* Datos del cliente */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <span className="text-sm font-semibold text-gray-700">Datos del cliente</span>
              <div className="flex items-center gap-2">
                {editMode ? (
                  <>
                    <button
                      onClick={saveEdit}
                      disabled={saving}
                      className="bg-[var(--color-primary)] hover:opacity-90 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-opacity disabled:opacity-50"
                    >
                      {saving ? "Guardando…" : "Guardar"}
                    </button>
                    <button
                      onClick={() => setEditMode(false)}
                      className="text-xs text-gray-500 hover:text-gray-700 border border-gray-200 px-3 py-1.5 rounded-lg"
                    >
                      Cancelar
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={openEdit}
                      className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-gray-900 border border-gray-200 hover:border-gray-300 px-3 py-1.5 rounded-lg transition-colors"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
                      </svg>
                      Editar
                    </button>
                    <button
                      onClick={handleDelete}
                      className="text-xs text-red-500 hover:text-red-700 border border-red-100 hover:border-red-200 px-3 py-1.5 rounded-lg transition-colors"
                    >
                      Eliminar
                    </button>
                  </>
                )}
              </div>
            </div>

            {editMode ? (
              <div className="p-5 space-y-4">
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
                          editForm.status === s.key
                            ? `${STATUS_STYLE[s.key].bg} border-transparent`
                            : "bg-white border-gray-200 text-gray-500 hover:border-gray-300"
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
              <div className="p-5 space-y-4">
                <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                  {[
                    { label: "Email", value: client.email, href: `mailto:${client.email}` },
                    { label: "Teléfono", value: client.phone, href: `tel:${client.phone}` },
                    { label: "País", value: client.customFields?.country },
                    { label: "Ciudad", value: client.customFields?.city },
                    { label: "Empresa", value: client.customFields?.company },
                    { label: "Origen", value: client.customFields?.origin },
                    { label: "Tema", value: client.customFields?.topic },
                    { label: "Producto interés", value: client.customFields?.interestedProduct },
                  ]
                    .filter(({ value }) => !!value)
                    .map(({ label, value, href }) => (
                      <div key={label}>
                        <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{label}</div>
                        {href ? (
                          <a href={href} className="text-sm text-[var(--color-primary)] hover:underline mt-0.5 block">
                            {value}
                          </a>
                        ) : (
                          <div className="text-sm text-gray-700 mt-0.5">{value}</div>
                        )}
                      </div>
                    ))}
                </div>
                {client.notes && (
                  <div>
                    <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Notas</div>
                    <div className="text-sm text-gray-600 whitespace-pre-wrap leading-relaxed">{client.notes}</div>
                  </div>
                )}
                <div className="pt-2 border-t border-gray-50">
                  <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Alta</div>
                  <div className="text-sm text-gray-600 mt-0.5">{formatDate(client.createdAt)}</div>
                </div>
              </div>
            )}
          </div>

          {/* Historial de interacciones */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm flex flex-col" style={{ minHeight: "400px" }}>
            <div className="px-5 py-4 border-b border-gray-100 shrink-0">
              <span className="text-sm font-semibold text-gray-700">
                Historial de interacciones
                {interactions.length > 0 && (
                  <span className="ml-2 text-xs font-normal text-gray-400">({interactions.length})</span>
                )}
              </span>
            </div>

            {/* Añadir interacción */}
            <div className="p-4 border-b border-gray-100 bg-gray-50/50 shrink-0">
              <div className="flex gap-1.5 mb-2">
                {INTERACTION_TYPES.map((t) => (
                  <button
                    key={t.key}
                    onClick={() => setNewInteraction((f) => ({ ...f, type: t.key }))}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                      newInteraction.type === t.key
                        ? `${TYPE_STYLE[t.key]} border-transparent`
                        : "bg-white border-gray-200 text-gray-500 hover:border-gray-300"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <input
                type="date"
                value={newInteraction.date}
                onChange={(e) => setNewInteraction((f) => ({ ...f, date: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm mb-2 focus:outline-none focus:border-[var(--color-primary)]"
              />
              <textarea
                rows={2}
                placeholder="Escribe una nota, resultado de llamada, reunión…"
                value={newInteraction.content}
                onChange={(e) => setNewInteraction((f) => ({ ...f, content: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-[var(--color-primary)]"
              />
              <button
                onClick={addInteraction}
                disabled={!newInteraction.content.trim() || addingInteraction}
                className="mt-2 w-full bg-[var(--color-primary)] hover:opacity-90 text-white text-sm font-medium py-2 rounded-lg transition-opacity disabled:opacity-40"
              >
                {addingInteraction ? "Guardando…" : "Registrar interacción"}
              </button>
            </div>

            {/* Lista de interacciones */}
            <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
              {interactions.length === 0 ? (
                <div className="py-12 text-center text-gray-400 text-sm">Sin interacciones registradas</div>
              ) : (
                interactions.map((interaction) => (
                  <div key={interaction.id} className="px-5 py-3.5">
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${
                          TYPE_STYLE[interaction.type] ?? "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {INTERACTION_TYPES.find((t) => t.key === interaction.type)?.label ?? interaction.type}
                      </span>
                      <span className="text-xs text-gray-400">{formatDate(interaction.date)}</span>
                      {interaction.createdBy && (
                        <span className="text-xs text-gray-400">· {interaction.createdBy}</span>
                      )}
                    </div>
                    <div className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                      {interaction.content}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
