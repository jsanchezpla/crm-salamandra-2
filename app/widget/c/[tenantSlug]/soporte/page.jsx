"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { leerRespuestaApi } from "@/lib/utils/respuestaApi.js";

/**
 * Portal público de soporte — abrir una solicitud.
 *
 * Página SIN login: cualquier cliente del tenant llega aquí desde la web o
 * desde un email. Hereda la marca del tenant (color primario) igual que el
 * widget de citas. Tras enviar, muestra el número (TK-0042) y el enlace de
 * seguimiento, que también llega por email.
 */

const MAX_FILES = 3;

// Clase compartida de los campos del formulario (Tailwind, sin styled-jsx:
// en App Router requeriría un StyleRegistry para no parpadear en SSR).
const CAMPO =
  "w-full text-sm border border-neutral-200 rounded-lg px-3 py-2.5 bg-white outline-none transition-colors focus:border-neutral-400";

export default function SoportePortalPage() {
  const params = useParams();
  const tenantSlug = params?.tenantSlug;

  const [config, setConfig] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [noDisponible, setNoDisponible] = useState(false);

  const [form, setForm] = useState({ name: "", email: "", categoryId: "", subject: "", message: "" });
  const [files, setFiles] = useState([]);
  const [enviando, setEnviando] = useState(false);
  const [fallo, setFallo] = useState(null);
  const [exito, setExito] = useState(null); // { ref, followUrl }
  const hpRef = useRef(null);

  useEffect(() => {
    if (!tenantSlug) return;
    let vivo = true;
    (async () => {
      try {
        const res = await fetch(`/api/public/c/${tenantSlug}/soporte`, { cache: "no-store" });
        if (!vivo) return;
        if (!res.ok) {
          setNoDisponible(true);
          return;
        }
        const json = await res.json();
        setConfig(json.data);
      } catch {
        if (vivo) setNoDisponible(true);
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [tenantSlug]);

  const primary = config?.brand?.primaryColor || "#1B3A2D";

  function elegirArchivos(e) {
    const nuevos = Array.from(e.target.files || []);
    setFiles((prev) => [...prev, ...nuevos].slice(0, MAX_FILES));
    e.target.value = "";
  }

  async function enviar(e) {
    e.preventDefault();
    setFallo(null);
    setEnviando(true);
    try {
      let res;
      if (files.length > 0) {
        const fd = new FormData();
        for (const [k, v] of Object.entries(form)) fd.set(k, v);
        fd.set("_hp", hpRef.current?.value || "");
        for (const f of files) fd.append("files", f);
        res = await fetch(`/api/public/c/${tenantSlug}/soporte`, { method: "POST", body: fd });
      } else {
        res = await fetch(`/api/public/c/${tenantSlug}/soporte`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...form, _hp: hpRef.current?.value || "" }),
        });
      }
      const json = await leerRespuestaApi(res);
      if (!res.ok) throw new Error(json.error || "No se ha podido enviar. Inténtalo de nuevo.");
      setExito(json.data || json);
    } catch (err) {
      setFallo(err.message);
    } finally {
      setEnviando(false);
    }
  }

  if (cargando) {
    return (
      <Shell primary={primary}>
        <div className="flex items-center justify-center gap-3 py-24 text-sm text-neutral-500">
          <span className="w-4 h-4 border-2 border-neutral-300 border-t-transparent rounded-full animate-spin" />
          Cargando…
        </div>
      </Shell>
    );
  }

  if (noDisponible) {
    return (
      <Shell primary={primary}>
        <div className="text-center py-24 px-6">
          <h1 className="text-xl font-semibold text-neutral-800 mb-2">Portal no disponible</h1>
          <p className="text-sm text-neutral-500">Este canal de soporte no está activo ahora mismo.</p>
        </div>
      </Shell>
    );
  }

  if (exito) {
    return (
      <Shell primary={primary} tenantName={config?.tenantName}>
        <div className="px-6 lg:px-10 py-12 text-center">
          <div
            className="w-12 h-12 mx-auto rounded-full grid place-items-center text-white mb-5"
            style={{ backgroundColor: primary }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-6 h-6">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-neutral-400 mb-2">Solicitud registrada</p>
          <h1 className="text-3xl font-semibold text-neutral-900 tracking-tight mb-3">{exito.ref}</h1>
          <p className="text-sm text-neutral-600 max-w-md mx-auto leading-relaxed">
            Guarda este número. Te hemos enviado un email con el enlace para seguir tu solicitud y responder.
          </p>
          {exito.followUrl && (
            <a
              href={exito.followUrl}
              className="inline-block mt-6 text-sm font-semibold text-white px-5 py-2.5 rounded-lg transition-opacity hover:opacity-90"
              style={{ backgroundColor: primary }}
            >
              Ver mi solicitud
            </a>
          )}
        </div>
      </Shell>
    );
  }

  return (
    <Shell primary={primary} tenantName={config?.tenantName}>
      <div className="px-6 lg:px-10 pt-8 pb-4">
        <p className="text-[11px] uppercase tracking-[0.18em] text-neutral-400 mb-1.5">Soporte</p>
        <h1 className="text-2xl font-semibold text-neutral-900 tracking-tight">¿En qué te ayudamos?</h1>
        <p className="text-sm text-neutral-500 mt-2 leading-relaxed">
          {config?.intro || "Cuéntanos qué necesitas y te responderemos por email lo antes posible."}
        </p>
      </div>

      <form onSubmit={enviar} className="px-6 lg:px-10 pb-10 space-y-4">
        {/* Honeypot invisible para bots */}
        <input ref={hpRef} type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Campo etiqueta="Tu nombre">
            <input
              type="text"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className={CAMPO}
              placeholder="Nombre y apellidos"
            />
          </Campo>
          <Campo etiqueta="Tu email">
            <input
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className={CAMPO}
              placeholder="tu@email.com"
            />
          </Campo>
        </div>

        {config?.categories?.length > 0 && (
          <Campo etiqueta="Tema">
            <select
              value={form.categoryId}
              onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
              className={CAMPO}
            >
              <option value="">Elige un tema (opcional)</option>
              {config.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Campo>
        )}

        <Campo etiqueta="Asunto">
          <input
            type="text"
            required
            maxLength={255}
            value={form.subject}
            onChange={(e) => setForm({ ...form, subject: e.target.value })}
            className={CAMPO}
            placeholder="Resume en una línea qué necesitas"
          />
        </Campo>

        <Campo etiqueta="Cuéntanos más">
          <textarea
            required
            rows={5}
            maxLength={8000}
            value={form.message}
            onChange={(e) => setForm({ ...form, message: e.target.value })}
            className={`${CAMPO} resize-y`}
            placeholder="Qué pasaba, desde cuándo, y cualquier detalle que nos ayude"
          />
        </Campo>

        {/* Adjuntos */}
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <label className="inline-flex items-center gap-2 text-sm text-neutral-600 border border-neutral-200 rounded-lg px-3 py-2 cursor-pointer hover:border-neutral-300 transition-colors">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4">
                <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
              </svg>
              Adjuntar archivo
              <input type="file" multiple className="hidden" onChange={elegirArchivos} />
            </label>
            <span className="text-xs text-neutral-400">Hasta {MAX_FILES} archivos · 10 MB cada uno</span>
          </div>
          {files.length > 0 && (
            <ul className="mt-2 space-y-1">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center gap-2 text-xs text-neutral-600 bg-neutral-50 border border-neutral-200 rounded-md px-2.5 py-1.5">
                  <span className="truncate flex-1">{f.name}</span>
                  <span className="text-neutral-400 shrink-0">{Math.ceil(f.size / 1024)} KB</span>
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
        </div>

        {fallo && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{fallo}</div>
        )}

        <button
          type="submit"
          disabled={enviando}
          className="w-full sm:w-auto text-sm font-semibold text-white px-6 py-2.5 rounded-lg transition-opacity hover:opacity-90 disabled:opacity-50 inline-flex items-center justify-center gap-2"
          style={{ backgroundColor: primary }}
        >
          {enviando && <span className="w-3.5 h-3.5 border-2 border-white/50 border-t-transparent rounded-full animate-spin" />}
          Enviar solicitud
        </button>
      </form>

    </Shell>
  );
}

function Shell({ children, primary, tenantName }) {
  return (
    <div className="min-h-screen bg-[#F6F5F1] py-8 lg:py-14 px-4">
      <div className="max-w-xl mx-auto">
        {tenantName && (
          <div className="flex items-center gap-2.5 mb-5 px-1">
            <span className="w-7 h-7 rounded-md grid place-items-center text-white text-sm font-semibold" style={{ backgroundColor: primary }}>
              {tenantName.slice(0, 1).toUpperCase()}
            </span>
            <span className="text-sm font-medium text-neutral-700">{tenantName}</span>
          </div>
        )}
        <div className="bg-white border border-neutral-200/80 rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden">
          <div className="h-1" style={{ backgroundColor: primary }} />
          {children}
        </div>
        <p className="text-[11px] text-neutral-400 text-center mt-5">Gestionado con Salamandra CRM</p>
      </div>
    </div>
  );
}

function Campo({ etiqueta, children }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-neutral-600 mb-1.5">{etiqueta}</span>
      {children}
    </label>
  );
}
