"use client";

import { useEffect, useMemo, useState } from "react";
import { anchoPanel } from "@/components/admin/anchoPanel.js";

/**
 * Calendario global — quién ve qué (03/09/2026, Rodrigo).
 *
 * ── LO PRIMERO QUE TIENE QUE DEJAR CLARO ESTA PANTALLA ──────────────────────
 * Que un vínculo son DOS cosas distintas: qué calendario se VE desde
 * calendar.salamandrasolutions.com, y con qué cuenta se ENTRA en ese cliente
 * al pulsar «Abrir en …». La primera es obligatoria; la segunda, opcional, y
 * sin ella el calendario se ve y se mueve pero no se salta. Se pide aparte
 * porque no es lo mismo mirar la agenda de un cliente que abrir sesión en su
 * CRM con una cuenta de allí, y lo segundo tiene que ser una decisión.
 *
 * Misma tabla y misma librería que `scripts/calendario-global-vincular.js`.
 */

function Etiqueta({ children, tono = "tenue" }) {
  const color = tono === "alerta" ? "var(--alerta)" : tono === "ok" ? "var(--ok)" : "var(--tenue)";
  return (
    <span className="text-[10px] uppercase tracking-[0.18em]" style={{ color }}>
      {children}
    </span>
  );
}

const inputCls = "w-full rounded px-2.5 py-1.5 text-[13px] focus:outline-none";
const inputStyle = { background: "var(--panel)", border: "1px solid var(--line)", color: "var(--text)" };

