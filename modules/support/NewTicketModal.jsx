"use client";

import { useEffect, useMemo, useState } from "react";
import { ORDEN_PRIORIDADES, PRIORIDADES } from "./supportUi.js";

const CAMPO =
  "w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white outline-none transition-colors focus:border-gray-400";

/**
 * Alta manual de un ticket desde el CRM (llamada de teléfono, email suelto,
 * algo visto en persona). El cliente es opcional: puede ser alguien sin ficha
 * todavía (se rellena solicitante a mano).
 *
 * Respeta la barra móvil del dashboard (regla #13).
 */
export default function NewTicketModal({ categorias, equipo, clientePrefijado, onClose, onCreated }) {
  const [form, setForm] = useState({
    title: "",
    description: "",
    clientId: clientePrefijado || "",
    categoryId: "",
    priority: "medium",
    assignedTo: "",
    requesterName: "",
    requesterEmail: "",
    notifyClient: false,
  });
  const [clientes, setClientes] = useState([]);
  const [buscaCliente, setBuscaCliente] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [fallo, setFallo] = useState(null);

  // Clientes para el selector. Si el tenant no tiene el módulo clients (403),
  // el selector no aparece y el ticket nace con solicitante a mano.
  useEffect(() => {
    fetch("/api/clients?limit=200")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setClientes(j?.data?.clients || []))
      .catch(() => {});
  }, []);

  const clientesFiltrados = useMemo(() => {
    const q = buscaCliente.trim().toLowerCase();
    if (!q) return clientes.slice(0, 50);
    return clientes.filter((c) => (c.name || "").toLowerCase().includes(q)).slice(0, 50);
  }, [clientes, buscaCliente]);

  const clienteElegido = clientes.find((c) => c.id === form.clientId) || null;

  async function crear(e) {
    e.preventDefault();
    setFallo(null);
    setEnviando(true);
    try {
      const body = { ...form };
      for (const k of ["clientId", "categoryId", "assignedTo"]) if (!body[k]) delete body[k];
      for (const k of ["requesterName", "requesterEmail", "description"]) if (!body[k]) delete body[k];
      const res = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "No se ha podido crear el ticket");
      onCreated?.(json.data);
    } catch (err) {
      setFallo(err.message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} aria-hidden="true" />
      <div className="fixed top-14 lg:top-0 bottom-0 right-0 z-50 w-full max-w-lg bg-white shadow-2xl flex flex-col">
        <div className="border-b border-gray-100 px-5 py-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Nuevo ticket</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1" aria-label="Cerrar">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={crear} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <Campo etiqueta="Asunto *">
            <input
              type="text"
              required
              maxLength={255}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className={CAMPO}
              placeholder="Qué necesita el cliente, en una línea"
              autoFocus
            />
          </Campo>

          <Campo etiqueta="Descripción">
            <textarea
              rows={4}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className={`${CAMPO} resize-y`}
              placeholder="Detalle de la petición o incidencia"
            />
          </Campo>

          {clientes.length > 0 && (
            <Campo etiqueta="Cliente">
              {clienteElegido ? (
                <div className="flex items-center gap-2 text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                  <span className="flex-1 truncate font-medium text-gray-800">{clienteElegido.name}</span>
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, clientId: "" })}
                    className="text-gray-400 hover:text-red-500 text-xs"
                  >
                    Quitar
                  </button>
                </div>
              ) : (
                <div>
                  <input
                    type="search"
                    value={buscaCliente}
                    onChange={(e) => setBuscaCliente(e.target.value)}
                    className={CAMPO}
                    placeholder="Buscar cliente…"
                  />
                  {buscaCliente.trim() && (
                    <div className="mt-1 border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-44 overflow-y-auto">
                      {clientesFiltrados.length === 0 && (
                        <div className="px-3 py-2 text-xs text-gray-400">Sin resultados. El ticket puede ir sin ficha.</div>
                      )}
                      {clientesFiltrados.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => {
                            setForm({ ...form, clientId: c.id });
                            setBuscaCliente("");
                          }}
                          className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                        >
                          {c.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </Campo>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Campo etiqueta="Prioridad">
              <select
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value })}
                className={CAMPO}
              >
                {ORDEN_PRIORIDADES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORIDADES[p].label}
                  </option>
                ))}
              </select>
            </Campo>
            {categorias.length > 0 && (
              <Campo etiqueta="Categoría">
                <select
                  value={form.categoryId}
                  onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
                  className={CAMPO}
                >
                  <option value="">Sin categoría</option>
                  {categorias.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Campo>
            )}
          </div>

          {equipo.length > 0 && (
            <Campo etiqueta="Responsable">
              <select
                value={form.assignedTo}
                onChange={(e) => setForm({ ...form, assignedTo: e.target.value })}
                className={CAMPO}
              >
                <option value="">Sin asignar</option>
                {equipo.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName || m.email || "—"}
                  </option>
                ))}
              </select>
            </Campo>
          )}

          {/* Solicitante a mano (si no hay ficha, o para afinar) */}
          <div className="grid grid-cols-2 gap-3">
            <Campo etiqueta="Solicitante">
              <input
                type="text"
                value={form.requesterName}
                onChange={(e) => setForm({ ...form, requesterName: e.target.value })}
                className={CAMPO}
                placeholder={clienteElegido ? clienteElegido.name : "Nombre"}
              />
            </Campo>
            <Campo etiqueta="Email del solicitante">
              <input
                type="email"
                value={form.requesterEmail}
                onChange={(e) => setForm({ ...form, requesterEmail: e.target.value })}
                className={CAMPO}
                placeholder={clienteElegido?.email || "email@…"}
              />
            </Campo>
          </div>

          <label className="flex items-start gap-2.5 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={form.notifyClient}
              onChange={(e) => setForm({ ...form, notifyClient: e.target.checked })}
              className="mt-0.5"
            />
            <span>
              Enviar confirmación al cliente por email
              <span className="block text-xs text-gray-400 mt-0.5">Con su número de ticket y el enlace de seguimiento.</span>
            </span>
          </label>

          {fallo && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3.5 py-2.5 text-sm">{fallo}</div>}
        </form>

        <div className="border-t border-gray-100 px-5 py-3 flex items-center justify-end gap-2">
          <button onClick={onClose} type="button" className="text-sm text-gray-600 hover:text-gray-900 px-3 py-2">
            Cancelar
          </button>
          <button
            onClick={crear}
            disabled={enviando || !form.title.trim()}
            className="bg-[var(--color-primary)] hover:opacity-90 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-opacity disabled:opacity-40 inline-flex items-center gap-2"
          >
            {enviando && <span className="w-3.5 h-3.5 border-2 border-white/50 border-t-transparent rounded-full animate-spin" />}
            Crear ticket
          </button>
        </div>
      </div>
    </>
  );
}

function Campo({ etiqueta, children }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-gray-600 mb-1.5">{etiqueta}</span>
      {children}
    </label>
  );
}
