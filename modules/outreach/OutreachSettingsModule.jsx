"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Select from "../../components/ui/Select.jsx";

const inputCls =
  "w-full rounded-lg px-3 py-2 text-sm text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition placeholder-neutral-300";

const MODEL_LABELS = {
  "claude-opus-4-8": "Claude Opus — el más capaz, el más caro",
  "claude-sonnet-5": "Claude Sonnet — equilibrio entre calidad y coste",
  "claude-haiku-4-5-20251001": "Claude Haiku — el más barato y rápido",
};

/** Una lista de señales se edita como texto, una por línea. Es lo más rápido. */
const toLines = (arr) => (arr ?? []).join("\n");
const fromLines = (s) => s.split("\n").map((x) => x.trim()).filter(Boolean);

const EMPTY_LINE = { key: "", name: "", description: "", scoringUp: "", scoringDown: "" };

function BusinessLineCard({ line, onSaved, onError }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    name: line.name,
    description: line.description ?? "",
    scoringUp: toLines(line.scoringUp),
    scoringDown: toLines(line.scoringDown),
    active: line.active,
  });
  const [saving, setSaving] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const r = await fetch(`/api/outreach/business-lines/${line.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          description: form.description || null,
          scoringUp: fromLines(form.scoringUp),
          scoringDown: fromLines(form.scoringDown),
          active: form.active,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Error guardando");
      setEditing(false);
      onSaved();
    } catch (e) {
      onError(e.message);
    } finally {
      setSaving(false);
    }
  };

  // Borrado duro (el DELETE arrastra por CASCADE los análisis de la línea).
  // La alternativa blanda ya existe: desmarcar "Línea activa" conserva el histórico.
  const doDelete = async () => {
    setDeleting(true);
    try {
      const r = await fetch(`/api/outreach/business-lines/${line.id}`, { method: "DELETE" });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.error || "Error eliminando la línea");
      }
      // 204 sin body: no hacer r.json().
      setShowDelete(false);
      setEditing(false);
      onSaved();
    } catch (e) {
      onError(e.message);
      setShowDelete(false);
    } finally {
      setDeleting(false);
    }
  };

  if (!editing) {
    return (
      <div className="bg-white rounded-xl border border-neutral-200 p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-[Fraunces] text-xl text-neutral-800">{line.name}</h3>
              <code className="text-[11px] px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-500">{line.key}</code>
              {!line.active && (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-500">inactiva</span>
              )}
            </div>
            {line.description && (
              <p className="text-sm text-neutral-600 mt-2 leading-relaxed">{line.description}</p>
            )}
          </div>
          <button
            onClick={() => setEditing(true)}
            className="shrink-0 px-3 py-1.5 rounded-lg border border-neutral-200 text-sm text-neutral-600 hover:bg-neutral-50"
          >
            Editar
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mt-5">
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-emerald-700 mb-2">
              Suben el score ({line.scoringUp?.length ?? 0})
            </h4>
            <ul className="space-y-1">
              {(line.scoringUp ?? []).map((s, i) => (
                <li key={i} className="text-sm text-neutral-600 flex gap-2">
                  <span className="text-emerald-600">+</span>
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">
              Bajan el score ({line.scoringDown?.length ?? 0})
            </h4>
            <ul className="space-y-1">
              {(line.scoringDown ?? []).map((s, i) => (
                <li key={i} className="text-sm text-neutral-600 flex gap-2">
                  <span className="text-zinc-400">−</span>
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border-2 p-5" style={{ borderColor: "var(--color-primary)" }}>
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-neutral-600 mb-1">Nombre</label>
          <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div>
          <label className="block text-xs font-medium text-neutral-600 mb-1">
            Qué vende esta línea <span className="text-neutral-400">(la IA lo lee para puntuar)</span>
          </label>
          <textarea
            className={inputCls}
            rows={3}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-neutral-600 mb-1">
              Señales que <span className="text-emerald-700">suben</span> el score{" "}
              <span className="text-neutral-400">(una por línea)</span>
            </label>
            <textarea
              className={`${inputCls} font-mono text-xs`}
              rows={8}
              value={form.scoringUp}
              onChange={(e) => setForm({ ...form, scoringUp: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-600 mb-1">
              Señales que <span className="text-zinc-600">bajan</span> el score{" "}
              <span className="text-neutral-400">(una por línea)</span>
            </label>
            <textarea
              className={`${inputCls} font-mono text-xs`}
              rows={8}
              value={form.scoringDown}
              onChange={(e) => setForm({ ...form, scoringDown: e.target.value })}
            />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-neutral-600">
          <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
          Línea activa (se puntúa y aparece en las fichas)
        </label>
        <div className="flex gap-2 pt-1">
          <button
            onClick={save}
            disabled={saving || deleting}
            className="px-4 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-50 hover:opacity-90 transition"
            style={{ backgroundColor: "var(--color-primary)" }}
          >
            {saving ? "Guardando..." : "Guardar"}
          </button>
          <button
            onClick={() => setShowDelete(true)}
            disabled={saving || deleting}
            className="px-4 py-2 rounded-lg text-white text-sm font-medium bg-red-600 hover:bg-red-700 disabled:opacity-50"
          >
            Eliminar
          </button>
          <button
            onClick={() => setEditing(false)}
            className="px-4 py-2 rounded-lg border border-neutral-200 text-sm text-neutral-600 hover:bg-neutral-50"
          >
            Cancelar
          </button>
        </div>
      </div>

      {/* Confirmación de borrado (mismo patrón que OutreachLeadDetail) */}
      {showDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !deleting && setShowDelete(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-[Fraunces] text-xl text-neutral-800">Eliminar «{line.name}»</h3>
            <p className="text-sm text-neutral-600 mt-2">
              Esta acción no se puede deshacer: se borrarán también <strong>todos los análisis</strong> hechos
              con esta línea (puntuaciones, pitches, borradores de email). Si solo quieres dejar de usarla,
              desmarca «Línea activa» y guarda — así conservas el histórico.
            </p>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setShowDelete(false)} disabled={deleting} className="px-4 py-2 rounded-lg border border-neutral-200 text-sm text-neutral-600 hover:bg-neutral-50 disabled:opacity-50">
                Cancelar
              </button>
              <button onClick={doDelete} disabled={deleting} className="px-4 py-2 rounded-lg text-white text-sm font-medium bg-red-600 hover:bg-red-700 disabled:opacity-50">
                {deleting ? "Eliminando..." : "Eliminar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function OutreachSettingsModule() {
  const [lines, setLines] = useState([]);
  const [settings, setSettings] = useState(null);
  const [allowedModels, setAllowedModels] = useState([]);
  const [errorMsg, setErrorMsg] = useState(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newLine, setNewLine] = useState(EMPTY_LINE);

  const load = useCallback(async () => {
    setErrorMsg(null);
    try {
      const [lr, sr] = await Promise.all([
        fetch("/api/outreach/business-lines?all=true").then((r) => r.json()),
        fetch("/api/outreach/settings").then((r) => r.json()),
      ]);
      setLines(lr?.data?.items ?? []);
      setSettings(sr?.data?.settings ?? null);
      setAllowedModels(sr?.data?.allowedModels ?? []);
    } catch (e) {
      setErrorMsg(e.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const saveSettings = async (patch) => {
    setSavingSettings(true);
    setErrorMsg(null);
    try {
      const r = await fetch("/api/outreach/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Error guardando ajustes");
      setSettings(j.data.settings);
    } catch (e) {
      setErrorMsg(e.message);
    } finally {
      setSavingSettings(false);
    }
  };

  const createLine = async (e) => {
    e.preventDefault();
    setErrorMsg(null);
    try {
      const r = await fetch("/api/outreach/business-lines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: newLine.key,
          name: newLine.name,
          description: newLine.description || null,
          scoringUp: fromLines(newLine.scoringUp),
          scoringDown: fromLines(newLine.scoringDown),
          sortOrder: lines.length,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Error creando la línea");
      setNewLine(EMPTY_LINE);
      setShowCreate(false);
      load();
    } catch (e) {
      setErrorMsg(e.message);
    }
  };

  return (
    <div className="p-4 lg:p-8 max-w-[1100px] mx-auto">
      <Link href="/outreach" className="text-sm text-neutral-500 hover:text-neutral-800">
        ← Volver a Captación
      </Link>

      <header className="mt-3 mb-6">
        <h1 className="font-[Fraunces] text-3xl lg:text-4xl text-neutral-800">Configuración de Captación</h1>
        <p className="text-sm text-neutral-500 mt-1">
          Define contra qué se puntúa cada empresa captada y con qué modelo se analiza.
        </p>
      </header>

      {errorMsg && (
        <div className="mb-4 px-3 py-2 rounded-lg bg-rose-50 border border-rose-100 text-sm text-rose-700">
          {errorMsg}
        </div>
      )}

      {/* ── Líneas de negocio ─────────────────────────────────────────────── */}
      <section className="mb-10">
        <div className="flex items-end justify-between mb-3">
          <div>
            <h2 className="font-[Fraunces] text-2xl text-neutral-800">Líneas de negocio</h2>
            <p className="text-sm text-neutral-500 mt-0.5">
              Cada lead recibe un score independiente por línea. Es lo que la IA usa para puntuar.
            </p>
          </div>
          <button
            onClick={() => setShowCreate((v) => !v)}
            className="px-4 py-2 rounded-lg text-white text-sm font-medium hover:opacity-90 transition"
            style={{ backgroundColor: "var(--color-primary)" }}
          >
            {showCreate ? "Cancelar" : "+ Nueva línea"}
          </button>
        </div>

        {showCreate && (
          <form onSubmit={createLine} className="bg-white rounded-xl border border-neutral-200 p-5 mb-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-1">Nombre *</label>
                <input
                  className={inputCls}
                  value={newLine.name}
                  onChange={(e) => setNewLine({ ...newLine, name: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-1">
                  Clave * <span className="text-neutral-400">(minúsculas, no se puede cambiar después)</span>
                </label>
                <input
                  className={`${inputCls} font-mono`}
                  placeholder="mi_linea"
                  value={newLine.key}
                  onChange={(e) => setNewLine({ ...newLine, key: e.target.value })}
                  required
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-600 mb-1">Qué vende esta línea</label>
              <textarea
                className={inputCls}
                rows={2}
                value={newLine.description}
                onChange={(e) => setNewLine({ ...newLine, description: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-1">Señales que suben el score</label>
                <textarea
                  className={`${inputCls} font-mono text-xs`}
                  rows={5}
                  value={newLine.scoringUp}
                  onChange={(e) => setNewLine({ ...newLine, scoringUp: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-1">Señales que bajan el score</label>
                <textarea
                  className={`${inputCls} font-mono text-xs`}
                  rows={5}
                  value={newLine.scoringDown}
                  onChange={(e) => setNewLine({ ...newLine, scoringDown: e.target.value })}
                />
              </div>
            </div>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg text-white text-sm font-medium hover:opacity-90 transition"
              style={{ backgroundColor: "var(--color-primary)" }}
            >
              Crear línea
            </button>
          </form>
        )}

        <div className="space-y-4">
          {lines.length === 0 && (
            <div className="bg-white rounded-xl border border-neutral-200 p-8 text-center text-sm text-neutral-500">
              Sin líneas de negocio. Crea al menos una para poder analizar leads.
            </div>
          )}
          {lines.map((line) => (
            <BusinessLineCard key={line.id} line={line} onSaved={load} onError={setErrorMsg} />
          ))}
        </div>
      </section>

      {/* ── Ajustes del análisis ──────────────────────────────────────────── */}
      {settings && (
        <section>
          <h2 className="font-[Fraunces] text-2xl text-neutral-800 mb-1">Análisis con IA</h2>
          <p className="text-sm text-neutral-500 mb-3">
            El análisis nunca se dispara solo: cuesta tiempo y una llamada de API.
          </p>

          <div className="bg-white rounded-xl border border-neutral-200 p-5 space-y-5">
            <div>
              <label className="block text-xs font-medium text-neutral-600 mb-1">Modelo</label>
              <div className="max-w-md">
                <Select
                  className={inputCls}
                  value={settings.aiModel}
                  onChange={(v) => saveSettings({ aiModel: v })}
                  options={allowedModels.map((m) => ({ value: m, label: MODEL_LABELS[m] ?? m }))}
                />
              </div>
              <p className="text-xs text-neutral-400 mt-1.5">
                Bajar a un modelo más barato reduce el coste por análisis sin tocar código.
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-neutral-600 mb-1">
                Contexto de la empresa <span className="text-neutral-400">(encabeza el prompt)</span>
              </label>
              <textarea
                className={inputCls}
                rows={2}
                defaultValue={settings.companyContext ?? ""}
                onBlur={(e) => e.target.value !== (settings.companyContext ?? "") && saveSettings({ companyContext: e.target.value })}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-neutral-600 mb-1">
                Regla de encadenamiento{" "}
                <span className="text-neutral-400">(opcional: cómo se relacionan las líneas entre sí)</span>
              </label>
              <textarea
                className={inputCls}
                rows={4}
                defaultValue={settings.chainingRule ?? ""}
                onBlur={(e) => e.target.value !== (settings.chainingRule ?? "") && saveSettings({ chainingRule: e.target.value })}
              />
            </div>

            {savingSettings && <p className="text-xs text-neutral-400">Guardando...</p>}
          </div>
        </section>
      )}
    </div>
  );
}
