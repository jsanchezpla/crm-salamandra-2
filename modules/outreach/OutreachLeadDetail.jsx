"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Select from "../../components/ui/Select.jsx";
import HelpTooltip from "../../components/ui/HelpTooltip.jsx";
import SECTORES from "./sectores.json";
import { scoreBand, analysisFor, sourceLabel, formatDate } from "./scores.js";
import { useIntegrations } from "./useIntegrations.js";
import IntegrationGate from "./IntegrationGate.jsx";

const inputCls =
  "w-full rounded-lg px-3 py-2 text-sm text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition";

// Lista plana para el <Select> de edición del lead. Se deduplica por valor
// (algún tipo aparece en dos sectores) para no repetir opción ni claves.
const SECTOR_OPTIONS = (() => {
  const seen = new Set();
  const opts = [{ value: "", label: "— Sin sector —" }];
  for (const c of SECTORES) {
    for (const s of c.sectores) {
      if (seen.has(s)) continue;
      seen.add(s);
      opts.push({ value: s, label: `${c.categoria} · ${s}` });
    }
  }
  return opts;
})();

function ScorePill({ score }) {
  const { label, badge } = scoreBand(score);
  return (
    <div className="flex items-center gap-3">
      <span className={`inline-flex items-center justify-center rounded-xl px-3 py-1.5 text-lg font-semibold ${badge}`}>
        {score == null ? "—" : score}
      </span>
      <span className="text-xs text-neutral-500">{label}</span>
    </div>
  );
}

/**
 * Correo modelo: la IA lo propone, una persona lo revisa, lo edita y confirma
 * el envío. Nunca se manda solo.
 */
