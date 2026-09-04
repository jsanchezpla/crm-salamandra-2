"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { leerRespuestaApi } from "@/lib/utils/respuestaApi.js";

/**
 * Portal público de soporte — seguimiento de UNA solicitud por token.
 * Es la página del enlace que el cliente recibe por email: hilo público
 * (sin notas internas), estado, adjuntos y cuadro para responder.
 */

const MAX_FILES = 3;

const ESTADOS = {
  open: { label: "Abierta", clase: "bg-blue-50 text-blue-700 border-blue-200" },
  in_progress: { label: "En curso", clase: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  waiting: { label: "Esperando tu respuesta", clase: "bg-amber-50 text-amber-700 border-amber-200" },
  resolved: { label: "Resuelta", clase: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  closed: { label: "Cerrada", clase: "bg-neutral-100 text-neutral-600 border-neutral-200" },
};

function fmtFecha(valor) {
  if (!valor) return "";
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return "";
  return (
    d.toLocaleDateString("es-ES", { day: "2-digit", month: "short" }) +
    " · " +
    d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })
  );
}

export default function SeguimientoTicketPage() {
  const params = useParams();
  const tenantSlug = params?.tenantSlug;
  const token = params?.token;

  const [ticket, setTicket] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [noEncontrado, setNoEncontrado] = useState(false);

  const [respuesta, setRespuesta] = useState("");
  const [files, setFiles] = useState([]);
  const [enviando, setEnviando] = useState(false);
  const [fallo, setFallo] = useState(null);
  const finRef = useRef(null);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`/api/public/c/${tenantSlug}/soporte/t/${token}`, { cache: "no-store" });
      if (!res.ok) {
        setNoEncontrado(true);
        return;
      }
      const json = await res.json();
      setTicket(json.data);
    } catch {
      setNoEncontrado(true);
    } finally {
      setCargando(false);
    }
  }, [tenantSlug, token]);

  useEffect(() => {
    if (tenantSlug && token) cargar();
  }, [tenantSlug, token, cargar]);

  function elegirArchivos(e) {
    const nuevos = Array.from(e.target.files || []);
    setFiles((prev) => [...prev, ...nuevos].slice(0, MAX_FILES));
    e.target.value = "";
  }

  async function responder(e) {
    e.preventDefault();
    if (!respuesta.trim() && files.length === 0) return;
    setFallo(null);
    setEnviando(true);
    try {
      let res;
      if (files.length > 0) {
        const fd = new FormData();
        fd.set("body", respuesta);
        for (const f of files) fd.append("files", f);
        res = await fetch(`/api/public/c/${tenantSlug}/soporte/t/${token}`, { method: "POST", body: fd });
      } else {
        res = await fetch(`/api/public/c/${tenantSlug}/soporte/t/${token}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: respuesta }),
        });
      }
      const json = await leerRespuestaApi(res);
      if (!res.ok) throw new Error(json.error || "No se ha podido enviar.");
      setRespuesta("");
      setFiles([]);
      await cargar();
      setTimeout(() => finRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), 100);
    } catch (err) {
      setFallo(err.message);
    } finally {
      setEnviando(false);
    }
  }

  if (cargando) {
    return (
      <Shell>
        <div className="flex items-center justify-center gap-3 py-24 text-sm text-neutral-500">
          <span className="w-4 h-4 border-2 border-neutral-300 border-t-transparent rounded-full animate-spin" />
          Cargando…
        </div>
      </Shell>
    );
  }

  if (noEncontrado || !ticket) {
    return (
      <Shell>
        <div className="text-center py-24 px-6">
          <h1 className="text-xl font-semibold text-neutral-800 mb-2">Solicitud no encontrada</h1>
          <p className="text-sm text-neutral-500 max-w-sm mx-auto">
            El enlace no es válido o ha caducado. Revisa el email que te enviamos o abre una solicitud nueva.
          </p>
        </div>
      </Shell>
    );
  }

  const estado = ESTADOS[ticket.status] || ESTADOS.open;
  const cerrado = ticket.status === "closed";
  const adjuntosDe = (messageId) => ticket.attachments.filter((a) => a.messageId === messageId);
  const adjuntosIniciales = ticket.attachments.filter((a) => a.messageId === null);

  return (
    <Shell>
      {/* Cabecera */}
      <div className="px-6 lg:px-8 pt-7 pb-5 border-b border-neutral-100">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.18em] text-neutral-400 mb-1">Solicitud {ticket.ref}</p>
            <h1 className="text-lg font-semibold text-neutral-900 leading-snug">{ticket.title}</h1>
            <p className="text-xs text-neutral-400 mt-1">Abierta el {fmtFecha(ticket.createdAt)}</p>
          </div>
          <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border shrink-0 ${estado.clase}`}>
            {estado.label}
          </span>
        </div>
      </div>

      {/* Hilo */}
      <div className="px-6 lg:px-8 py-6 space-y-4 bg-neutral-50/60">
        {/* Mensaje inicial (la descripción) */}
        {ticket.description && (
          <Burbuja propio autor="Tú" fecha={fmtFecha(ticket.createdAt)}>
            {ticket.description}
            <Adjuntos lista={adjuntosIniciales} tenantSlug={tenantSlug} token={token} />
          </Burbuja>
        )}

        {ticket.messages.map((m) => (
          <Burbuja
            key={m.id}
            propio={m.from === "you"}
            autor={m.from === "you" ? "Tú" : "Equipo de soporte"}
            fecha={fmtFecha(m.createdAt)}
          >
            {m.body}
            <Adjuntos lista={adjuntosDe(m.id)} tenantSlug={tenantSlug} token={token} />
          </Burbuja>
        ))}

        {ticket.messages.length === 0 && !ticket.description && (
          <p className="text-sm text-neutral-400 text-center py-6">Sin mensajes todavía.</p>
        )}
        <div ref={finRef} />
      </div>

      {/* Responder */}
      <div className="px-6 lg:px-8 py-5 border-t border-neutral-100">
        {cerrado ? (
          <p className="text-sm text-neutral-500 text-center">
            Esta solicitud está cerrada. Si necesitas algo más, abre una nueva desde el portal de soporte.
          </p>
        ) : (
          <form onSubmit={responder} className="space-y-3">
            {ticket.status === "resolved" && (
              <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg px-4 py-3 text-sm">
                Hemos marcado tu solicitud como resuelta. Si sigue sin estar bien, responde aquí y la reabrimos.
              </div>
            )}
            <textarea
              rows={3}
              maxLength={8000}
              value={respuesta}
              onChange={(e) => setRespuesta(e.target.value)}
              placeholder="Escribe tu respuesta…"
              className="w-full text-sm border border-neutral-200 rounded-lg px-3 py-2.5 bg-white outline-none transition-colors focus:border-neutral-400 resize-y"
            />
            {files.length > 0 && (
              <ul className="space-y-1">
                {files.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="flex items-center gap-2 text-xs text-neutral-600 bg-neutral-50 border border-neutral-200 rounded-md px-2.5 py-1.5">
                    <span className="truncate flex-1">{f.name}</span>
                    <button
                      type="button"
                      onClick={() => setFiles(files.filter((_, j) => j !== i))}
                      className="text-neutral-400 hover:text-red-500 shrink-0"
                      aria-label={`Quitar ${f.name}`}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {fallo && (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-2.5 text-sm">{fallo}</div>
            )}
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <label className="inline-flex items-center gap-2 text-xs text-neutral-500 cursor-pointer hover:text-neutral-700 transition-colors">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
                </svg>
                Adjuntar ({files.length}/{MAX_FILES})
                <input type="file" multiple className="hidden" onChange={elegirArchivos} />
              </label>
              <button
                type="submit"
                disabled={enviando || (!respuesta.trim() && files.length === 0)}
                className="bg-neutral-900 hover:bg-neutral-800 text-white text-sm font-semibold px-5 py-2 rounded-lg transition-colors disabled:opacity-40 inline-flex items-center gap-2"
              >
                {enviando && <span className="w-3.5 h-3.5 border-2 border-white/50 border-t-transparent rounded-full animate-spin" />}
                Enviar respuesta
              </button>
            </div>
          </form>
        )}
      </div>
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-[#F6F5F1] py-8 lg:py-14 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="bg-white border border-neutral-200/80 rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden">
          {children}
        </div>
        <p className="text-[11px] text-neutral-400 text-center mt-5">Gestionado con Salamandra CRM</p>
      </div>
    </div>
  );
}

function Burbuja({ propio, autor, fecha, children }) {
  return (
    <div className={`flex ${propio ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] ${propio ? "text-right" : "text-left"}`}>
        <div className="text-[11px] text-neutral-400 mb-1 px-1">
          {autor} · {fecha}
        </div>
        <div
          className={`inline-block text-left text-sm leading-relaxed rounded-2xl px-4 py-3 whitespace-pre-wrap break-words ${
            propio
              ? "bg-neutral-900 text-white rounded-br-md"
              : "bg-white border border-neutral-200 text-neutral-800 rounded-bl-md"
          }`}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

function Adjuntos({ lista, tenantSlug, token }) {
  if (!lista || lista.length === 0) return null;
  return (
    <div className="mt-2 space-y-1">
      {lista.map((a) => (
        <a
          key={a.id}
          href={`/api/public/c/${tenantSlug}/soporte/t/${token}/attachments/${a.id}`}
          className="flex items-center gap-2 text-xs underline underline-offset-2 opacity-80 hover:opacity-100"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-3.5 h-3.5 shrink-0">
            <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
          </svg>
          <span className="truncate">{a.fileName}</span>
        </a>
      ))}
    </div>
  );
}
