"use client";

// modules/config/tarjetas/Empresa.jsx — pestaña «Empresa» de Configuración:
// la descripción de la empresa y sus líneas de negocio (las lee Outreach para
// el scoring). La sección fiscal vive en el propio ConfigModule porque edita
// el estado `billing` del componente principal.

// ── Descripción de empresa: descripción general + líneas de negocio ──────────
// Reutiliza los datos del módulo Outreach (OutreachSettings.companyContext y
// OutreachBusinessLine). Es lo que Captación usa para analizar sin volver a
// pedir las líneas: la descripción encabeza el prompt y cada línea se puntúa.
// Solo se muestra si el tenant tiene el módulo Outreach (GET responde 403 si no).

import { useEffect, useState } from "react";
import Link from "next/link";
import { Field, PrimaryButton, Section, inputCls } from "./ui.jsx";
export function CompanyDescriptionSection({ isAdmin, flash, onError }) {
  const [available, setAvailable] = useState(null); // null = cargando, false = oculto, true = mostrar
  const [companyContext, setCompanyContext] = useState("");
  const [ctxDirty, setCtxDirty] = useState(false);
  const [lines, setLines] = useState([]);
  const [linesLoaded, setLinesLoaded] = useState(false); // ¿resolvió el GET de líneas?
  const [linesError, setLinesError] = useState(null); // fallo al cargar las líneas
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/outreach/settings", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((j) => {
        if (!alive) return;
        setCompanyContext(j.data?.settings?.companyContext ?? "");
        setAvailable(true);
      })
      .catch(() => alive && setAvailable(false));
    // Si este GET falla no debe verse como "no hay líneas" (falso vacío): se
    // distingue cargando / error / vacío real. Además, sin la lista real no se
    // ofrece "Añadir" (el slug se deduplica contra la lista y podría colisionar).
    fetch("/api/outreach/business-lines?all=true", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("No se pudieron cargar las líneas de negocio"))))
      .then((j) => {
        if (!alive) return;
        if (j?.ok) setLines(j.data?.items ?? []);
        else throw new Error("No se pudieron cargar las líneas de negocio");
      })
      .catch((e) => alive && setLinesError(e.message))
      .finally(() => alive && setLinesLoaded(true));
    return () => {
      alive = false;
    };
  }, []);

  async function saveContext() {
    try {
      const r = await fetch("/api/outreach/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyContext: companyContext.trim() || null }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Error guardando");
      setCtxDirty(false);
      flash("Descripción de empresa guardada");
    } catch (e) {
      onError(e.message);
    }
  }

  // La clave es un id estable e inmutable (los análisis la referencian). Se
  // deriva del título para que el usuario no tenga que inventarla.
  function slugify(name) {
    let base = name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "") // quita diacríticos (á → a)
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/_+/g, "_");
    if (!base) base = "linea";
    // `key` es STRING(64) con regex [a-z0-9_]. Recorta (y limpia el _ final) para
    // que un título largo no desborde la columna; deja hueco al sufijo _NN.
    base = base.slice(0, 56).replace(/_+$/, "") || "linea";
    const taken = new Set(lines.map((l) => l.key));
    let key = base;
    let n = 2;
    while (taken.has(key)) key = `${base}_${n++}`;
    return key;
  }

  async function addLine({ name, description }) {
    try {
      const r = await fetch("/api/outreach/business-lines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: slugify(name),
          name: name.trim(),
          description: description.trim() || null,
          sortOrder: lines.length,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Error creando la línea");
      setLines((ls) => [...ls, j.data]);
      setShowAdd(false);
      flash("Línea de negocio creada");
      return true;
    } catch (e) {
      onError(e.message);
      return false;
    }
  }

  async function saveLine(id, patch) {
    try {
      const r = await fetch(`/api/outreach/business-lines/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Error guardando la línea");
      setLines((ls) => ls.map((l) => (l.id === id ? j.data : l)));
      flash("Línea guardada");
      return true;
    } catch (e) {
      onError(e.message);
      return false;
    }
  }

  if (available !== true) return null;

  return (
    <Section
      title="Descripción de empresa"
      right={
        <Link
          href="/outreach/configuracion"
          className="text-[11px] font-semibold text-neutral-400 uppercase tracking-widest hover:text-neutral-700 transition-colors"
        >
          Config. avanzada →
        </Link>
      }
    >
      <p className="text-xs text-neutral-500 -mt-1 mb-4">
        La captación usa esto para analizar empresas automáticamente: la descripción general encabeza el análisis y
        cada línea de negocio es un servicio contra el que se puntúa a cada lead.
      </p>

      {/* Descripción general */}
      <Field label="Descripción general de la empresa" full>
        <textarea
          disabled={!isAdmin}
          rows={4}
          value={companyContext}
          onChange={(e) => {
            setCompanyContext(e.target.value);
            setCtxDirty(true);
          }}
          placeholder="A qué se dedica la empresa, a quién vende y qué la diferencia. La IA lo lee para analizar cada lead."
          className={inputCls}
        />
      </Field>
      {isAdmin && ctxDirty && (
        <div className="flex justify-end mt-2">
          <PrimaryButton onClick={saveContext}>Guardar descripción</PrimaryButton>
        </div>
      )}

      {/* Líneas de negocio */}
      <div className="mt-6">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[11px] font-semibold text-neutral-400 uppercase tracking-widest">Líneas de negocio</h3>
          {isAdmin && !showAdd && !linesError && linesLoaded && (
            <button
              onClick={() => setShowAdd(true)}
              className="text-[11px] font-semibold text-neutral-500 hover:text-neutral-800 transition-colors"
            >
              + Añadir línea
            </button>
          )}
        </div>

        {linesError ? (
          <p className="text-xs text-rose-600 py-3">{linesError}</p>
        ) : !linesLoaded ? (
          <p className="text-xs text-neutral-400 py-3">Cargando líneas…</p>
        ) : lines.length === 0 && !showAdd ? (
          <p className="text-xs text-neutral-400 py-3">Aún no hay líneas de negocio. Añade la primera.</p>
        ) : null}

        <div className="space-y-2">
          {lines.map((line) => (
            <BusinessLineRow key={line.id} line={line} isAdmin={isAdmin} onSave={saveLine} />
          ))}
        </div>

        {showAdd && <AddBusinessLine onAdd={addLine} onCancel={() => setShowAdd(false)} />}
      </div>
    </Section>
  );
}

// Fila plegable de línea de negocio: cabecera con título + estado; al abrir,
// edición de título, descripción y activa.
export function BusinessLineRow({ line, isAdmin, onSave }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(line.name ?? "");
  const [description, setDescription] = useState(line.description ?? "");
  const [active, setActive] = useState(line.active !== false);
  const [busy, setBusy] = useState(false);

  const dirty = name !== (line.name ?? "") || description !== (line.description ?? "") || active !== (line.active !== false);

  async function handleSave() {
    if (!name.trim()) return;
    setBusy(true);
    // Enviar y adoptar los valores normalizados (trim) que persiste el server,
    // para que el botón Guardar no quede "sucio" tras un guardado correcto.
    const nextName = name.trim();
    const nextDescription = description.trim() || null;
    const okDone = await onSave(line.id, { name: nextName, description: nextDescription, active });
    if (okDone) {
      setName(nextName);
      setDescription(nextDescription ?? "");
    }
    setBusy(false);
  }

  return (
    <div className="border border-neutral-200 rounded-lg bg-white overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-neutral-50 transition-colors"
      >
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${line.active !== false ? "bg-emerald-500" : "bg-neutral-300"}`} />
        <span className="text-sm text-neutral-700 font-medium truncate flex-1">{line.name}</span>
        {line.active === false && <span className="text-[10px] text-neutral-400 uppercase tracking-wide">inactiva</span>}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={`w-4 h-4 text-neutral-400 transition-transform ${open ? "rotate-180" : ""}`}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="px-3 pb-3 pt-1 border-t border-neutral-100 space-y-3">
          <Field label="Título" full>
            <input disabled={!isAdmin} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Descripción (qué vende esta línea)" full>
            <textarea disabled={!isAdmin} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} className={inputCls} placeholder="La IA lo lee literalmente para puntuar a cada lead." />
          </Field>
          {isAdmin && (
            <div className="flex items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-xs text-neutral-600 select-none cursor-pointer">
                <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="accent-[var(--color-primary,#1B3A2D)]" />
                Línea activa (se puntúa y aparece en las fichas)
              </label>
              <button
                onClick={handleSave}
                disabled={busy || !dirty || !name.trim()}
                className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-white disabled:opacity-40"
                style={{ background: "var(--color-primary, #1B3A2D)" }}
              >
                {busy ? "..." : "Guardar"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Formulario inline para crear una línea de negocio nueva.
export function AddBusinessLine({ onAdd, onCancel }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleAdd() {
    if (!name.trim()) return;
    setBusy(true);
    const done = await onAdd({ name, description });
    setBusy(false);
    if (done) {
      setName("");
      setDescription("");
    }
  }

  return (
    <div className="mt-2 border border-dashed border-neutral-300 rounded-lg bg-neutral-50 p-3 space-y-3">
      <Field label="Título" full>
        <input autoFocus maxLength={120} value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="Ej. Diseño web" />
      </Field>
      <Field label="Descripción (qué vende esta línea)" full>
        <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} className={inputCls} placeholder="La IA lo lee literalmente para puntuar a cada lead." />
      </Field>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="px-3 py-2 rounded-lg text-xs font-semibold text-neutral-500 border border-neutral-200 hover:bg-white">
          Cancelar
        </button>
        <button
          onClick={handleAdd}
          disabled={busy || !name.trim()}
          className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide text-white disabled:opacity-40"
          style={{ background: "var(--color-primary, #1B3A2D)" }}
        >
          {busy ? "..." : "Crear línea"}
        </button>
      </div>
    </div>
  );
}
