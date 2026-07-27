"use client";

import { useEffect, useState } from "react";
import { ORDEN_PRIORIDADES, PRIORIDADES } from "./supportUi.js";

/**
 * Configuración del módulo Soporte (solo admin): portal público, SLA por
 * prioridad, avisos, IA, categorías y plantillas de respuesta.
 */

const CAMPO =
  "w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white outline-none transition-colors focus:border-gray-400";

export default function SupportConfig({ categorias, onCategoriasChange }) {
  const [settings, setSettings] = useState(null);
  const [fallo, setFallo] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState(false);

  const [plantillas, setPlantillas] = useState([]);
  const [nuevaCat, setNuevaCat] = useState({ name: "", color: "#1B3A2D" });
  const [nuevaPl, setNuevaPl] = useState({ name: "", body: "" });
  const [emailNuevo, setEmailNuevo] = useState("");

  useEffect(() => {
    fetch("/api/tickets/settings")
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "No se ha podido cargar la configuración");
        setSettings(j.data);
      })
      .catch((e) => setFallo(e.message));
    fetch("/api/tickets/templates")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setPlantillas(j?.data?.templates || []))
      .catch(() => {});
  }, []);

  async function guardar(cambios) {
    setGuardando(true);
    setFallo(null);
    setGuardado(false);
    try {
      const res = await fetch("/api/tickets/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cambios),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "No se ha podido guardar");
      setSettings(json.data);
      setGuardado(true);
      setTimeout(() => setGuardado(false), 2500);
    } catch (e) {
      setFallo(e.message);
    } finally {
      setGuardando(false);
    }
  }

  async function crearCategoria() {
    if (!nuevaCat.name.trim()) return;
    const res = await fetch("/api/tickets/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(nuevaCat),
    });
    const json = await res.json();
    if (res.ok) {
      onCategoriasChange?.([...categorias, json.data]);
      setNuevaCat({ name: "", color: "#1B3A2D" });
    } else setFallo(json.error || "No se ha podido crear la categoría");
  }

  async function toggleCategoria(cat) {
    const res = await fetch(`/api/tickets/categories/${cat.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !cat.active }),
    });
    const json = await res.json();
    if (res.ok) onCategoriasChange?.(categorias.map((c) => (c.id === cat.id ? json.data : c)));
  }

  async function borrarCategoria(cat) {
    if (!window.confirm(`¿Borrar la categoría "${cat.name}"? Los tickets que la usan quedarán sin categoría.`)) return;
    const res = await fetch(`/api/tickets/categories/${cat.id}`, { method: "DELETE" });
    if (res.ok) onCategoriasChange?.(categorias.filter((c) => c.id !== cat.id));
  }

  async function crearPlantilla() {
    if (!nuevaPl.name.trim() || !nuevaPl.body.trim()) return;
    const res = await fetch("/api/tickets/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(nuevaPl),
    });
    const json = await res.json();
    if (res.ok) {
      setPlantillas([...plantillas, json.data]);
      setNuevaPl({ name: "", body: "" });
    } else setFallo(json.error || "No se ha podido crear la plantilla");
  }

  async function borrarPlantilla(pl) {
    if (!window.confirm(`¿Borrar la plantilla "${pl.name}"?`)) return;
    const res = await fetch(`/api/tickets/templates/${pl.id}`, { method: "DELETE" });
    if (res.ok) setPlantillas(plantillas.filter((p) => p.id !== pl.id));
  }

  if (!settings && !fallo) {
    return (
      <div className="flex items-center gap-3 text-sm text-gray-500 py-16 justify-center">
        <div className="w-4 h-4 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
        Cargando configuración…
      </div>
    );
  }

  const portalUrl =
    settings && typeof window !== "undefined" ? `${window.location.origin}${settings.portalPath}` : "";

  return (
    <div className="px-4 lg:px-8 py-4 space-y-4 max-w-4xl">
      {fallo && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">{fallo}</div>}
      {guardado && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl px-4 py-2.5 text-sm">Guardado.</div>
      )}

      {settings && (
        <>
          {/* Portal público */}
          <Seccion titulo="Portal del cliente" descripcion="La página pública donde tus clientes abren y siguen sus solicitudes.">
            <Toggle
              activo={settings.portalEnabled}
              onChange={(v) => guardar({ portalEnabled: v })}
              etiqueta={settings.portalEnabled ? "Portal activo" : "Portal desactivado"}
            />
            {settings.portalEnabled && (
              <>
                <div className="flex items-center gap-2 mt-3">
                  <input readOnly value={portalUrl} className={`${CAMPO} font-mono text-xs text-gray-500`} onFocus={(e) => e.target.select()} />
                  <button
                    onClick={() => navigator.clipboard?.writeText(portalUrl)}
                    className="shrink-0 text-xs font-medium text-gray-700 border border-gray-200 rounded-lg px-3 py-2 hover:border-gray-300 transition-colors"
                  >
                    Copiar
                  </button>
                </div>
                <p className="text-[11px] text-gray-400 mt-1.5">
                  Enlaza esta URL desde tu web ("Soporte" en el pie, por ejemplo). Cada ticket genera además su enlace privado de seguimiento.
                </p>
                <div className="mt-3">
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Texto de bienvenida del portal</label>
                  <textarea
                    rows={2}
                    maxLength={600}
                    defaultValue={settings.portalIntro || ""}
                    onBlur={(e) => e.target.value !== (settings.portalIntro || "") && guardar({ portalIntro: e.target.value })}
                    className={`${CAMPO} resize-y`}
                    placeholder="Cuéntanos qué necesitas y te responderemos lo antes posible."
                  />
                </div>
              </>
            )}
          </Seccion>

          {/* SLA */}
          <Seccion
            titulo="SLA — tiempos objetivo"
            descripcion="Objetivo de primera respuesta y de resolución según prioridad. Vencidos sin atender, avisan en la campana y en la bandeja."
          >
            <Toggle
              activo={settings.slaEnabled}
              onChange={(v) => guardar({ slaEnabled: v })}
              etiqueta={settings.slaEnabled ? "SLA activo" : "SLA desactivado"}
            />
            {settings.slaEnabled && (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm min-w-[420px]">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wide text-gray-400">
                      <th className="text-left font-medium pb-2">Prioridad</th>
                      <th className="text-left font-medium pb-2">1ª respuesta (horas)</th>
                      <th className="text-left font-medium pb-2">Resolución (horas)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {ORDEN_PRIORIDADES.map((p) => (
                      <tr key={p}>
                        <td className="py-2">
                          <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${PRIORIDADES[p].chip}`}>
                            {PRIORIDADES[p].label}
                          </span>
                        </td>
                        {["firstResponseHours", "resolutionHours"].map((campo) => (
                          <td key={campo} className="py-2 pr-3">
                            <input
                              type="number"
                              min={1}
                              max={2160}
                              defaultValue={settings.slaEffective[p][campo]}
                              onBlur={(e) => {
                                const v = Number(e.target.value);
                                if (!Number.isFinite(v) || v <= 0 || v === settings.slaEffective[p][campo]) return;
                                guardar({ slaConfig: { ...settings.slaConfig, [p]: { ...settings.slaEffective[p], [campo]: v } } });
                              }}
                              className="w-24 text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-gray-400"
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Seccion>

          {/* Avisos */}
          <Seccion titulo="Avisos de tickets nuevos" descripcion="Emails internos que reciben aviso cuando entra un ticket por el portal.">
            <div className="flex items-center gap-2 flex-wrap">
              {settings.notifyEmails.map((e) => (
                <span key={e} className="inline-flex items-center gap-1.5 text-xs bg-gray-50 border border-gray-200 rounded-full px-2.5 py-1 text-gray-700">
                  {e}
                  <button
                    onClick={() => guardar({ notifyEmails: settings.notifyEmails.filter((x) => x !== e) })}
                    className="text-gray-400 hover:text-red-500"
                    aria-label={`Quitar ${e}`}
                  >
                    ✕
                  </button>
                </span>
              ))}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!emailNuevo.trim()) return;
                  guardar({ notifyEmails: [...settings.notifyEmails, emailNuevo.trim()] });
                  setEmailNuevo("");
                }}
                className="flex items-center gap-2"
              >
                <input
                  type="email"
                  value={emailNuevo}
                  onChange={(e) => setEmailNuevo(e.target.value)}
                  placeholder="email@empresa.com"
                  className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 outline-none focus:border-gray-400 w-48"
                />
                <button type="submit" className="text-xs font-medium text-gray-700 border border-gray-200 rounded-lg px-2.5 py-1.5 hover:border-gray-300">
                  Añadir
                </button>
              </form>
            </div>
          </Seccion>

          {/* IA */}
          <Seccion
            titulo="Clasificación automática (IA)"
            descripcion="Al entrar un ticket por el portal, la IA le pone prioridad y categoría. Usa la clave de IA de Configuración → IA (con su coste por uso)."
          >
            <Toggle
              activo={settings.autoClassify}
              onChange={(v) => guardar({ autoClassify: v })}
              etiqueta={settings.autoClassify ? "Activada" : "Desactivada"}
            />
          </Seccion>

          {/* Categorías */}
          <Seccion titulo="Categorías" descripcion="Los temas con los que organizas la bandeja (facturación, técnico, pedidos…).">
            <div className="space-y-2">
              {categorias.map((c) => (
                <div key={c.id} className="flex items-center gap-3 text-sm">
                  <span className="w-3 h-3 rounded-full border border-gray-200 shrink-0" style={{ backgroundColor: c.color || "#e5e7eb" }} />
                  <span className={`flex-1 truncate ${c.active ? "text-gray-800" : "text-gray-400 line-through"}`}>{c.name}</span>
                  <button onClick={() => toggleCategoria(c)} className="text-xs text-gray-500 hover:text-gray-800">
                    {c.active ? "Desactivar" : "Activar"}
                  </button>
                  <button onClick={() => borrarCategoria(c)} className="text-xs text-rose-500 hover:text-rose-700">
                    Borrar
                  </button>
                </div>
              ))}
              {categorias.length === 0 && <p className="text-sm text-gray-400">Aún no hay categorías.</p>}
            </div>
            <div className="flex items-center gap-2 mt-3">
              <input
                type="color"
                value={nuevaCat.color}
                onChange={(e) => setNuevaCat({ ...nuevaCat, color: e.target.value })}
                className="w-9 h-9 rounded-lg border border-gray-200 p-1 bg-white cursor-pointer shrink-0"
                aria-label="Color de la categoría"
              />
              <input
                type="text"
                maxLength={80}
                value={nuevaCat.name}
                onChange={(e) => setNuevaCat({ ...nuevaCat, name: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && crearCategoria()}
                placeholder="Nueva categoría…"
                className={CAMPO}
              />
              <button onClick={crearCategoria} className="shrink-0 text-sm font-medium text-gray-700 border border-gray-200 rounded-lg px-3.5 py-2 hover:border-gray-300 transition-colors">
                Añadir
              </button>
            </div>
          </Seccion>

          {/* Plantillas */}
          <Seccion titulo="Plantillas de respuesta" descripcion="Textos preparados para las preguntas repetidas. Se insertan desde el ticket y se retocan antes de enviar.">
            <div className="space-y-2">
              {plantillas.map((p) => (
                <details key={p.id} className="group border border-gray-200 rounded-lg">
                  <summary className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer select-none">
                    <span className="flex-1 truncate text-gray-800 font-medium">{p.name}</span>
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        borrarPlantilla(p);
                      }}
                      className="text-xs text-rose-500 hover:text-rose-700"
                    >
                      Borrar
                    </button>
                  </summary>
                  <p className="px-3 pb-3 text-xs text-gray-500 whitespace-pre-wrap">{p.body}</p>
                </details>
              ))}
              {plantillas.length === 0 && <p className="text-sm text-gray-400">Aún no hay plantillas.</p>}
            </div>
            <div className="space-y-2 mt-3">
              <input
                type="text"
                maxLength={120}
                value={nuevaPl.name}
                onChange={(e) => setNuevaPl({ ...nuevaPl, name: e.target.value })}
                placeholder="Nombre (p. ej. «Pedimos captura de pantalla»)"
                className={CAMPO}
              />
              <textarea
                rows={3}
                value={nuevaPl.body}
                onChange={(e) => setNuevaPl({ ...nuevaPl, body: e.target.value })}
                placeholder="Texto de la plantilla…"
                className={`${CAMPO} resize-y`}
              />
              <button onClick={crearPlantilla} className="text-sm font-medium text-gray-700 border border-gray-200 rounded-lg px-3.5 py-2 hover:border-gray-300 transition-colors">
                Añadir plantilla
              </button>
            </div>
          </Seccion>

          {guardando && <p className="text-xs text-gray-400">Guardando…</p>}
        </>
      )}
    </div>
  );
}

function Seccion({ titulo, descripcion, children }) {
  return (
    <section className="bg-white border border-gray-200 rounded-2xl p-4 lg:p-5">
      <h3 className="text-sm font-semibold text-gray-800">{titulo}</h3>
      {descripcion && <p className="text-xs text-gray-500 mt-0.5 mb-3 max-w-xl leading-relaxed">{descripcion}</p>}
      {children}
    </section>
  );
}

function Toggle({ activo, onChange, etiqueta }) {
  return (
    <button
      onClick={() => onChange(!activo)}
      className="inline-flex items-center gap-2.5 text-sm text-gray-700"
      role="switch"
      aria-checked={activo}
    >
      <span className={`relative w-9 h-5 rounded-full transition-colors ${activo ? "bg-[var(--color-primary)]" : "bg-gray-200"}`}>
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${activo ? "left-[18px]" : "left-0.5"}`} />
      </span>
      {etiqueta}
    </button>
  );
}
