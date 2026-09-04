"use client";

/**
 * Salamandrobot — el ayudante del CRM. Pregunta cosas del CRM (buscar, ayuda,
 * orientación). Habla con /api/assistant, que responde con IA (Claude BYOK), en
 * modo SIMULADO (demo) o sin IA (base de conocimiento + búsqueda). Funciona con
 * o sin IA.
 *
 * ── YA NO FLOTA (04/09/2026) ───────────────────────────────────────────────
 * Rodrigo: «se ubican a veces delante de botones, así que los ponemos debajo
 * del nombre de usuario junto a los iconitos de ayuda, la llave inglesa, la
 * configuración y salir». Su botón vive ahora en el pie del menú, y el chat se
 * manda a `document.body` con un portal para poder anclarlo a la pantalla —una
 * ventana de 22 rem no cabe en una columna de 220 px—. El porqué largo, en
 * `NotificationBell.jsx`, que se movió en el mismo commit.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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

export default function Salamandrobot({ alAbrir }) {
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

  /** Abrir desde el cajón del móvil lo cierra: ver `alAbrir` en la campana. */
  function alternar() {
    const siguiente = !open;
    setOpen(siguiente);
    if (siguiente) alAbrir?.();
  }

  return (
    <>
      {/* El botón, con la pinta de sus hermanos del pie del menú. La salamandra
          es una imagen, así que se apaga con opacidad y no con `text-white/30`. */}
      <button
        onClick={alternar}
        className="group p-1 rounded transition-colors cursor-pointer hover:bg-white/[0.06]"
        aria-label={open ? "Cerrar Salamandrobot" : "Abrir Salamandrobot"}
        aria-expanded={open}
        title="Salamandrobot — tu ayudante del CRM"
      >
        <SalamanderIcon
          className={`w-4 h-4 transition-opacity ${open ? "opacity-100" : "opacity-40 group-hover:opacity-90"}`}
        />
      </button>

      {/* El chat, anclado a la pantalla: en escritorio al lado del menú (220 px
          + 12 de aire) y en móvil a lo ancho menos los márgenes. */}
      {open &&
        createPortal(
          <div className="crm-flotante fixed z-30 bottom-3 left-3 right-3 sm:right-auto sm:w-[22rem] lg:left-[232px] h-[min(70vh,32rem)] bg-white rounded-2xl shadow-2xl border border-neutral-200 flex flex-col overflow-hidden print:hidden">
            {/* Cabecera */}
            <div className="flex items-center gap-2.5 px-3.5 py-2.5 text-white shrink-0" style={{ backgroundColor: "var(--color-primary, #1B3A2D)" }}>
              <span className="w-8 h-8 rounded-full bg-white/15 flex items-center justify-center shrink-0">
                <SalamanderIcon className="w-5 h-5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold leading-tight">Salamandrobot</div>
                <div className="text-[10px] text-white/70 leading-tight">Tu ayudante del CRM</div>
              </div>
              <button onClick={() => setOpen(false)} className="text-white/70 hover:text-white p-1 -m-1 cursor-pointer" aria-label="Cerrar">✕</button>
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
                className="shrink-0 w-9 h-9 rounded-xl text-white flex items-center justify-center disabled:opacity-40 cursor-pointer"
                style={{ backgroundColor: "var(--color-primary, #1B3A2D)" }}
                aria-label="Enviar"
              >
                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" /></svg>
              </button>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
