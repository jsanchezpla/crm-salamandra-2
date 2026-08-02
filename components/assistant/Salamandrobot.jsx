"use client";

/**
 * Salamandrobot — asistente flotante del CRM, abajo a la derecha en todas las
 * páginas del dashboard. Pregunta cosas del CRM (buscar, ayuda, orientación).
 * Habla con /api/assistant, que responde con IA (Claude BYOK), en modo SIMULADO
 * (demo) o sin IA (base de conocimiento + búsqueda). Funciona con o sin IA.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

/** Logo del bot: la salamandra de Salamandra Solutions en blanco (imagen de marca original). */
function SalamanderIcon({ className = "w-6 h-6" }) {
  return <Image src="/salamandrobot-blanco.png" alt="" width={64} height={64} className={className} aria-hidden="true" />;
}

const GREETING = {
  role: "assistant",
  content: "🦎 ¡Hola! Soy Salamandrobot. Pregúntame lo que necesites del CRM: buscar un cliente, cómo hacer una factura, dónde está algo…",
  links: [],
};

export default function Salamandrobot() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([GREETING]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (open && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, open, loading]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    const next = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const payload = next
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role, content: m.content }));
      const r = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: payload }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) throw new Error(j?.error || "No pude responder ahora mismo.");
      setMessages((m) => [...m, { role: "assistant", content: j.data.answer, links: j.data.links || [] }]);
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", content: "Ups, no he podido responder ahora mismo. Inténtalo de nuevo en un momento.", links: [] }]);
    } finally {
      setLoading(false);
    }
  }

  function go(href) {
    setOpen(false);
    router.push(href);
  }

  /**
   * z-30 A PROPÓSITO: los widgets flotantes (Salamandrobot, campana) viven POR
   * DEBAJO de cualquier drawer o modal (convención del CRM: backdrop z-40 +
   * panel z-50).
   *
   * PERO el z-index SOLO NO BASTA, y por eso está además `crm-flotante`:
   * estos botones se anclan abajo a la derecha, exactamente donde los paneles
   * ponen su Guardar/Crear, y lo tapaban — pulsar "Guardar" abría el asistente.
   * Comprobado con `document.elementFromPoint` sobre el centro del botón:
   * devolvía este widget. Se probó bajarlos a z-30 e incluso a z-10 en caliente
   * y SEGUÍAN recibiendo el clic (los paneles se montan dentro de `main` y no
   * compiten en la misma capa).
   *
   * Lo que sí funciona: `crm-flotante` + la regla de globals.css que los OCULTA
   * mientras hay un panel abierto. Afectaba a los 69 paneles del CRM; alguien ya
   * lo había parcheado subiendo su panel a z-[61] (facturacion/presupuestos),
   * apaño que ya no hace falta.
   */
  return (
    <div className="crm-flotante fixed top-16 lg:top-4 right-4 z-30 flex flex-col-reverse items-end gap-3 print:hidden">
      {/* Panel de chat */}
      {open && (
        <div className="w-[min(92vw,22rem)] h-[min(70vh,32rem)] bg-white rounded-2xl shadow-2xl border border-neutral-200 flex flex-col overflow-hidden">
          {/* Cabecera */}
          <div className="flex items-center gap-2.5 px-3.5 py-2.5 text-white shrink-0" style={{ backgroundColor: "var(--color-primary, #1B3A2D)" }}>
            <span className="w-8 h-8 rounded-full bg-white/15 flex items-center justify-center shrink-0">
              <SalamanderIcon className="w-5 h-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold leading-tight">Salamandrobot</div>
              <div className="text-[10px] text-white/70 leading-tight">Tu ayudante del CRM</div>
            </div>
            <button onClick={() => setOpen(false)} className="text-white/70 hover:text-white p-1 -m-1" aria-label="Cerrar">✕</button>
          </div>

          {/* Mensajes */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3 bg-neutral-50/60">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] ${m.role === "user" ? "" : "flex gap-2"}`}>
                  {m.role === "assistant" && (
                    <span className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-white mt-0.5" style={{ backgroundColor: "var(--color-primary, #1B3A2D)" }}>
                      <SalamanderIcon className="w-4 h-4" />
                    </span>
                  )}
                  <div>
                    <div className={`text-[13px] leading-relaxed rounded-2xl px-3 py-2 ${m.role === "user" ? "text-white rounded-br-sm" : "bg-white border border-neutral-200 text-neutral-800 rounded-bl-sm"}`} style={m.role === "user" ? { backgroundColor: "var(--color-primary, #1B3A2D)" } : undefined}>
                      {m.content}
                    </div>
                    {m.links?.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {m.links.map((l, k) => (
                          <button key={k} onClick={() => go(l.href)} className="text-[11px] px-2 py-0.5 rounded-full border border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-100">
                            {l.label} →
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="flex gap-2">
                  <span className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-white" style={{ backgroundColor: "var(--color-primary, #1B3A2D)" }}>
                    <SalamanderIcon className="w-4 h-4" />
                  </span>
                  <div className="bg-white border border-neutral-200 rounded-2xl rounded-bl-sm px-3 py-2 text-[13px] text-neutral-400">escribiendo…</div>
                </div>
              </div>
            )}
          </div>

          {/* Entrada */}
          <div className="p-2.5 border-t border-neutral-100 flex items-end gap-2 shrink-0 bg-white">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              rows={1}
              placeholder="Escribe tu pregunta…"
              className="flex-1 resize-none max-h-24 rounded-xl border border-neutral-200 px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary,#1B3A2D)]/20"
            />
            <button
              onClick={send}
              disabled={loading || !input.trim()}
              className="shrink-0 w-9 h-9 rounded-xl text-white flex items-center justify-center disabled:opacity-40"
              style={{ backgroundColor: "var(--color-primary, #1B3A2D)" }}
              aria-label="Enviar"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" /></svg>
            </button>
          </div>
        </div>
      )}

      {/* Botón flotante */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="group w-14 h-14 rounded-full text-white shadow-lg flex items-center justify-center hover:scale-105 active:scale-95 transition-transform"
        style={{ backgroundColor: "var(--color-primary, #1B3A2D)" }}
        aria-label={open ? "Cerrar Salamandrobot" : "Abrir Salamandrobot"}
        title="Salamandrobot — tu ayudante del CRM"
      >
        {open ? (
          <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 18 18 6M6 6l12 12" /></svg>
        ) : (
          <SalamanderIcon className="w-8 h-8" />
        )}
      </button>
    </div>
  );
}