export default function CalendarioGlobalAdminPage() {
  const [datos, setDatos] = useState(null);
  const [fallo, setFallo] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [f, setF] = useState({ cuenta: "", slug: "", usuario: "", color: "" });

  async function cargar() {
    try {
      const res = await fetch("/api/admin/calendario-global", { cache: "no-store" });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error || "No se pudo cargar");
      setDatos(j.data);
      setFallo(null);
    } catch (e) {
      setFallo(e.message);
    }
  }
  useEffect(() => { cargar(); }, []);

  // Las cuentas del cliente elegido, para el desplegable de «entrar como».
  const cuentasDelCliente = useMemo(
    () => (datos?.cuentas ?? []).filter((c) => c.slug === f.slug),
    [datos, f.slug]
  );

  const porCuenta = useMemo(() => {
    const m = new Map();
    for (const v of datos?.vinculos ?? []) {
      if (!m.has(v.cuenta)) m.set(v.cuenta, []);
      m.get(v.cuenta).push(v);
    }
    return [...m.entries()];
  }, [datos]);

  async function guardar(e) {
    e.preventDefault();
    if (!f.cuenta || !f.slug) { setFallo("Hacen falta la cuenta que mira y el cliente"); return; }
    setGuardando(true);
    try {
      const res = await fetch("/api/admin/calendario-global", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cuenta: f.cuenta, slug: f.slug, usuario: f.usuario || null, color: f.color || null }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error || "No se pudo guardar");
      setF((p) => ({ ...p, slug: "", usuario: "", color: "" }));
      await cargar();
    } catch (err) {
      setFallo(err.message);
    } finally {
      setGuardando(false);
    }
  }

  async function quitar(v) {
    if (!window.confirm(`¿Quitar ${v.nombre} del calendario global de ${v.cuenta}?`)) return;
    try {
      const res = await fetch("/api/admin/calendario-global", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cuenta: v.cuenta, slug: v.slug }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error || "No se pudo quitar");
      await cargar();
    } catch (err) {
      setFallo(err.message);
    }
  }

  return (
    <div className={`${anchoPanel} px-6 lg:px-12 py-8 space-y-8`}>
      <header className="space-y-2">
        <h1 className="text-[26px] leading-tight" style={{ fontFamily: "var(--admin-display)" }}>
          Calendario global
        </h1>
        <p className="text-[13px] max-w-2xl leading-relaxed" style={{ color: "var(--dim)" }}>
          Qué calendarios de cliente ve cada cuenta de Salamandra desde{" "}
          <span style={{ color: "var(--text)" }}>calendar.salamandrasolutions.com</span>. Ver y mover un
          calendario no necesita más; para que el botón «Abrir en …» abra sesión en el CRM de ese
          cliente hace falta además una cuenta de allí, que se elige aparte.
        </p>
      </header>

      {fallo && (
        <div className="rounded px-3 py-2 text-[13px]" style={{ background: "#FDF3E7", border: "1px solid var(--alerta)", color: "var(--alerta)" }}>
          {fallo}
        </div>
      )}

      <form onSubmit={guardar} className="rounded-lg p-4 lg:p-5 space-y-4" style={{ background: "var(--panel)", border: "1px solid var(--line)" }}>
        <Etiqueta tono="ok">Vincular un calendario</Etiqueta>
        <div className="grid md:grid-cols-2 gap-3">
          <label className="block">
            <Etiqueta>Cuenta que mira</Etiqueta>
            <input
              list="cuentas-crm"
              value={f.cuenta}
              onChange={(e) => setF((p) => ({ ...p, cuenta: e.target.value }))}
              placeholder="admin@salamandrasolutions.com"
              className={inputCls + " mt-1"}
              style={inputStyle}
            />
            <datalist id="cuentas-crm">
              {(datos?.cuentas ?? []).map((c) => <option key={c.email} value={c.email}>{c.slug}</option>)}
            </datalist>
          </label>
          <label className="block">
            <Etiqueta>Cliente</Etiqueta>
            <select
              value={f.slug}
              onChange={(e) => setF((p) => ({ ...p, slug: e.target.value, usuario: "" }))}
              className={inputCls + " mt-1"}
              style={inputStyle}
            >
              <option value="">— elige —</option>
              {(datos?.clientes ?? []).map((t) => (
                <option key={t.slug} value={t.slug}>
                  {t.nombre} ({t.slug}){t.calendario ? "" : " · sin Calendario"}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <Etiqueta>Entrar en ese cliente como (opcional)</Etiqueta>
            <select
              value={f.usuario}
              onChange={(e) => setF((p) => ({ ...p, usuario: e.target.value }))}
              className={inputCls + " mt-1"}
              style={inputStyle}
              disabled={!f.slug}
            >
              <option value="">— solo ver y mover —</option>
              {cuentasDelCliente.map((c) => <option key={c.email} value={c.email}>{c.email}</option>)}
            </select>
          </label>
          <label className="block">
            <Etiqueta>Color (opcional)</Etiqueta>
            <input
              value={f.color}
              onChange={(e) => setF((p) => ({ ...p, color: e.target.value }))}
              placeholder="#1F3B34 · si no, el de su marca"
              className={inputCls + " mt-1"}
              style={inputStyle}
            />
          </label>
        </div>
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={guardando}
            className="text-[12px] px-4 py-2 rounded text-white disabled:opacity-50"
            style={{ background: "var(--ok)" }}
          >
            {guardando ? "Guardando…" : "Vincular"}
          </button>
        </div>
      </form>

      <section className="space-y-3">
        <Etiqueta>Vínculos ({datos?.vinculos?.length ?? 0})</Etiqueta>
        {!datos && !fallo && <p className="text-[13px]" style={{ color: "var(--tenue)" }}>Cargando…</p>}
        {datos && porCuenta.length === 0 && (
          <p className="text-[13px]" style={{ color: "var(--tenue)" }}>Nadie tiene todavía un calendario vinculado.</p>
        )}
        {porCuenta.map(([cuenta, lista]) => (
          <div key={cuenta} className="rounded-lg overflow-hidden" style={{ background: "var(--panel)", border: "1px solid var(--line)" }}>
            <div className="px-4 py-2.5 text-[13px] font-medium" style={{ borderBottom: "1px solid var(--line-suave)" }}>
              {cuenta}
            </div>
            <ul>
              {lista.map((v) => (
                <li key={v.slug} className="px-4 py-2.5 flex items-center gap-3 text-[13px]" style={{ borderBottom: "1px solid var(--line-suave)" }}>
                  <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: v.color }} />
                  <span className="min-w-0">
                    <span style={{ color: "var(--text)" }}>{v.nombre}</span>
                    <span className="ml-1.5 text-[11px]" style={{ color: "var(--tenue)" }}>{v.slug}</span>
                  </span>
                  {!v.calendario && <span className="text-[11px]" style={{ color: "var(--alerta)" }}>sin módulo Calendario</span>}
                  <span className="ml-auto text-[11px] truncate" style={{ color: "var(--tenue)" }}>
                    {v.tenantUsuarioEmail ? `entra como ${v.tenantUsuarioEmail}` : "solo ver y mover"}
                  </span>
                  <button type="button" onClick={() => quitar(v)} className="text-[11px] uppercase tracking-[0.14em] hover:opacity-70" style={{ color: "var(--alerta)" }}>
                    quitar
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    </div>
  );
}
