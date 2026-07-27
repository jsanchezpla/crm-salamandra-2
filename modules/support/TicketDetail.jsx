"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ESTADOS, PRIORIDADES, ORDEN_PRIORIDADES, fmtFecha, haceCuanto, plazo } from "./supportUi.js";

/**
 * Drawer de detalle de un ticket: hilo a la izquierda, propiedades a la
 * derecha, composer abajo. Respeta la barra móvil del dashboard (regla #13:
 * top-14 lg:top-0).
 *
 * El composer distingue RESPUESTA (le llega al cliente por email y pasa el
 * ticket a "esperando") de NOTA INTERNA (solo la ve el equipo). La IA nunca
 * envía nada sola: "Borrador" rellena el cuadro y lo revisas tú.
 */

const MAX_FILES = 5;

export default function TicketDetail({ ticketId, categorias, equipo, esAdmin, onClose, onChanged }) {
  const [ticket, setTicket] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [fallo, setFallo] = useState(null);

  const [modo, setModo] = useState("reply"); // reply | note
  const [texto, setTexto] = useState("");
  const [files, setFiles] = useState([]);
  const [mandarEmail, setMandarEmail] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [plantillas, setPlantillas] = useState([]);
  const [editandoSla, setEditandoSla] = useState(false);
  const [slaForm, setSlaForm] = useState({ firstResponseDueAt: "", resolutionDueAt: "" });

  const [resumen, setResumen] = useState(null);
  const [iaOcupada, setIaOcupada] = useState(null); // summarize | draft | classify
  const [sugerencia, setSugerencia] = useState(null);
  const [guardandoProp, setGuardandoProp] = useState(false);

  const hiloRef = useRef(null);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`/api/tickets/${ticketId}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "No se ha podido cargar el ticket");
      setTicket(json.data);
    } catch (e) {
      setFallo(e.message);
    } finally {
      setCargando(false);
    }
  }, [ticketId]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  useEffect(() => {
    fetch("/api/tickets/templates")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setPlantillas((j?.data?.templates || []).filter((t) => t.active)))
      .catch(() => {});
  }, []);

  // Cerrar con Escape.
  useEffect(() => {
    const fn = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [onClose]);

  async function patch(cambios) {
    setGuardandoProp(true);
    try {
      const res = await fetch(`/api/tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cambios),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "No se ha podido guardar");
      setTicket(json.data);
      onChanged?.();
    } catch (e) {
      setFallo(e.message);
    } finally {
      setGuardandoProp(false);
    }
  }

  async function enviar(e) {
    e?.preventDefault();
    if (!texto.trim() && files.length === 0) return;
    setEnviando(true);
    setFallo(null);
    try {
      let res;
      const isInternal = modo === "note";
      if (files.length > 0) {
        const fd = new FormData();
        fd.set("body", texto);
        fd.set("isInternal", String(isInternal));
        fd.set("sendEmail", String(mandarEmail));
        for (const f of files) fd.append("files", f);
        res = await fetch(`/api/tickets/${ticketId}/messages`, { method: "POST", body: fd });
      } else {
        res = await fetch(`/api/tickets/${ticketId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: texto, isInternal, sendEmail: mandarEmail }),
        });
      }
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "No se ha podido enviar");
      setTexto("");
      setFiles([]);
      await cargar();
      onChanged?.();
      setTimeout(() => hiloRef.current?.scrollTo({ top: hiloRef.current.scrollHeight, behavior: "smooth" }), 100);
    } catch (err) {
      setFallo(err.message);
    } finally {
      setEnviando(false);
    }
  }

  async function accionIa(action) {
    setIaOcupada(action);
    setFallo(null);
    try {
      const res = await fetch(`/api/tickets/${ticketId}/ai`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "La IA no ha respondido");
      if (action === "summarize") setResumen(json.data.summary);
      if (action === "draft") {
        setModo("reply");
        setTexto(json.data.draft);
      }
      if (action === "classify") setSugerencia(json.data);
    } catch (e) {
      setFallo(e.message);
    } finally {
      setIaOcupada(null);
    }
  }

  async function eliminar() {
    if (!window.confirm(`¿Eliminar del todo el ticket ${ticket?.ref}? Se borra el hilo y los adjuntos. No se puede deshacer.`)) return;
    try {
      const res = await fetch(`/api/tickets/${ticketId}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "No se ha podido eliminar");
      onChanged?.();
      onClose();
    } catch (e) {
      setFallo(e.message);
    }
  }

  function elegirArchivos(e) {
    const nuevos = Array.from(e.target.files || []);
    setFiles((prev) => [...prev, ...nuevos].slice(0, MAX_FILES));
    e.target.value = "";
  }

  const estado = ticket ? ESTADOS[ticket.status] || ESTADOS.open : null;
  const activo = ticket && ["open", "in_progress", "waiting"].includes(ticket.status);
  const adjuntosSueltos = (ticket?.attachments || []).filter((a) => a.messageId === null);

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} aria-hidden="true" />

      {/* Drawer (regla #13: respeta la barra móvil h-14) */}
      <aside className="fixed top-14 lg:top-0 bottom-0 right-0 z-50 w-full max-w-3xl bg-white shadow-2xl flex flex-col">
        {cargando && (
          <div className="flex-1 flex items-center justify-center gap-3 text-sm text-gray-500">
            <div className="w-4 h-4 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
            Cargando ticket…
          </div>
        )}

        {!cargando && !ticket && (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8 text-center">
            <p className="text-sm text-gray-500">{fallo || "Ticket no encontrado"}</p>
            <button onClick={onClose} className="text-sm font-medium text-gray-700 border border-gray-200 rounded-lg px-4 py-2 hover:border-gray-300">
              Cerrar
            </button>
          </div>
        )}

        {ticket && (
          <>
            {/* Cabecera */}
            <div className="border-b border-gray-100 px-4 lg:px-6 py-4 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[12px] font-mono text-gray-400">{ticket.ref}</span>
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${estado.chip}`}>{estado.label}</span>
                  {ticket.channel === "portal" && (
                    <span className="text-[11px] text-gray-500 border border-gray-200 rounded-full px-2 py-0.5">portal</span>
                  )}
                </div>
                <h2 className="text-base font-semibold text-gray-900 mt-1 leading-snug">{ticket.title}</h2>
              </div>
              <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 shrink-0" aria-label="Cerrar">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Acciones rápidas */}
            <div className="border-b border-gray-100 px-4 lg:px-6 py-2.5 flex items-center gap-2 flex-wrap">
              {activo && (
                <>
                  <BotonAccion onClick={() => patch({ status: "resolved" })} disabled={guardandoProp} tono="verde">
                    Marcar resuelto
                  </BotonAccion>
                  {ticket.status !== "in_progress" && (
                    <BotonAccion onClick={() => patch({ status: "in_progress" })} disabled={guardandoProp}>
                      En curso
                    </BotonAccion>
                  )}
                </>
              )}
              {ticket.status === "resolved" && (
                <>
                  <BotonAccion onClick={() => patch({ status: "closed" })} disabled={guardandoProp}>
                    Cerrar definitivamente
                  </BotonAccion>
                  <BotonAccion onClick={() => patch({ status: "open" })} disabled={guardandoProp}>
                    Reabrir
                  </BotonAccion>
                </>
              )}
              {ticket.status === "closed" && (
                <BotonAccion onClick={() => patch({ status: "open" })} disabled={guardandoProp}>
                  Reabrir
                </BotonAccion>
              )}

              <span className="flex-1" />

              {/* IA a demanda */}
              <BotonAccion onClick={() => accionIa("summarize")} disabled={!!iaOcupada} ocupado={iaOcupada === "summarize"}>
                Resumir
              </BotonAccion>
              <BotonAccion onClick={() => accionIa("classify")} disabled={!!iaOcupada} ocupado={iaOcupada === "classify"}>
                Clasificar
              </BotonAccion>
              {esAdmin && (
                <button onClick={eliminar} className="text-xs text-rose-500 hover:text-rose-700 px-2 py-1.5 transition-colors">
                  Eliminar
                </button>
              )}
            </div>

            {fallo && (
              <div className="mx-4 lg:mx-6 mt-3 bg-red-50 border border-red-200 text-red-700 rounded-lg px-3.5 py-2.5 text-sm flex items-start gap-2">
                <span className="flex-1">{fallo}</span>
                <button onClick={() => setFallo(null)} className="shrink-0" aria-label="Cerrar aviso">✕</button>
              </div>
            )}

            {/* Cuerpo: hilo + propiedades */}
            <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
              {/* Hilo */}
              <div ref={hiloRef} className="flex-1 min-w-0 overflow-y-auto px-4 lg:px-6 py-4 space-y-3 bg-gray-50/60">
                {resumen && (
                  <div className="bg-white border border-gray-200 rounded-xl px-4 py-3">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">Resumen (IA)</span>
                      <button onClick={() => setResumen(null)} className="text-gray-300 hover:text-gray-500 text-xs" aria-label="Quitar resumen">✕</button>
                    </div>
                    <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{resumen}</p>
                  </div>
                )}

                {sugerencia && (
                  <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm">
                    <div className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold mb-1.5">Clasificación sugerida (IA)</div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {sugerencia.priority && (
                        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${PRIORIDADES[sugerencia.priority].chip}`}>
                          {PRIORIDADES[sugerencia.priority].label}
                        </span>
                      )}
                      {sugerencia.categoryId && (
                        <span className="text-[11px] font-medium px-2 py-0.5 rounded-full border border-gray-200 text-gray-600">
                          {categorias.find((c) => c.id === sugerencia.categoryId)?.name || "Categoría"}
                        </span>
                      )}
                      {!sugerencia.priority && !sugerencia.categoryId && <span className="text-gray-500">Sin sugerencias claras.</span>}
                      {(sugerencia.priority || sugerencia.categoryId) && (
                        <button
                          onClick={() => {
                            const cambios = {};
                            if (sugerencia.priority) cambios.priority = sugerencia.priority;
                            if (sugerencia.categoryId) cambios.categoryId = sugerencia.categoryId;
                            patch(cambios);
                            setSugerencia(null);
                          }}
                          className="ml-auto text-xs font-semibold text-white bg-gray-900 hover:bg-gray-800 rounded-md px-2.5 py-1 transition-colors"
                        >
                          Aplicar
                        </button>
                      )}
                      <button onClick={() => setSugerencia(null)} className="text-gray-300 hover:text-gray-500 text-xs" aria-label="Descartar">✕</button>
                    </div>
                  </div>
                )}

                {/* Descripción inicial */}
                {ticket.description && (
                  <Mensaje
                    autor={ticket.requesterName || ticket.client?.name || "Solicitante"}
                    fecha={ticket.createdAt}
                    tipo="client"
                  >
                    {ticket.description}
                    <ListaAdjuntos lista={adjuntosSueltos} />
                  </Mensaje>
                )}

                {(ticket.messages || []).map((m) =>
                  m.authorType === "system" ? (
                    <div key={m.id} className="text-center">
                      <span className="inline-block text-[11px] text-gray-400 bg-gray-100 rounded-full px-3 py-1">
                        {m.body} · {haceCuanto(m.createdAt)}
                      </span>
                    </div>
                  ) : (
                    <Mensaje
                      key={m.id}
                      autor={m.authorName || (m.authorType === "client" ? "Cliente" : "Equipo")}
                      autorEmail={m.authorEmail}
                      fecha={m.createdAt}
                      tipo={m.authorType}
                      interna={m.isInternal}
                      emailStatus={m.emailStatus}
                      via={m.via}
                    >
                      {m.body}
                      <ListaAdjuntos lista={m.attachments} />
                    </Mensaje>
                  )
                )}
              </div>

              {/* Propiedades */}
              <div className="lg:w-72 shrink-0 border-t lg:border-t-0 lg:border-l border-gray-100 px-4 lg:px-5 py-4 space-y-4 overflow-y-auto bg-white">
                <Prop label="Prioridad">
                  <select
                    value={ticket.priority}
                    onChange={(e) => patch({ priority: e.target.value })}
                    disabled={guardandoProp}
                    className="prop-select w-full text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white outline-none focus:border-gray-400"
                  >
                    {ORDEN_PRIORIDADES.map((p) => (
                      <option key={p} value={p}>
                        {PRIORIDADES[p].label}
                      </option>
                    ))}
                  </select>
                </Prop>

                <Prop label="Categoría">
                  <select
                    value={ticket.categoryId || ""}
                    onChange={(e) => patch({ categoryId: e.target.value || null })}
                    disabled={guardandoProp}
                    className="w-full text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white outline-none focus:border-gray-400"
                  >
                    <option value="">Sin categoría</option>
                    {categorias.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </Prop>

                <Prop label="Responsable">
                  <select
                    value={ticket.assignedTo || ""}
                    onChange={(e) => patch({ assignedTo: e.target.value || null })}
                    disabled={guardandoProp}
                    className="w-full text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white outline-none focus:border-gray-400"
                  >
                    <option value="">Sin asignar</option>
                    {equipo.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.displayName || m.email || "—"}
                      </option>
                    ))}
                  </select>
                </Prop>

                <Prop label="Cliente">
                  {ticket.client ? (
                    <a href={`/clientes/${ticket.client.id}`} className="text-sm text-[var(--color-primary)] font-medium hover:underline break-words">
                      {ticket.client.name}
                    </a>
                  ) : (
                    <span className="text-sm text-gray-400">Sin ficha vinculada</span>
                  )}
                </Prop>

                <Prop label="Solicitante">
                  <div className="text-sm text-gray-700">{ticket.requesterName || "—"}</div>
                  {ticket.requesterEmail && <div className="text-xs text-gray-500 break-all mt-0.5">{ticket.requesterEmail}</div>}
                </Prop>

                {/* SLA — editable POR TICKET: los plazos de config son el punto
                    de partida, pero un ticket concreto puede pactarse aparte. */}
                <Prop
                  label="SLA"
                  accion={
                    !editandoSla && (
                      <button
                        onClick={() => {
                          setSlaForm({
                            firstResponseDueAt: toLocalInput(ticket.sla?.firstResponse?.dueAt),
                            resolutionDueAt: toLocalInput(ticket.sla?.resolution?.dueAt),
                          });
                          setEditandoSla(true);
                        }}
                        className="text-[10px] font-medium text-gray-400 hover:text-gray-700 transition-colors"
                      >
                        Ajustar
                      </button>
                    )
                  }
                >
                  {!editandoSla ? (
                    <>
                      <SlaLinea titulo="1ª respuesta" hito={ticket.sla?.firstResponse} />
                      <SlaLinea titulo="Resolución" hito={ticket.sla?.resolution} />
                    </>
                  ) : (
                    <div className="space-y-2">
                      <label className="block">
                        <span className="block text-[10px] text-gray-500 mb-1">Objetivo de 1ª respuesta</span>
                        <input
                          type="datetime-local"
                          value={slaForm.firstResponseDueAt}
                          onChange={(e) => setSlaForm({ ...slaForm, firstResponseDueAt: e.target.value })}
                          className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:border-gray-400"
                        />
                      </label>
                      <label className="block">
                        <span className="block text-[10px] text-gray-500 mb-1">Objetivo de resolución</span>
                        <input
                          type="datetime-local"
                          value={slaForm.resolutionDueAt}
                          onChange={(e) => setSlaForm({ ...slaForm, resolutionDueAt: e.target.value })}
                          className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:border-gray-400"
                        />
                      </label>
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          onClick={() => {
                            patch({
                              firstResponseDueAt: slaForm.firstResponseDueAt ? new Date(slaForm.firstResponseDueAt).toISOString() : null,
                              resolutionDueAt: slaForm.resolutionDueAt ? new Date(slaForm.resolutionDueAt).toISOString() : null,
                            });
                            setEditandoSla(false);
                          }}
                          disabled={guardandoProp}
                          className="text-xs font-semibold text-white bg-gray-900 hover:bg-gray-800 rounded-md px-2.5 py-1.5 transition-colors disabled:opacity-50"
                        >
                          Guardar
                        </button>
                        <button
                          onClick={() => {
                            patch({ slaReset: true });
                            setEditandoSla(false);
                          }}
                          disabled={guardandoProp}
                          className="text-xs text-gray-600 border border-gray-200 rounded-md px-2.5 py-1.5 hover:border-gray-300 transition-colors disabled:opacity-50"
                          title="Recalcular según la prioridad y la configuración del módulo"
                        >
                          Según prioridad
                        </button>
                        <button
                          onClick={() => setEditandoSla(false)}
                          className="text-xs text-gray-400 hover:text-gray-600 px-1"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}
                </Prop>

                <Prop label="Fechas">
                  <div className="text-xs text-gray-500 space-y-1">
                    <div>Abierto: {fmtFecha(ticket.createdAt)}</div>
                    {ticket.firstResponseAt && <div>1ª respuesta: {fmtFecha(ticket.firstResponseAt)}</div>}
                    {ticket.resolvedAt && <div>Resuelto: {fmtFecha(ticket.resolvedAt)}</div>}
                    {ticket.closedAt && <div>Cerrado: {fmtFecha(ticket.closedAt)}</div>}
                  </div>
                </Prop>
              </div>
            </div>

            {/* Composer */}
            {ticket.status !== "closed" && (
              <form onSubmit={enviar} className="border-t border-gray-200 px-4 lg:px-6 py-3 bg-white">
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
                    <button
                      type="button"
                      onClick={() => setModo("reply")}
                      className={`text-xs font-semibold px-3 py-1.5 rounded-md transition-colors ${
                        modo === "reply" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
                      }`}
                    >
                      Respuesta al cliente
                    </button>
                    <button
                      type="button"
                      onClick={() => setModo("note")}
                      className={`text-xs font-semibold px-3 py-1.5 rounded-md transition-colors ${
                        modo === "note" ? "bg-amber-100 text-amber-800 shadow-sm" : "text-gray-500 hover:text-gray-700"
                      }`}
                    >
                      Nota interna
                    </button>
                  </div>

                  {plantillas.length > 0 && modo === "reply" && (
                    <select
                      value=""
                      onChange={(e) => {
                        const t = plantillas.find((p) => p.id === e.target.value);
                        if (t) setTexto((prev) => (prev ? `${prev}\n\n${t.body}` : t.body));
                      }}
                      className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-500 outline-none"
                    >
                      <option value="">Plantilla…</option>
                      {plantillas.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  )}

                  <button
                    type="button"
                    onClick={() => accionIa("draft")}
                    disabled={!!iaOcupada}
                    className="text-xs font-medium text-gray-600 border border-gray-200 rounded-lg px-2.5 py-1.5 hover:border-gray-300 transition-colors disabled:opacity-50 inline-flex items-center gap-1.5"
                  >
                    {iaOcupada === "draft" ? (
                      <span className="w-3 h-3 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-3.5 h-3.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                      </svg>
                    )}
                    Borrador IA
                  </button>
                </div>

                <textarea
                  rows={3}
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  placeholder={modo === "reply" ? "Escribe la respuesta al cliente… (le llegará por email)" : "Nota interna: solo la ve el equipo"}
                  className={`w-full text-sm border rounded-lg px-3 py-2.5 outline-none transition-colors resize-y ${
                    modo === "note"
                      ? "bg-amber-50/60 border-amber-200 focus:border-amber-400"
                      : "bg-white border-gray-200 focus:border-gray-400"
                  }`}
                />

                {files.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {files.map((f, i) => (
                      <li key={`${f.name}-${i}`} className="flex items-center gap-2 text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-md px-2.5 py-1.5">
                        <span className="truncate flex-1">{f.name}</span>
                        <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-500" aria-label={`Quitar ${f.name}`}>
                          ✕
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="flex items-center justify-between gap-3 mt-2 flex-wrap">
                  <div className="flex items-center gap-4">
                    <label className="inline-flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer hover:text-gray-700 transition-colors">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
                      </svg>
                      Adjuntar ({files.length}/{MAX_FILES})
                      <input type="file" multiple className="hidden" onChange={elegirArchivos} />
                    </label>
                    {/* Enviar por email es una POSIBILIDAD, no una obligación: si el
                        equipo contesta desde su propio buzón (Outlook...), lo
                        desmarca y la respuesta solo queda registrada en el hilo. */}
                    {modo === "reply" && (
                      <label className="inline-flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer hover:text-gray-700 transition-colors">
                        <input
                          type="checkbox"
                          checked={mandarEmail}
                          onChange={(e) => setMandarEmail(e.target.checked)}
                        />
                        Enviar por email al cliente
                      </label>
                    )}
                  </div>
                  <button
                    type="submit"
                    disabled={enviando || (!texto.trim() && files.length === 0)}
                    className={`text-sm font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-40 inline-flex items-center gap-2 text-white ${
                      modo === "note" ? "bg-amber-600 hover:bg-amber-700" : "bg-[var(--color-primary)] hover:opacity-90"
                    }`}
                  >
                    {enviando && <span className="w-3.5 h-3.5 border-2 border-white/50 border-t-transparent rounded-full animate-spin" />}
                    {modo === "note" ? "Guardar nota" : mandarEmail ? "Enviar respuesta" : "Registrar respuesta"}
                  </button>
                </div>
              </form>
            )}
          </>
        )}
      </aside>
    </>
  );
}

function Mensaje({ autor, autorEmail, fecha, tipo, interna, emailStatus, via, children }) {
  const esCliente = tipo === "client";
  return (
    <div
      className={`rounded-xl border px-4 py-3 ${
        interna
          ? "bg-amber-50/70 border-amber-200"
          : esCliente
            ? "bg-white border-gray-200"
            : "bg-[var(--color-primary)]/[0.04] border-gray-200"
      }`}
    >
      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
        <span className="text-xs font-semibold text-gray-700">{autor}</span>
        {/* Origen del mensaje: que quede claro quién escribió un correo normal
            (con su dirección) o quién entró por el portal. */}
        {via === "email" && (
          <span className="text-[10px] font-medium text-sky-700 bg-sky-50 border border-sky-200 rounded px-1.5 py-0.5" title={autorEmail || undefined}>
            ✉ por correo{autorEmail ? ` · ${autorEmail}` : ""}
          </span>
        )}
        {via === "portal" && (
          <span className="text-[10px] font-medium text-gray-500 bg-gray-50 border border-gray-200 rounded px-1.5 py-0.5">
            desde el portal
          </span>
        )}
        {interna && (
          <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 bg-amber-100 rounded px-1.5 py-0.5">
            Nota interna
          </span>
        )}
        {!interna && !esCliente && emailStatus === "sent" && (
          <span className="text-[10px] text-emerald-600">✓ enviado por email</span>
        )}
        {!interna && !esCliente && emailStatus === "manual" && (
          <span className="text-[10px] text-gray-400">registrado sin envío</span>
        )}
        {!interna && !esCliente && emailStatus === "skipped" && (
          <span className="text-[10px] text-gray-400">sin email del cliente</span>
        )}
        {!interna && !esCliente && emailStatus === "failed" && (
          <span className="text-[10px] text-red-500">⚠ email no entregado</span>
        )}
        <span className="text-[11px] text-gray-400 ml-auto">{haceCuanto(fecha)}</span>
      </div>
      <div className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap break-words">{children}</div>
    </div>
  );
}

function ListaAdjuntos({ lista }) {
  if (!lista || lista.length === 0) return null;
  return (
    <div className="mt-2 flex flex-col gap-1">
      {lista.map((a) => (
        <a
          key={a.id}
          href={`/api/tickets/attachments/${a.id}`}
          className="inline-flex items-center gap-1.5 text-xs text-[var(--color-primary)] underline underline-offset-2 hover:opacity-80"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-3.5 h-3.5 shrink-0">
            <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
          </svg>
          <span className="truncate">{a.fileName}</span>
          <span className="text-gray-400 no-underline">({Math.ceil((a.fileSize || 0) / 1024)} KB)</span>
        </a>
      ))}
    </div>
  );
}

function Prop({ label, accion, children }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">{label}</div>
        {accion || null}
      </div>
      {children}
    </div>
  );
}

/** ISO → valor de <input type="datetime-local"> en hora local (o ""). */
function toLocalInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function SlaLinea({ titulo, hito }) {
  if (!hito || hito.state === "none") {
    return (
      <div className="flex items-center justify-between text-xs py-0.5">
        <span className="text-gray-500">{titulo}</span>
        <span className="text-gray-400">sin objetivo</span>
      </div>
    );
  }
  const mapa = {
    met: { texto: "cumplido", clase: "text-emerald-600" },
    missed: { texto: "fuera de plazo", clase: "text-orange-600" },
    breached: { texto: plazo(hito.dueAt), clase: "text-red-600 font-semibold" },
    pending: { texto: plazo(hito.dueAt), clase: "text-gray-600" },
  };
  const v = mapa[hito.state] || mapa.pending;
  return (
    <div className="flex items-center justify-between text-xs py-0.5 gap-2">
      <span className="text-gray-500 shrink-0">{titulo}</span>
      <span className={`text-right ${v.clase}`}>{v.texto}</span>
    </div>
  );
}

function BotonAccion({ onClick, disabled, ocupado, tono, children }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`text-xs font-medium px-2.5 py-1.5 rounded-lg border transition-colors disabled:opacity-50 inline-flex items-center gap-1.5 ${
        tono === "verde"
          ? "bg-emerald-600 border-emerald-600 text-white hover:bg-emerald-700"
          : "bg-white border-gray-200 text-gray-700 hover:border-gray-300"
      }`}
    >
      {ocupado && <span className="w-3 h-3 border-2 border-current/40 border-t-transparent rounded-full animate-spin" />}
      {children}
    </button>
  );
}
