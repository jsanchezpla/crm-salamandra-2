"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ALLOWED_ICONS, slugifyAreaKey } from "@/lib/clinica/performanceConfig.js";
import { AreaIcon } from "../_components/performanceIcons.jsx";

/**
 * Configuración de desempeño por ROLES (solo admin).
 * Cada rol agrupa posiciones del equipo y define sus áreas (peso + meta),
 * partiendo de un preset, en blanco o con una propuesta de IA.
 *
 * Contrato:
 *   GET  /api/clinica/performance/config     → { roles, isDefaultConfig, presets, positions }
 *   PUT  /api/clinica/performance/config     ← { roles }  (403 en la demo → banner)
 *   POST /api/clinica/performance/config/ai  ← { roleName, description? } → { role, fake }
 *
 * IMPORTANTE: el editor NUNCA regenera la `key` de un área existente al
 * renombrarla (las evaluaciones guardadas cuelgan de esa clave). Solo las áreas
 * NUEVAS reciben clave, con slugifyAreaKey, al guardar.
 */

// Slug local para la clave del ROL (la de las áreas la da slugifyAreaKey del lib).
function slugifyRoleKey(name, taken = []) {
  let base = String(name ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  if (!base) base = "rol";
  let key = base;
  let i = 2;
  while (taken.includes(key)) key = `${base.slice(0, 60)}_${i++}`;
  return key;
}

// Rol guardado → borrador editable (números como strings para los inputs).
function roleToDraft(role, { asCopy = false } = {}) {
  return {
    key: asCopy ? "" : (role.key ?? ""),
    name: asCopy ? `${role.name ?? ""} (copia)` : (role.name ?? ""),
    positions: [...(role.positions ?? [])],
    isDefault: asCopy ? false : !!role.isDefault,
    thresholds: {
      green: String(role.thresholds?.green ?? 85),
      amber: String(role.thresholds?.amber ?? 70),
    },
    areas: (role.areas ?? []).map((a) => ({
      key: asCopy ? null : (a.key ?? null), // null = área nueva → clave al guardar
      name: a.name ?? "",
      weight: String(a.weight ?? ""),
      icon: a.icon ?? "target",
      goal: a.goal ?? "",
      description: a.description ?? "",
    })),
  };
}

function blankDraft() {
  return {
    key: "",
    name: "",
    positions: [],
    isDefault: false,
    thresholds: { green: "85", amber: "70" },
    areas: [{ key: null, name: "", weight: "100", icon: "target", goal: "", description: "" }],
  };
}

const weightsSum = (draft) => draft.areas.reduce((s, a) => s + (Number(a.weight) || 0), 0);

function draftProblems(draft) {
  const errs = [];
  if (!draft.name.trim()) errs.push("Ponle un nombre al rol.");
  if (draft.areas.length === 0) errs.push("Añade al menos un área.");
  if (draft.areas.length > 15) errs.push("Máximo 15 áreas por rol.");
  if (draft.areas.some((a) => !a.name.trim())) errs.push("Hay áreas sin nombre.");
  if (draft.areas.some((a) => { const w = Number(a.weight); return !Number.isInteger(w) || w < 1 || w > 100; })) errs.push("Cada peso debe ser un entero entre 1 y 100.");
  if (draft.areas.length > 0 && weightsSum(draft) !== 100) errs.push("Los pesos deben sumar 100.");
  const g = Number(draft.thresholds.green);
  const a = Number(draft.thresholds.amber);
  if (!Number.isFinite(g) || !Number.isFinite(a) || !(g <= 100 && g > a && a >= 0)) errs.push("Umbrales del semáforo: verde mayor que ámbar (entre 0 y 100).");
  return errs;
}

export default function DesempenoConfigPage() {
  const [roles, setRoles] = useState([]);
  const [isDefaultConfig, setIsDefaultConfig] = useState(false);
  const [presets, setPresets] = useState([]);
  const [positions, setPositions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState(null); // { kind: "error" | "demo", text }
  const [addOpen, setAddOpen] = useState(false);
  const [aiForm, setAiForm] = useState(null); // null | { name, description, busy, error }
  const [confirmDelete, setConfirmDelete] = useState(null); // índice del rol a borrar
  // editor: null | { index: número (edición) | -1 (nuevo), draft, aiNotice? }
  const [editor, setEditor] = useState(null);

  const load = () => {
    setLoading(true);
    fetch("/api/clinica/performance/config", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!j.ok) { setBanner({ kind: "error", text: j.error ?? "No se pudo cargar la configuración." }); return; }
        setRoles(Array.isArray(j.data.roles) ? j.data.roles : (j.data.roles?.roles ?? []));
        setIsDefaultConfig(!!j.data.isDefaultConfig);
        setPresets(j.data.presets ?? []);
        setPositions(j.data.positions ?? []);
      })
      .catch((e) => setBanner({ kind: "error", text: e.message }))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  // PUT con la lista completa de roles. Garantiza exactamente UN rol por defecto.
  const putRoles = async (nextRoles) => {
    setBusy(true); setBanner(null);
    try {
      if (!nextRoles.some((r) => r.isDefault) && nextRoles.length > 0) nextRoles[0] = { ...nextRoles[0], isDefault: true };
      const r = await fetch("/api/clinica/performance/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roles: nextRoles }),
      });
      const j = await r.json();
      if (!r.ok) {
        setBanner({ kind: r.status === 403 ? "demo" : "error", text: j.error ?? "No se pudo guardar." });
        return false;
      }
      load();
      return true;
    } catch (e) {
      setBanner({ kind: "error", text: e.message });
      return false;
    } finally {
      setBusy(false);
    }
  };

  // Borrador → rol canónico. Da clave al rol y a las áreas NUEVAS; las existentes
  // conservan su clave aunque se hayan renombrado.
  const serializeDraft = (draft, index) => {
    const otherKeys = roles.filter((_, i) => i !== index).map((r) => r.key);
    const key = draft.key || slugifyRoleKey(draft.name, otherKeys);
    const areaKeys = draft.areas.filter((a) => a.key).map((a) => a.key);
    const areas = draft.areas.map((a) => {
      const areaKey = a.key ?? slugifyAreaKey(a.name, areaKeys);
      if (!a.key) areaKeys.push(areaKey);
      return {
        key: areaKey,
        name: a.name.trim(),
        weight: Number(a.weight),
        icon: a.icon,
        goal: a.goal.trim(),
        description: a.description?.trim() ?? "",
      };
    });
    return {
      key,
      name: draft.name.trim(),
      positions: draft.positions,
      isDefault: draft.isDefault,
      thresholds: { green: Number(draft.thresholds.green), amber: Number(draft.thresholds.amber) },
      areas,
    };
  };

  const saveEditor = async () => {
    if (!editor) return;
    const role = serializeDraft(editor.draft, editor.index);
    let next = editor.index >= 0
      ? roles.map((r, i) => (i === editor.index ? role : r))
      : [...roles, role];
    if (role.isDefault) next = next.map((r) => (r.key === role.key ? r : { ...r, isDefault: false }));
    const okSaved = await putRoles(next);
    if (okSaved) setEditor(null);
  };

  const duplicateRole = (index) => {
    const src = roles[index];
    const key = slugifyRoleKey(`${src.key}_copia`, roles.map((r) => r.key));
    putRoles([...roles, { ...src, key, name: `${src.name} (copia)`, isDefault: false, areas: (src.areas ?? []).map((a) => ({ ...a })) }]);
  };

  const deleteRole = async (index) => {
    const next = roles.filter((_, i) => i !== index);
    if (next.length > 0 && !next.some((r) => r.isDefault)) next[0] = { ...next[0], isDefault: true };
    const okSaved = await putRoles(next);
    if (okSaved) setConfirmDelete(null);
  };

  const openPreset = (p) => {
    setAddOpen(false);
    setEditor({
      index: -1,
      draft: {
        key: "",
        name: p.name ?? "",
        positions: [...(p.suggestedPositions ?? [])],
        isDefault: roles.length === 0,
        thresholds: { green: String(p.thresholds?.green ?? 85), amber: String(p.thresholds?.amber ?? 70) },
        areas: (p.areas ?? []).map((a) => ({ key: null, name: a.name ?? "", weight: String(a.weight ?? ""), icon: a.icon ?? "target", goal: a.goal ?? "", description: a.description ?? "" })),
      },
    });
  };

  const generateWithAi = async () => {
    if (!aiForm?.name?.trim() || aiForm.name.trim().length < 2) {
      setAiForm((f) => ({ ...f, error: "Escribe el nombre del puesto (mínimo 2 caracteres)." }));
      return;
    }
    setAiForm((f) => ({ ...f, busy: true, error: null }));
    try {
      const body = { roleName: aiForm.name.trim() };
      if (aiForm.description?.trim()) body.description = aiForm.description.trim();
      const r = await fetch("/api/clinica/performance/config/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "No se pudo generar la propuesta.");
      const role = j.data.role ?? {};
      setAddOpen(false);
      setAiForm(null);
      setEditor({
        index: -1,
        aiNotice: j.data.fake
          ? "Propuesta de ejemplo (la IA está desactivada en la demo). Revísala y ajústala antes de guardar."
          : "Propuesta generada con IA. Revisa áreas, pesos y metas antes de guardar.",
        draft: {
          key: "",
          name: role.name ?? aiForm.name.trim(),
          positions: [],
          isDefault: roles.length === 0,
          thresholds: { green: String(role.thresholds?.green ?? 85), amber: String(role.thresholds?.amber ?? 70) },
          areas: (role.areas ?? []).map((a) => ({ key: null, name: a.name ?? "", weight: String(a.weight ?? ""), icon: a.icon ?? "target", goal: a.goal ?? "", description: a.description ?? "" })),
        },
      });
    } catch (e) {
      setAiForm((f) => ({ ...f, error: e.message }));
    } finally {
      setAiForm((f) => (f ? { ...f, busy: false } : f));
    }
  };

  const onlyOneRole = roles.length === 1;

  return (
    <div className="p-4 lg:p-8 max-w-7xl mx-auto space-y-5">
      <Link href="/equipo" className="inline-flex items-center gap-1.5 text-xs text-neutral-500 hover:text-[var(--color-primary,#1B3A2D)] transition-colors w-fit">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
        Volver a Equipo
      </Link>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="eyebrow">Equipo · Desempeño</div>
          <h1 className="font-display text-2xl lg:text-4xl text-[var(--ink-900)] tracking-tight mt-1">Configuración de desempeño</h1>
          <p className="text-xs text-neutral-400 mt-1">Define roles de evaluación (terapeuta, administración, ventas…) y, para cada uno, sus áreas con peso y meta.</p>
        </div>
        <button
          onClick={() => setAddOpen(true)}
          className="inline-flex items-center gap-1.5 self-start lg:self-auto text-[11px] font-medium px-3 py-2 rounded-lg text-white hover:opacity-90 transition-opacity"
          style={{ background: "var(--color-primary, #1B3A2D)" }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
          Añadir rol
        </button>
      </div>

      {banner && (
        <div className={`px-4 py-3 rounded-lg border text-xs ${banner.kind === "demo" ? "bg-amber-50 border-amber-100 text-amber-800" : "bg-rose-50 border-rose-100 text-rose-700"}`}>
          {banner.kind === "demo" ? <span className="font-medium">Demo: </span> : null}{banner.text}
        </div>
      )}

      {isDefaultConfig && !loading && (
        <div className="px-4 py-3 rounded-lg bg-neutral-50 border border-neutral-100 text-xs text-neutral-600">
          Estás viendo la configuración por defecto (áreas del equipo terapéutico). En cuanto guardes cualquier cambio, pasará a ser la configuración propia de tu empresa.
        </div>
      )}

      {/* Lista de roles */}
      {loading ? (
        <div className="text-sm text-neutral-400">Cargando configuración…</div>
      ) : roles.length === 0 ? (
        <div className="bg-white border border-dashed border-neutral-200 rounded-xl p-10 text-center text-sm text-neutral-600">Aún no hay roles configurados. Añade el primero.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {roles.map((role, idx) => (
            <div key={role.key} className="bg-white border border-neutral-100 rounded-xl p-4 flex flex-col">
              <div className="flex items-start justify-between gap-2 mb-1">
                <div className="font-display text-sm text-[var(--ink-900)] leading-tight">{role.name}</div>
                {role.isDefault && (
                  <span className="shrink-0 inline-flex items-center bg-neutral-100 text-neutral-500 text-[9px] font-medium px-1.5 py-0.5 rounded-full" title="Recoge a los miembros cuya posición no casa con ningún otro rol">Por defecto</span>
                )}
              </div>
              <div className="text-[11px] text-neutral-500 mb-2">{(role.areas ?? []).length} área{(role.areas ?? []).length !== 1 ? "s" : ""} · Semáforo {role.thresholds?.green ?? 85}/{role.thresholds?.amber ?? 70}</div>
              <div className="flex flex-wrap gap-1 mb-3 flex-1 content-start">
                {(role.positions ?? []).length === 0 ? (
                  <span className="text-[10px] text-neutral-400">Sin posiciones asociadas</span>
                ) : (
                  role.positions.map((p) => (
                    <span key={p} className="inline-flex items-center bg-neutral-50 border border-neutral-100 text-neutral-600 text-[10px] px-1.5 py-0.5 rounded-full">{p}</span>
                  ))
                )}
              </div>
              <div className="flex items-center gap-3 pt-2 border-t border-neutral-100">
                <button onClick={() => setEditor({ index: idx, draft: roleToDraft(role) })} className="text-[11px] text-[var(--color-primary,#1B3A2D)] hover:underline">Editar</button>
                <button onClick={() => duplicateRole(idx)} disabled={busy || roles.length >= 20} className="text-[11px] text-neutral-500 hover:underline disabled:opacity-40">Duplicar</button>
                <button
                  onClick={() => setConfirmDelete(idx)}
                  disabled={busy || (role.isDefault && onlyOneRole)}
                  title={role.isDefault && onlyOneRole ? "No se puede borrar el rol por defecto si es el único" : "Borrar rol"}
                  className="text-[11px] text-neutral-500 hover:text-rose-600 hover:underline disabled:opacity-40 ml-auto"
                >
                  Borrar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-[10px] text-neutral-400 leading-snug">
        Guardar la configuración no borra ninguna evaluación: las puntuaciones ya registradas se conservan con la clave interna de su área, aunque la renombres o la quites del rol.
      </p>

      {/* ── Panel "Añadir rol": preset / en blanco / IA ── */}
      {addOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40" onClick={() => { if (!aiForm?.busy) { setAddOpen(false); setAiForm(null); } }} />
          <div className="fixed right-0 top-14 lg:top-0 bottom-0 z-50 w-full max-w-xl bg-white shadow-xl overflow-y-auto">
            <div className="px-5 py-4 border-b border-neutral-100 flex items-start justify-between gap-4 sticky top-0 bg-white">
              <div>
                <h3 className="font-display text-lg text-[var(--ink-900)]">Añadir rol</h3>
                <p className="text-[11px] text-neutral-400 mt-0.5">Parte de un preset, empieza en blanco o pide una propuesta a la IA.</p>
              </div>
              <button onClick={() => { setAddOpen(false); setAiForm(null); }} className="p-1.5 text-neutral-400 hover:text-neutral-700">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="p-5 space-y-4">
              {aiForm ? (
                <div className="space-y-3">
                  <button onClick={() => setAiForm(null)} className="text-[11px] text-neutral-500 hover:underline">← Volver a los presets</button>
                  <div>
                    <label className="text-[10px] uppercase tracking-wider text-neutral-400">Nombre del puesto</label>
                    <input
                      type="text" value={aiForm.name} maxLength={120}
                      onChange={(e) => setAiForm((f) => ({ ...f, name: e.target.value }))}
                      className="mt-1 w-full text-sm border border-neutral-200 rounded-lg px-3 py-2 focus:outline-none focus:border-neutral-400"
                      placeholder="p. ej. Responsable de atención al cliente"
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase tracking-wider text-neutral-400">¿Qué hace este puesto? (opcional)</label>
                    <textarea
                      value={aiForm.description} rows={3} maxLength={2000}
                      onChange={(e) => setAiForm((f) => ({ ...f, description: e.target.value }))}
                      className="mt-1 w-full text-sm border border-neutral-200 rounded-lg px-3 py-2 focus:outline-none focus:border-neutral-400 resize-none"
                      placeholder="Cuéntale a la IA qué hace ese puesto en tu empresa: tareas, objetivos, con quién trata…"
                    />
                  </div>
                  {aiForm.error && <div className="px-3 py-2 rounded-lg bg-rose-50 border border-rose-100 text-xs text-rose-700">{aiForm.error}</div>}
                  <div className="flex justify-end">
                    <button onClick={generateWithAi} disabled={aiForm.busy} className="px-4 py-2 rounded-lg text-white text-xs font-medium disabled:opacity-50" style={{ background: "var(--color-primary, #1B3A2D)" }}>
                      {aiForm.busy ? "Generando…" : "Generar propuesta"}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {presets.map((p) => (
                      <button key={p.key} onClick={() => openPreset(p)} className="text-left bg-white border border-neutral-200 rounded-xl p-3 hover:border-[var(--color-primary,#1B3A2D)] transition-colors">
                        <div className="font-display text-sm text-[var(--ink-900)] mb-1">{p.name}</div>
                        <div className="text-[10px] text-neutral-400 leading-snug">{(p.areas ?? []).map((a) => a.name).join(" · ")}</div>
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      onClick={() => { setAddOpen(false); setEditor({ index: -1, draft: { ...blankDraft(), isDefault: roles.length === 0 } }); }}
                      className="text-left bg-neutral-50 border border-dashed border-neutral-200 rounded-xl p-3 hover:border-neutral-400 transition-colors"
                    >
                      <div className="font-display text-sm text-[var(--ink-900)] mb-1">Empezar en blanco</div>
                      <div className="text-[10px] text-neutral-400">Define tú las áreas, pesos y metas desde cero.</div>
                    </button>
                    <button
                      onClick={() => setAiForm({ name: "", description: "", busy: false, error: null })}
                      className="text-left bg-neutral-50 border border-dashed border-neutral-200 rounded-xl p-3 hover:border-neutral-400 transition-colors"
                    >
                      <div className="font-display text-sm text-[var(--ink-900)] mb-1">✨ Generar con IA</div>
                      <div className="text-[10px] text-neutral-400">Describe el puesto y la IA propone áreas, pesos y metas.</div>
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}

      {/* ── Editor de rol (drawer) ── */}
      {editor && (
        <RoleEditorDrawer
          editor={editor}
          setEditor={setEditor}
          positions={positions}
          busy={busy}
          onSave={saveEditor}
          canUnsetDefault={roles.some((r, i) => i !== editor.index)}
        />
      )}

      {/* ── Confirmación de borrado ── */}
      {confirmDelete != null && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40" onClick={() => !busy && setConfirmDelete(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-5 pointer-events-auto">
              <h3 className="font-display text-lg text-[var(--ink-900)] mb-1">Borrar rol</h3>
              <p className="text-xs text-neutral-600 leading-snug mb-4">
                ¿Borrar el rol «{roles[confirmDelete]?.name}»? Las evaluaciones ya guardadas no se borran; las personas de este rol pasarán a evaluarse con el rol por defecto.
              </p>
              <div className="flex justify-end gap-2">
                <button onClick={() => setConfirmDelete(null)} disabled={busy} className="px-4 py-2 rounded-lg border border-neutral-200 text-xs text-neutral-600 hover:bg-neutral-50 disabled:opacity-50">Cancelar</button>
                <button onClick={() => deleteRole(confirmDelete)} disabled={busy} className="px-4 py-2 rounded-lg bg-rose-600 text-white text-xs font-medium hover:bg-rose-700 disabled:opacity-50">{busy ? "Borrando…" : "Borrar rol"}</button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Drawer de edición de un rol ─────────────────────────────────────────────
function RoleEditorDrawer({ editor, setEditor, positions, busy, onSave, canUnsetDefault }) {
  const { draft } = editor;
  const [newPosition, setNewPosition] = useState("");
  const [iconPicker, setIconPicker] = useState(null); // índice del área con el selector abierto

  const patchDraft = (patch) => setEditor((e) => ({ ...e, draft: { ...e.draft, ...patch } }));
  const patchArea = (i, patch) => patchDraft({ areas: draft.areas.map((a, idx) => (idx === i ? { ...a, ...patch } : a)) });
  const addArea = () => patchDraft({ areas: [...draft.areas, { key: null, name: "", weight: "", icon: "target", goal: "", description: "" }] });
  const removeArea = (i) => patchDraft({ areas: draft.areas.filter((_, idx) => idx !== i) });
  const moveArea = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= draft.areas.length) return;
    const next = [...draft.areas];
    [next[i], next[j]] = [next[j], next[i]];
    patchDraft({ areas: next });
  };

  const addPosition = (p) => {
    const v = String(p ?? "").trim();
    if (!v) return;
    if (draft.positions.some((x) => x.toLowerCase() === v.toLowerCase())) return;
    patchDraft({ positions: [...draft.positions, v] });
    setNewPosition("");
  };
  const removePosition = (p) => patchDraft({ positions: draft.positions.filter((x) => x !== p) });
  const suggestions = positions.filter((p) => !draft.positions.some((x) => x.toLowerCase() === String(p).toLowerCase()));

  const sum = weightsSum(draft);
  const problems = draftProblems(draft);
  const canSave = problems.length === 0 && !busy;
  const g = Number(draft.thresholds.green);
  const a = Number(draft.thresholds.amber);
  const thresholdsBad = !(Number.isFinite(g) && Number.isFinite(a) && g <= 100 && g > a && a >= 0);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={() => !busy && setEditor(null)} />
      <div className="fixed right-0 top-14 lg:top-0 bottom-0 z-50 w-full max-w-2xl bg-white shadow-xl overflow-y-auto">
        <div className="px-5 py-4 border-b border-neutral-100 flex items-start justify-between gap-4 sticky top-0 bg-white z-10">
          <div>
            <h3 className="font-display text-lg text-[var(--ink-900)]">{editor.index >= 0 ? "Editar rol" : "Nuevo rol"}</h3>
            <p className="text-[11px] text-neutral-400 mt-0.5">Áreas, pesos, metas y semáforo con los que se evalúa a este rol.</p>
          </div>
          <button onClick={() => !busy && setEditor(null)} className="p-1.5 text-neutral-400 hover:text-neutral-700">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="p-5 space-y-5">
          {editor.aiNotice && (
            <div className="px-3 py-2 rounded-lg bg-amber-50 border border-amber-100 text-xs text-amber-800">{editor.aiNotice}</div>
          )}

          {/* Nombre + por defecto */}
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-neutral-400">Nombre del rol</label>
              <input
                type="text" value={draft.name} maxLength={120}
                onChange={(e) => patchDraft({ name: e.target.value })}
                className="mt-1 w-full text-sm border border-neutral-200 rounded-lg px-3 py-2 focus:outline-none focus:border-neutral-400"
                placeholder="p. ej. Recepción"
              />
            </div>
            <label className={`inline-flex items-center gap-2 text-xs text-neutral-600 pb-2 ${draft.isDefault && !canUnsetDefault ? "opacity-50" : "cursor-pointer"}`} title="Recoge a los miembros cuya posición no casa con ningún otro rol">
              <input
                type="checkbox"
                checked={draft.isDefault}
                disabled={draft.isDefault && !canUnsetDefault}
                onChange={(e) => patchDraft({ isDefault: e.target.checked })}
                className="accent-[var(--color-primary,#1B3A2D)]"
              />
              Rol por defecto
            </label>
          </div>

          {/* Posiciones asociadas */}
          <div>
            <label className="text-[10px] uppercase tracking-wider text-neutral-400">Posiciones del equipo que evalúa este rol</label>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {draft.positions.map((p) => (
                <span key={p} className="inline-flex items-center gap-1 bg-neutral-100 text-neutral-700 text-[11px] px-2 py-1 rounded-full">
                  {p}
                  <button onClick={() => removePosition(p)} className="text-neutral-400 hover:text-rose-600" title="Quitar">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </span>
              ))}
              {draft.positions.length === 0 && <span className="text-[11px] text-neutral-400">Sin posiciones: solo aplicará si es el rol por defecto.</span>}
            </div>
            {suggestions.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {suggestions.map((p) => (
                  <button key={p} onClick={() => addPosition(p)} className="inline-flex items-center gap-1 border border-dashed border-neutral-200 text-neutral-500 text-[11px] px-2 py-1 rounded-full hover:border-neutral-400" title="Añadir esta posición al rol">
                    + {p}
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2 mt-2">
              <input
                type="text" value={newPosition}
                onChange={(e) => setNewPosition(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addPosition(newPosition); } }}
                className="flex-1 text-xs border border-neutral-200 rounded-lg px-3 py-2 focus:outline-none focus:border-neutral-400"
                placeholder="Otra posición (texto libre)…"
              />
              <button onClick={() => addPosition(newPosition)} className="text-[11px] text-[var(--color-primary,#1B3A2D)] hover:underline whitespace-nowrap">Añadir</button>
            </div>
          </div>

          {/* Umbrales del semáforo */}
          <div>
            <label className="text-[10px] uppercase tracking-wider text-neutral-400">Semáforo</label>
            <div className="grid grid-cols-2 gap-3 mt-1 max-w-xs">
              <div>
                <div className="flex items-center gap-1.5 text-[10px] text-neutral-500 mb-1"><span className="w-2 h-2 rounded-full bg-emerald-500" /> Verde desde</div>
                <input type="number" min={0} max={100} value={draft.thresholds.green} onChange={(e) => patchDraft({ thresholds: { ...draft.thresholds, green: e.target.value } })} className="w-full px-2 py-1.5 text-sm border border-neutral-200 rounded-lg focus:outline-none focus:border-neutral-400 tabular" />
              </div>
              <div>
                <div className="flex items-center gap-1.5 text-[10px] text-neutral-500 mb-1"><span className="w-2 h-2 rounded-full bg-amber-500" /> Ámbar desde</div>
                <input type="number" min={0} max={100} value={draft.thresholds.amber} onChange={(e) => patchDraft({ thresholds: { ...draft.thresholds, amber: e.target.value } })} className="w-full px-2 py-1.5 text-sm border border-neutral-200 rounded-lg focus:outline-none focus:border-neutral-400 tabular" />
              </div>
            </div>
            {thresholdsBad && <p className="text-[10px] text-rose-600 mt-1">El umbral verde debe ser mayor que el ámbar (ambos entre 0 y 100).</p>}
          </div>

          {/* Áreas */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="eyebrow">Áreas del rol</label>
              <span className={`text-[11px] tabular font-medium ${sum === 100 ? "text-emerald-600" : "text-rose-600"}`}>Suma de pesos: {sum}/100</span>
            </div>
            <div className="h-1.5 bg-neutral-100 rounded-full overflow-hidden mb-3">
              <div className={`h-full rounded-full transition-all ${sum === 100 ? "bg-emerald-500" : sum > 100 ? "bg-rose-500" : "bg-amber-400"}`} style={{ width: `${Math.min(100, sum)}%` }} />
            </div>

            <div className="space-y-2">
              {draft.areas.map((area, i) => (
                <div key={i} className="border border-neutral-100 rounded-lg p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="flex flex-col">
                      <button onClick={() => moveArea(i, -1)} disabled={i === 0} className="p-0.5 text-neutral-300 hover:text-neutral-600 disabled:opacity-30" title="Subir">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" /></svg>
                      </button>
                      <button onClick={() => moveArea(i, 1)} disabled={i === draft.areas.length - 1} className="p-0.5 text-neutral-300 hover:text-neutral-600 disabled:opacity-30" title="Bajar">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>
                      </button>
                    </div>
                    <button
                      onClick={() => setIconPicker(iconPicker === i ? null : i)}
                      className={`shrink-0 p-2 rounded-lg border transition-colors ${iconPicker === i ? "border-[var(--color-primary,#1B3A2D)] text-[var(--color-primary,#1B3A2D)]" : "border-neutral-200 text-neutral-500 hover:border-neutral-400"}`}
                      title="Cambiar icono"
                    >
                      <AreaIcon icon={area.icon} className="w-4 h-4" />
                    </button>
                    <input
                      type="text" value={area.name} maxLength={120}
                      onChange={(e) => patchArea(i, { name: e.target.value })}
                      className="flex-1 min-w-0 text-sm border border-neutral-200 rounded-lg px-3 py-2 focus:outline-none focus:border-neutral-400"
                      placeholder="Nombre del área"
                    />
                    <div className="shrink-0 flex items-center gap-1">
                      <input
                        type="number" min={1} max={100} value={area.weight}
                        onChange={(e) => patchArea(i, { weight: e.target.value })}
                        className="w-16 px-2 py-2 text-sm border border-neutral-200 rounded-lg focus:outline-none focus:border-neutral-400 tabular text-right"
                        placeholder="Peso"
                        title="Peso del área (los pesos del rol deben sumar 100)"
                      />
                      <span className="text-[10px] text-neutral-400">%</span>
                    </div>
                    <button onClick={() => removeArea(i)} disabled={draft.areas.length <= 1} className="shrink-0 p-1.5 text-neutral-400 hover:text-rose-600 disabled:opacity-30" title="Quitar área">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                  {iconPicker === i && (
                    <div className="flex flex-wrap gap-1 p-2 bg-neutral-50 rounded-lg">
                      {ALLOWED_ICONS.map((ic) => (
                        <button
                          key={ic}
                          onClick={() => { patchArea(i, { icon: ic }); setIconPicker(null); }}
                          className={`p-1.5 rounded-md transition-colors ${area.icon === ic ? "bg-white text-[var(--color-primary,#1B3A2D)] ring-1 ring-[var(--color-primary,#1B3A2D)]" : "text-neutral-500 hover:bg-white"}`}
                          title={ic}
                        >
                          <AreaIcon icon={ic} className="w-4 h-4" />
                        </button>
                      ))}
                    </div>
                  )}
                  <input
                    type="text" value={area.goal} maxLength={300}
                    onChange={(e) => patchArea(i, { goal: e.target.value })}
                    className="w-full text-xs border border-neutral-200 rounded-lg px-3 py-2 focus:outline-none focus:border-neutral-400"
                    placeholder="Meta del área (p. ej. «≥90% de citas confirmadas»)"
                  />
                </div>
              ))}
            </div>

            <button onClick={addArea} disabled={draft.areas.length >= 15} className="mt-2 text-[11px] text-[var(--color-primary,#1B3A2D)] hover:underline disabled:opacity-40">+ Añadir área</button>
          </div>

          <p className="text-[10px] text-neutral-400 leading-snug">
            Renombrar un área no borra sus evaluaciones: su clave interna se conserva. Las áreas nuevas reciben su propia clave al guardar.
          </p>

          {problems.length > 0 && (
            <ul className="px-3 py-2 rounded-lg bg-neutral-50 border border-neutral-100 text-[11px] text-neutral-600 space-y-0.5 list-disc list-inside">
              {problems.map((p) => <li key={p}>{p}</li>)}
            </ul>
          )}
        </div>

        <div className="px-5 py-4 border-t border-neutral-100 flex justify-end gap-2 sticky bottom-0 bg-white">
          <button onClick={() => !busy && setEditor(null)} disabled={busy} className="px-4 py-2 rounded-lg border border-neutral-200 text-xs text-neutral-600 hover:bg-neutral-50 disabled:opacity-50">Cancelar</button>
          <button onClick={onSave} disabled={!canSave} className="px-4 py-2 rounded-lg text-white text-xs font-medium disabled:opacity-50" style={{ background: "var(--color-primary, #1B3A2D)" }}>
            {busy ? "Guardando…" : "Guardar rol"}
          </button>
        </div>
      </div>
    </>
  );
}
