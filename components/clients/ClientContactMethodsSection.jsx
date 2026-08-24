"use client";

/**
 * ClientContactMethodsSection — gestor de emails y teléfonos MÚLTIPLES de un
 * cliente, etiquetados, con uno principal por tipo.
 *
 * El principal se refleja en Client.email / Client.phone (lo hace el backend):
 * es el que usan facturación, avisos de cita y el acceso al portal "Mis citas".
 *
 * Autocontenido (como ClientModulesSection): recibe `clientId` y habla con
 * /api/clients/[id]/contact-methods. Refetch tras cada cambio (simple y fiable).
 */

import { useCallback, useEffect, useRef, useState } from "react";

const KIND_META = {
  email: { label: "Emails", singular: "email", placeholder: "correo@ejemplo.com", inputType: "email" },
  phone: { label: "Teléfonos", singular: "teléfono", placeholder: "600 123 456", inputType: "tel" },
};

function IconMail() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" />
    </svg>
  );
}
function IconPhone() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2 4.2 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.5 2.1L8 9.6a16 16 0 0 0 6 6l1.2-1.1a2 2 0 0 1 2.1-.5c.8.3 1.7.5 2.6.6a2 2 0 0 1 1.7 2Z" />
    </svg>
  );
}

export default function ClientContactMethodsSection({ clientId }) {
  const [methods, setMethods] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null); // { id, value, label }
  const [adding, setAdding] = useState(null); // kind al que se está añadiendo
  const [draft, setDraft] = useState({ value: "", label: "" });
  const loadSeq = useRef(0); // guarda contra respuestas de refetch fuera de orden

  const load = useCallback(() => {
    const seq = ++loadSeq.current;
    setLoading(true);
    fetch(`/api/clients/${clientId}/contact-methods`)
      .then((r) => r.json())
      .then((d) => {
        if (seq !== loadSeq.current) return; // una carga más nueva ya está en curso
        if (!d.ok) throw new Error(d.error || "Error cargando contactos");
        setMethods(d.data.methods || []);
        setError(null);
      })
      .catch((e) => { if (seq === loadSeq.current) setError(e.message); })
      .finally(() => { if (seq === loadSeq.current) setLoading(false); });
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  async function mutate(fn) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function apiAdd(kind) {
    const value = draft.value.trim();
    if (!value) throw new Error("El valor no puede estar vacío");
    const r = await fetch(`/api/clients/${clientId}/contact-methods`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, value, label: draft.label.trim() || null }),
    });
    const d = await r.json();
    if (r.status === 503) throw new Error("Los contactos no están disponibles todavía en este tenant.");
    if (!r.ok) throw new Error(d.error || "No se pudo añadir");
    setAdding(null);
    setDraft({ value: "", label: "" });
  }

  async function apiPatch(id, payload) {
    const r = await fetch(`/api/clients/${clientId}/contact-methods/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "No se pudo guardar");
  }

  async function apiDelete(id) {
    const r = await fetch(`/api/clients/${clientId}/contact-methods/${id}`, { method: "DELETE" });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      throw new Error(d.error || "No se pudo eliminar");
    }
  }

  if (loading) return null;

  const groups = ["email", "phone"];

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden mt-6">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-700">Contactos</span>
        <span className="text-xs text-gray-400">El principal accede al portal y recibe avisos</span>
      </div>
      <div className="p-5 space-y-5">
        {groups.map((kind) => {
          const meta = KIND_META[kind];
          const items = methods.filter((m) => m.kind === kind);
          return (
            <div key={kind}>
              <div className="flex items-center gap-2 text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                <span className="text-gray-400">{kind === "email" ? <IconMail /> : <IconPhone />}</span>
                {meta.label}
              </div>

              {items.length === 0 && (
                <div className="text-xs text-gray-400 italic mb-2">Sin {meta.label.toLowerCase()}.</div>
              )}

              <ul className="space-y-2">
                {items.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2">
                    {editing?.id === m.id ? (
                      <>
                        <input
                          type={meta.inputType}
                          value={editing.value}
                          onChange={(e) => setEditing((s) => ({ ...s, value: e.target.value }))}
                          className="flex-1 min-w-[10rem] rounded-md border border-gray-300 px-2 py-1 text-sm"
                          placeholder={meta.placeholder}
                        />
                        <input
                          value={editing.label}
                          onChange={(e) => setEditing((s) => ({ ...s, label: e.target.value }))}
                          className="w-28 rounded-md border border-gray-300 px-2 py-1 text-sm"
                          placeholder="Etiqueta"
                        />
                        <button
                          disabled={busy}
                          onClick={() => mutate(() => apiPatch(m.id, { value: editing.value.trim(), label: editing.label.trim() || null }).then(() => setEditing(null)))}
                          className="text-xs font-medium px-2 py-1 rounded-md bg-[var(--color-primary)] text-white disabled:opacity-40"
                        >
                          Guardar
                        </button>
                        <button onClick={() => setEditing(null)} className="text-xs text-gray-500 px-1">Cancelar</button>
                      </>
                    ) : (
                      <>
                        <span className="flex-1 min-w-[8rem] text-sm text-gray-800 break-all">{m.value}</span>
                        {m.label && (
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-200 text-gray-600">{m.label}</span>
                        )}
                        {m.isPrimary ? (
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">Principal</span>
                        ) : (
                          <button
                            disabled={busy}
                            onClick={() => mutate(() => apiPatch(m.id, { isPrimary: true }))}
                            className="text-[11px] text-[var(--color-primary)] hover:underline disabled:opacity-40"
                          >
                            Hacer principal
                          </button>
                        )}
                        <button
                          onClick={() => setEditing({ id: m.id, value: m.value, label: m.label || "" })}
                          className="text-xs text-gray-500 hover:text-gray-800 px-1"
                          title="Editar"
                        >
                          Editar
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => {
                            if (window.confirm(`¿Eliminar este ${meta.singular}?`)) mutate(() => apiDelete(m.id));
                          }}
                          className="text-xs text-rose-500 hover:text-rose-700 px-1 disabled:opacity-40"
                          title="Eliminar"
                        >
                          Eliminar
                        </button>
                      </>
                    )}
                  </li>
                ))}
              </ul>

              {adding === kind ? (
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <input
                    type={meta.inputType}
                    autoFocus
                    value={draft.value}
                    onChange={(e) => setDraft((s) => ({ ...s, value: e.target.value }))}
                    className="flex-1 min-w-[10rem] rounded-md border border-gray-300 px-2 py-1 text-sm"
                    placeholder={meta.placeholder}
                  />
                  <input
                    value={draft.label}
                    onChange={(e) => setDraft((s) => ({ ...s, label: e.target.value }))}
                    className="w-28 rounded-md border border-gray-300 px-2 py-1 text-sm"
                    placeholder="Etiqueta"
                  />
                  <button
                    disabled={busy}
                    onClick={() => mutate(() => apiAdd(kind))}
                    className="text-xs font-medium px-2 py-1 rounded-md bg-[var(--color-primary)] text-white disabled:opacity-40"
                  >
                    Añadir
                  </button>
                  <button onClick={() => { setAdding(null); setDraft({ value: "", label: "" }); }} className="text-xs text-gray-500 px-1">
                    Cancelar
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => { setAdding(kind); setDraft({ value: "", label: "" }); }}
                  className="mt-2 text-xs font-medium text-[var(--color-primary)] hover:underline"
                >
                  + Añadir {meta.singular}
                </button>
              )}
            </div>
          );
        })}
        {error && <div className="text-xs text-rose-600">{error}</div>}
      </div>
    </div>
  );
}