function EmailDraft({ leadId, line, analysis, recipients, onSent, emailReady }) {
  const draft = analysis.emailDraft;
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(recipients[0]?.email ?? "");
  const [subject, setSubject] = useState(draft?.subject ?? "");
  const [body, setBody] = useState(draft?.body ?? "");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState(null);

  if (!draft?.subject && !draft?.body) return null;

  const alreadySent = Boolean(analysis.sentAt);

  const send = async () => {
    setSending(true);
    setNotice(null);
    try {
      const r = await fetch(`/api/outreach/leads/${leadId}/enviar-correo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessLineId: line.id, to, subject, body, force: alreadySent }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "No se pudo enviar");
      if (j.data.dryRun) {
        setNotice({ kind: "warn", text: j.data.message });
      } else {
        setNotice({ kind: "ok", text: "Correo enviado." });
        onSent();
      }
    } catch (e) {
      setNotice({ kind: "error", text: e.message });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mt-1 border-t border-neutral-100 pt-4">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">Correo modelo</h4>
        <div className="flex items-center gap-2">
          {alreadySent && (
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
              enviado {formatDate(analysis.sentAt)}
            </span>
          )}
          <button
            onClick={() => setOpen((v) => !v)}
            className="text-xs text-neutral-500 hover:text-neutral-800"
          >
            {open ? "Ocultar" : "Ver y enviar"}
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-3 space-y-3">
          <div>
            <label className="block text-[11px] font-medium text-neutral-500 mb-1">Para</label>
            {recipients.length > 0 ? (
              <select className={inputCls} value={to} onChange={(e) => setTo(e.target.value)}>
                {recipients.map((r) => (
                  <option key={r.email} value={r.email}>
                    {r.label}
                  </option>
                ))}
              </select>
            ) : (
              <input className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} placeholder="email@empresa.com" />
            )}
          </div>
          <div>
            <label className="block text-[11px] font-medium text-neutral-500 mb-1">Asunto</label>
            <input className={inputCls} value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-neutral-500 mb-1">Cuerpo</label>
            <textarea className={inputCls} rows={10} value={body} onChange={(e) => setBody(e.target.value)} />
          </div>

          {notice && (
            <p
              className={`text-xs ${
                notice.kind === "ok" ? "text-emerald-700" : notice.kind === "warn" ? "text-amber-700" : "text-rose-700"
              }`}
            >
              {notice.text}
            </p>
          )}

          {!emailReady && (
            <p className="text-xs text-amber-700">
              Configura la clave de Resend en{" "}
              <Link href="/configuracion" className="font-semibold underline">
                Configuración → IA
              </Link>{" "}
              para poder enviar correos.
            </p>
          )}

          <button
            onClick={send}
            disabled={sending || !to || !subject.trim() || !body.trim() || !emailReady}
            title={emailReady ? undefined : "Configura la clave de Resend en Configuración → IA para enviar correos"}
            className="px-4 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition"
            style={{ backgroundColor: "var(--color-primary)" }}
          >
            {sending ? "Enviando..." : alreadySent ? "Reenviar" : "Enviar correo"}
          </button>
          <p className="text-[11px] text-neutral-400">
            Se envía exactamente lo que ves aquí. Revísalo antes de confirmar.
          </p>
        </div>
      )}
    </div>
  );
}

function BusinessLinePanel({ leadId, line, analysis, recipients, onSent, emailReady }) {
  return (
    <section className="bg-white rounded-xl border border-neutral-200 p-5 flex flex-col">
      <header className="mb-4">
        <h3 className="font-[Fraunces] text-xl text-neutral-800 break-words">{line.name}</h3>
        {line.description && (
          <p className="text-xs text-neutral-500 mt-1 leading-relaxed line-clamp-2">{line.description}</p>
        )}
      </header>

      {!analysis ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center py-10 px-4">
          <ScorePill score={null} />
          <p className="text-sm text-neutral-500 mt-4 max-w-xs">
            Este lead todavía no se ha analizado para esta línea de negocio.
          </p>
          <p className="text-xs text-neutral-400 mt-2">Pulsa &quot;Analizar&quot; arriba para puntuarlo con IA.</p>
        </div>
      ) : (
        <div className="flex-1 flex flex-col gap-5">
          <ScorePill score={analysis.score} />

          {analysis.reasonWhy && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-1.5">
                Por qué llamarles
              </h4>
              <p className="text-sm text-neutral-700 leading-relaxed">{analysis.reasonWhy}</p>
            </div>
          )}

          {analysis.needs?.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-2">
                Necesidades detectadas
              </h4>
              <ul className="space-y-1.5">
                {analysis.needs.map((n, i) => (
                  <li key={i} className="flex gap-2 text-sm text-neutral-700">
                    <span
                      className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: "var(--color-primary)" }}
                    />
                    <span>{n}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {analysis.pitch && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-1.5">
                Cómo abordarles
              </h4>
              <p className="text-sm text-neutral-700 leading-relaxed">{analysis.pitch}</p>
            </div>
          )}

          {/* key por analyzedAt: al re-analizar, el borrador cambia y el
              componente debe remontarse para re-sembrar asunto/cuerpo/destinatario
              desde el nuevo borrador (si no, mostraría/enviaría el correo viejo). */}
          <EmailDraft
            key={`draft-${analysis.analyzedAt ?? analysis.id}`}
            leadId={leadId}
            line={line}
            analysis={analysis}
            recipients={recipients}
            onSent={onSent}
            emailReady={emailReady}
          />

          <footer className="mt-auto pt-4 border-t border-neutral-100 flex items-center justify-between text-xs text-neutral-400">
            <span>Analizado {formatDate(analysis.analyzedAt)}</span>
            {analysis.model && <span className="font-mono">{analysis.model}</span>}
          </footer>
        </div>
      )}
    </section>
  );
}

function ContactsList({ contacts }) {
  if (!contacts?.length) return <p className="text-sm text-neutral-400">Sin contactos registrados.</p>;
  return (
    <ul className="divide-y divide-neutral-100">
      {contacts.map((c) => (
        <li key={c.id} className="py-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-medium text-neutral-800">{c.name ?? "—"}</span>
          {c.isDecisionMaker && (
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
              ★ decisor
            </span>
          )}
          {c.role && <span className="text-sm text-neutral-500">{c.role}</span>}
          <span className="flex-1" />
          <span className="text-sm text-neutral-600 flex flex-wrap gap-x-4">
            {c.mobile && <span>{c.mobile}</span>}
            {c.phone && <span>{c.phone}</span>}
            {c.email && <span className="text-neutral-500">{c.email}</span>}
            {c.linkedin && <span className="text-neutral-400">{c.linkedin}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

const EDITABLE_FIELDS = ["name", "sector", "location", "website", "phone", "email"];

export default function OutreachLeadDetail({ leadId }) {
  const [data, setData] = useState({ lead: null, lines: [], error: null, loadedFor: null });
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState(null);
  // Subconjunto de líneas a analizar (null = todas). Permite elegir qué líneas
  // analizar para esta empresa concreta sin desactivarlas globalmente.
  const [selectedLineIds, setSelectedLineIds] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState(null);
  const router = useRouter();
  const [showDelete, setShowDelete] = useState(false);
  const [showConvert, setShowConvert] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  // Claves de IA por tenant (BYOK): analizar necesita Anthropic, enviar necesita
  // Resend. Sin ellas se ve la ficha pero esas acciones quedan deshabilitadas.
  const { status: integrations, has } = useIntegrations();
  const analyzeReady = has("anthropic");
  const emailReady = has("resend");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/outreach/leads/${leadId}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error || "Error cargando el lead");
        return j;
      })
      .then((j) => {
        if (!cancelled) setData({ lead: j.data.lead, lines: j.data.businessLines ?? [], error: null, loadedFor: leadId });
      })
      .catch((e) => {
        if (!cancelled) setData({ lead: null, lines: [], error: e.message, loadedFor: leadId });
      });
    return () => {
      cancelled = true;
    };
  }, [leadId, reloadKey]);

  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);

  const startEdit = () => {
    setEditForm(Object.fromEntries(EDITABLE_FIELDS.map((f) => [f, data.lead?.[f] ?? ""])));
    setEditError(null);
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!editForm.name.trim()) {
      setEditError("El nombre de la empresa es obligatorio");
      return;
    }
    setSavingEdit(true);
    setEditError(null);
    try {
      const payload = {
        name: editForm.name.trim(),
        sector: editForm.sector.trim() || null,
        location: editForm.location.trim() || null,
        website: editForm.website.trim() || null,
        phone: editForm.phone.trim() || null,
        email: editForm.email.trim() || null,
      };
      const r = await fetch(`/api/outreach/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "No se pudo guardar");
      setEditing(false);
      refresh();
    } catch (e) {
      setEditError(e.message);
    } finally {
      setSavingEdit(false);
    }
  };

  const analyze = async () => {
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      // null = todas las líneas activas (el backend las resuelve). Un array
      // envía solo ese subconjunto; los análisis de las demás se conservan.
      const opts = { method: "POST" };
      if (Array.isArray(selectedLineIds) && selectedLineIds.length > 0) {
        opts.headers = { "Content-Type": "application/json" };
        opts.body = JSON.stringify({ lineIds: selectedLineIds });
      }
      const r = await fetch(`/api/outreach/leads/${leadId}/analizar`, opts);
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "El análisis ha fallado");
      refresh();
    } catch (e) {
      setAnalyzeError(e.message);
    } finally {
      setAnalyzing(false);
    }
  };

  const doDelete = async () => {
    setActionBusy(true);
    setActionError(null);
    try {
      const r = await fetch(`/api/outreach/leads/${leadId}`, { method: "DELETE" });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.error || "No se pudo eliminar");
      }
      router.push("/outreach"); // borrado: fuera de la ficha
    } catch (e) {
      setActionError(e.message);
      setActionBusy(false);
    }
  };

  const doConvert = async () => {
    setActionBusy(true);
    setActionError(null);
    try {
      const r = await fetch(`/api/outreach/leads/${leadId}/convertir-cliente`, { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "No se pudo convertir");
      router.push("/outreach"); // ya es cliente: sale de captados
    } catch (e) {
      setActionError(e.message);
      setActionBusy(false);
    }
  };

  const { lead, lines, error: errorMsg } = data;
  const loading = data.loadedFor !== leadId;

  if (loading) return <div className="p-4 lg:p-8 text-neutral-400">Cargando ficha...</div>;
  if (errorMsg) {
    return (
      <div className="p-4 lg:p-8 max-w-[1400px] mx-auto">
        <Link href="/outreach" className="text-sm text-neutral-500 hover:text-neutral-800">
          ← Volver a Captación
        </Link>
        <div className="mt-4 px-3 py-2 rounded-lg bg-rose-50 border border-rose-100 text-sm text-rose-700">{errorMsg}</div>
      </div>
    );
  }

  // Destinatarios posibles: contactos con email (decisores primero, ya vienen
  // ordenados) y el email general de la empresa. Se deduplica por dirección
  // para no repetir la misma y evitar keys duplicadas en el <select> cuando un
  // contacto tiene el mismo email que el general.
  const recipients = [];
  const seenEmails = new Set();
  for (const c of lead.contacts ?? []) {
    if (!c.email || seenEmails.has(c.email)) continue;
    seenEmails.add(c.email);
    recipients.push({ email: c.email, label: `${c.name ?? c.email}${c.isDecisionMaker ? " ★ decisor" : ""}` });
  }
  if (lead.email && !seenEmails.has(lead.email)) {
    recipients.push({ email: lead.email, label: `${lead.email} (email general)` });
  }

  const gridCols = lines.length >= 3 ? "lg:grid-cols-3" : lines.length === 2 ? "lg:grid-cols-2" : "lg:grid-cols-1";

  // Selección de líneas a analizar (null = todas).
  const selectedSet = selectedLineIds === null ? lines.map((l) => l.id) : selectedLineIds;
  const isLineOn = (id) => selectedSet.includes(id);
  const toggleLine = (id) => {
    const base = selectedLineIds === null ? lines.map((l) => l.id) : selectedLineIds;
    setSelectedLineIds(base.includes(id) ? base.filter((x) => x !== id) : [...base, id]);
  };
  const noLinesSelected = selectedSet.length === 0;

  return (
    <div className="p-4 lg:p-8 max-w-[1400px] mx-auto">
      <Link href="/outreach" className="text-sm text-neutral-500 hover:text-neutral-800">
        ← Volver a Captación
      </Link>

      <header className="flex flex-col lg:flex-row lg:items-start gap-4 mt-3 mb-6">
        <div className="flex-1 min-w-0">
          {editing ? (
            <div className="space-y-3 max-w-2xl">
              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-1">Empresa *</label>
                <input
                  className={inputCls}
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  maxLength={200}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-neutral-600 mb-1">Sector</label>
                  <Select
                    className={inputCls}
                    value={editForm.sector}
                    onChange={(v) => setEditForm({ ...editForm, sector: v })}
                    options={SECTOR_OPTIONS}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-600 mb-1">Ubicación</label>
                  <input
                    className={inputCls}
                    value={editForm.location}
                    onChange={(e) => setEditForm({ ...editForm, location: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-neutral-600 mb-1">Web</label>
                  <input
                    className={inputCls}
                    placeholder="https://"
                    value={editForm.website}
                    onChange={(e) => setEditForm({ ...editForm, website: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-600 mb-1">Teléfono</label>
                  <input
                    className={inputCls}
                    value={editForm.phone}
                    onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-600 mb-1">Email</label>
                <input
                  type="email"
                  className={inputCls}
                  value={editForm.email}
                  onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                />
              </div>
              {editError && <p className="text-xs text-rose-700">{editError}</p>}
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={saveEdit}
                  disabled={savingEdit}
                  className="px-4 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-50 hover:opacity-90 transition"
                  style={{ backgroundColor: "var(--color-primary)" }}
                >
                  {savingEdit ? "Guardando..." : "Guardar"}
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="px-4 py-2 rounded-lg border border-neutral-200 text-sm text-neutral-600 hover:bg-neutral-50"
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <>
              <h1 className="font-[Fraunces] text-3xl lg:text-4xl text-neutral-800">
                {lead.name}
                <HelpTooltip title="Analizar con IA" className="ml-2">
                  Cada vez que lo pulsas se paga una consulta a la IA con la clave que tengas
                  puesta en Configuración. Y no suma:{" "}
                  <strong className="text-white">reescribe el análisis anterior</strong>{" "}
                  —puntuación, motivos y correo modelo— de las líneas que analices. Las que dejes
                  sin marcar se quedan como estaban.
                </HelpTooltip>
              </h1>
              <p className="text-sm text-neutral-500 mt-1">
                {[lead.sector, lead.location].filter(Boolean).join(" · ") || "Sin sector ni ubicación"}
              </p>
              <div className="flex flex-wrap gap-x-5 gap-y-1 mt-3 text-sm text-neutral-600">
                {lead.website && (
                  <a href={lead.website} target="_blank" rel="noreferrer" className="hover:text-neutral-900 underline underline-offset-2">
                    {lead.website.replace(/^https?:\/\//, "")}
                  </a>
                )}
                {lead.phone && <span>{lead.phone}</span>}
                {lead.email && <span>{lead.email}</span>}
              </div>
            </>
          )}
        </div>
        {!editing && (
          <div className="flex flex-col items-end gap-2 shrink-0">
            <div className="flex items-center gap-2 flex-wrap justify-end">
              <button
                type="button"
                onClick={() => {
                  setActionError(null);
                  setShowConvert(true);
                }}
                className="px-3 py-2 rounded-lg border border-neutral-200 text-sm text-neutral-600 hover:bg-neutral-50 transition"
              >
                Convertir en cliente
              </button>
              <button
                type="button"
                onClick={startEdit}
                className="px-3 py-2 rounded-lg border border-neutral-200 text-sm text-neutral-600 hover:bg-neutral-50 transition"
              >
                Editar
              </button>
              <button
                type="button"
                onClick={() => {
                  setActionError(null);
                  setShowDelete(true);
                }}
                className="px-3 py-2 rounded-lg border border-red-200 text-sm text-red-600 hover:bg-red-50 transition"
              >
                Eliminar
              </button>
              {/* Cada análisis cuesta una llamada de API: nunca se dispara solo.
                  Requiere la clave de Anthropic del tenant; sin ella se
                  deshabilita y el aviso de arriba enlaza a Configuración. */}
              <button
                type="button"
                onClick={analyze}
                disabled={analyzing || lines.length === 0 || !analyzeReady || noLinesSelected}
                title={
                  !analyzeReady
                    ? "Configura tu clave de Anthropic en Configuración → IA para analizar"
                    : noLinesSelected
                    ? "Selecciona al menos una línea de negocio para analizar"
                    : undefined
                }
                className="px-4 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition"
                style={{ backgroundColor: "var(--color-primary)" }}
              >
                {analyzing
                  ? "Analizando..."
                  : `${lead.analyzed ? "Re-analizar" : "Analizar con IA"}${
                      selectedLineIds !== null && selectedSet.length !== lines.length ? ` (${selectedSet.length})` : ""
                    }`}
              </button>
            </div>
            <span className="text-xs text-neutral-400">
              {sourceLabel(lead.source)} · captado el {formatDate(lead.createdAt)}
            </span>
          </div>
        )}
      </header>

      {/* Elegir qué líneas analizar para esta empresa (solo si hay varias). */}
      {!editing && lines.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="text-xs text-neutral-400 mr-1">Líneas a analizar:</span>
          {lines.map((l) => {
            const on = isLineOn(l.id);
            return (
              <button
                key={l.id}
                type="button"
                aria-pressed={on}
                onClick={() => toggleLine(l.id)}
                className={`inline-flex items-center gap-1 max-w-full min-w-0 px-2.5 py-1 rounded-full text-xs border transition ${
                  on ? "border-transparent text-white" : "border-neutral-200 text-neutral-500 hover:bg-neutral-50"
                }`}
                style={on ? { backgroundColor: "var(--color-primary)" } : undefined}
              >
                {on && (
                  <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="w-3 h-3 shrink-0">
                    <path fillRule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0L3.3 9.7a1 1 0 011.4-1.4l3.3 3.3 6.8-6.8a1 1 0 011.4 0z" clipRule="evenodd" />
                  </svg>
                )}
                <span className="truncate">{l.name}</span>
              </button>
            );
          })}
          {noLinesSelected && <span className="text-xs text-amber-600">Selecciona al menos una</span>}
        </div>
      )}

      <IntegrationGate status={integrations} require={["anthropic", "resend"]} />

      {analyzeError && (
        <div className="mb-4 px-3 py-2 rounded-lg bg-rose-50 border border-rose-100 text-sm text-rose-700">
          {analyzeError}
        </div>
      )}

      {/* Modal: eliminar este lead. */}
      {showDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !actionBusy && setShowDelete(false)}
        >
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-[Fraunces] text-xl text-neutral-800">Eliminar «{lead.name}»</h3>
            <p className="text-sm text-neutral-600 mt-2">
              Esta acción no se puede deshacer. Se borrará el lead junto con sus contactos y análisis.
            </p>
            {actionError && <p className="text-sm text-red-600 mt-2">{actionError}</p>}
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setShowDelete(false)}
                disabled={actionBusy}
                className="px-4 py-2 rounded-lg border border-neutral-200 text-sm text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={doDelete}
                disabled={actionBusy}
                className="px-4 py-2 rounded-lg text-white text-sm font-medium bg-red-600 hover:bg-red-700 disabled:opacity-50"
              >
                {actionBusy ? "Eliminando..." : "Eliminar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: convertir en cliente. */}
      {showConvert && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !actionBusy && setShowConvert(false)}
        >
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-[Fraunces] text-xl text-neutral-800">Convertir «{lead.name}» en cliente</h3>
            <p className="text-sm text-neutral-600 mt-2">
              Se creará un cliente en el módulo de Clientes con estos datos. El lead saldrá de la lista de captados y
              no volverá a aparecer al buscar nuevos.
            </p>
            {actionError && <p className="text-sm text-red-600 mt-2">{actionError}</p>}
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setShowConvert(false)}
                disabled={actionBusy}
                className="px-4 py-2 rounded-lg border border-neutral-200 text-sm text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={doConvert}
                disabled={actionBusy}
                className="px-4 py-2 rounded-lg text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: "var(--color-primary)" }}
              >
                {actionBusy ? "Convirtiendo..." : "Convertir en cliente"}
              </button>
            </div>
          </div>
        </div>
      )}

      {lines.length === 0 ? (
        <div className="bg-white rounded-xl border border-neutral-200 p-8 text-center">
          <p className="text-sm text-neutral-600">Este tenant no tiene líneas de negocio definidas todavía.</p>
          <Link
            href="/outreach/configuracion"
            className="inline-block mt-3 text-sm font-medium hover:underline"
            style={{ color: "var(--color-primary)" }}
          >
            Configurar líneas de negocio →
          </Link>
        </div>
      ) : (
        <div className={`grid grid-cols-1 ${gridCols} gap-5 mb-6`}>
          {lines.map((line) => (
            <BusinessLinePanel
              key={line.id}
              leadId={leadId}
              line={line}
              analysis={analysisFor(lead, line.id)}
              recipients={recipients}
              onSent={refresh}
              emailReady={emailReady}
            />
          ))}
        </div>
      )}

      <section className="bg-white rounded-xl border border-neutral-200 p-5">
        <h2 className="font-[Fraunces] text-xl text-neutral-800 mb-1">Contactos</h2>
        <p className="text-xs text-neutral-500 mb-3">Los decisores aparecen primero.</p>
        <ContactsList contacts={lead.contacts} />
      </section>

      {lead.notes && (
        <section className="bg-white rounded-xl border border-neutral-200 p-5 mt-5">
          <h2 className="font-[Fraunces] text-xl text-neutral-800 mb-2">Notas</h2>
          <p className="text-sm text-neutral-700 whitespace-pre-wrap">{lead.notes}</p>
        </section>
      )}
    </div>
  );
}
