"use client";

import { useEffect, useRef, useState } from "react";
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
  // El buscador de fichas pregunta al SERVIDOR según se escribe (28/08/2026).
  // Antes se bajaba una lista de 200 al abrir y se filtraba encima: en Aumenta,
  // con 1.083 fichas, 883 familias no aparecían ESCRIBIERAS LO QUE ESCRIBIERAS,
  // y la caja contestaba «sin resultados» — lo mismo que si no existieran. El
  // tope tampoco se podía subir: el endpoint corta en 200 por su cuenta.
  const [clientes, setClientes] = useState([]);
  const [buscaCliente, setBuscaCliente] = useState("");
  const [hayFichas, setHayFichas] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const [coincidencias, setCoincidencias] = useState(0);
  const [clienteElegido, setClienteElegido] = useState(null);
  // Cada búsqueda lleva número: si una lenta contesta después de otra más nueva,
  // se tira. Sin esto, escribir deprisa deja en pantalla el resultado de una
  // consulta vieja.
  const peticion = useRef(0);
  const [enviando, setEnviando] = useState(false);
  const [fallo, setFallo] = useState(null);

  // ¿Este centro tiene fichas? Si no tiene el módulo (403), el selector no
  // aparece y el ticket nace con el solicitante escrito a mano. De paso deja unas
  // pocas a la vista, para no recibir a nadie con una caja vacía.
  useEffect(() => {
    fetch("/api/clients?limit=8")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j?.data) return;
        setHayFichas(true);
        setClientes(j.data.clients || []);
        setCoincidencias(j.data.total ?? 0);
      })
      .catch(() => {});
  }, []);

  // La ficha prefijada se pide por su id. Antes se buscaba dentro de la lista
  // descargada, así que una que no estuviera en ella salía como «sin elegir»
  // aunque el ticket sí fuera a nacer con ella.
  useEffect(() => {
    if (!clientePrefijado) return;
    fetch(`/api/clients/${clientePrefijado}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j?.data) setClienteElegido({ id: j.data.id, name: j.data.name, email: j.data.email });
      })
      .catch(() => {});
  }, [clientePrefijado]);

  // Buscar de verdad, con 300 ms de espera para no preguntar en cada tecla.
  useEffect(() => {
    if (!hayFichas) return undefined;
    const texto = buscaCliente.trim();
    const mia = ++peticion.current;
    setBuscando(Boolean(texto));
    const t = setTimeout(() => {
      const url = texto
        ? `/api/clients?limit=20&search=${encodeURIComponent(texto)}`
        : "/api/clients?limit=8";
      fetch(url)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (mia !== peticion.current) return; // llegó tarde: manda la última
          setClientes(j?.data?.clients || []);
          setCoincidencias(j?.data?.total ?? 0);
          setBuscando(false);
        })
        .catch(() => {
          if (mia === peticion.current) setBuscando(false);
        });
    }, 300);
    return () => clearTimeout(t);
  }, [buscaCliente, hayFichas]);

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

          {hayFichas && (
            <Campo etiqueta="Cliente">
              {clienteElegido ? (
                <div className="flex items-center gap-2 text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                  <span className="flex-1 truncate font-medium text-gray-800">{clienteElegido.name}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setForm({ ...form, clientId: "" });
                      setClienteElegido(null);
                    }}
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
                  <div className="mt-1 border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-44 overflow-y-auto">
                    {buscando && <div className="px-3 py-2 text-xs text-gray-400">Buscando…</div>}
                    {!buscando && clientes.length === 0 && (
                      <div className="px-3 py-2 text-xs text-gray-400">Sin resultados. El ticket puede ir sin ficha.</div>
                    )}
                    {!buscando &&
                      clientes.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => {
                            setForm({ ...form, clientId: c.id });
                            setClienteElegido(c);
                            setBuscaCliente("");
                          }}
                          className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                        >
                          {c.name}
                          {c.email && <span className="block text-[11px] text-gray-400">{c.email}</span>}
                        </button>
                      ))}
                  </div>
                  {/*
                    Cuántas quedan fuera. Un tope callado es justo lo que tenía esto
                    roto: la caja enseñaba lo que le cabía y no decía que hubiera más,
                    así que «no está» y «no cabe» se veían igual.
                  */}
                  {!buscando && coincidencias > clientes.length && (
                    <p className="mt-1 text-[11px] text-gray-400">
                      {coincidencias} fichas coinciden; se enseñan {clientes.length}. Escribe un poco más para afinar.
                    </p>
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
