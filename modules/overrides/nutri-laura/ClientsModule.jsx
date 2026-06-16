"use client";

/**
 * ClientsModule (override nutri_laura) — ficha de paciente con secciones
 * reordenadas para flujo nutricionista:
 *   1. Cabecera con back link, nombre del paciente, edad/motivo del lead origen.
 *   2. Datos de contacto (modo vista/edición — reutiliza endpoints genéricos).
 *   3. Próximas citas (fetch /api/citas/bookings?clientEmail=&future=true).
 *   4. Documentos PDF (drop zone + lista + download/delete) — endpoint
 *      /api/clients/[id]/attachments.
 *   5. Notas internas timeline — endpoint /api/clients/[id]/notes.
 *   6. Historial de interacciones legacy — collapsible al final.
 *
 * El branding se inyecta vía CSS variables ya cargadas por el layout
 * del dashboard (var(--color-primary) = #A97873 en nutri_laura).
 */

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

const STATUSES = [
  { key: "new", label: "Nuevo" },
  { key: "contacted", label: "Contactado" },
  { key: "following", label: "En seguimiento" },
  { key: "converted", label: "Paciente activo" },
  { key: "discarded", label: "Descartado" },
];

const STATUS_STYLE = {
  new: { dot: "bg-gray-400", bg: "bg-gray-100 text-gray-600" },
  contacted: { dot: "bg-blue-400", bg: "bg-blue-100 text-blue-700" },
  following: { dot: "bg-amber-400", bg: "bg-amber-100 text-amber-700" },
  converted: { dot: "bg-emerald-400", bg: "bg-emerald-100 text-emerald-700" },
  discarded: { dot: "bg-red-400", bg: "bg-red-100 text-red-600" },
};

const MAX_ATTACHMENTS = 50;
const MAX_FILE_MB = 10;

function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
function fmtDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-ES", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function fmtRelative(iso) {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "ahora mismo";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  if (d === 1) return "hace 1 día";
  if (d < 30) return `hace ${d} días`;
  const months = Math.floor(d / 30);
  return months === 1 ? "hace 1 mes" : `hace ${months} meses`;
}
function fmtBytes(bytes) {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function NutriLauraClientsModule() {
  const { id } = useParams();
  const router = useRouter();
  const [client, setClient] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    fetch(`/api/clients/${id}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) setClient(j.data);
      })
      .finally(() => setLoading(false));
  }, [id]);

  function openEdit() {
    setEditForm({
      name: client.name || "",
      email: client.email || "",
      phone: client.phone || "",
      notes: client.notes || "",
      status: client.customFields?.seStatus || "new",
      edad: client.customFields?.edad || "",
      motivo: client.customFields?.motivo || "",
      info_adicional: client.customFields?.info_adicional || "",
    });
    setEditMode(true);
  }

  async function saveEdit() {
    setSaving(true);
    try {
      const res = await fetch(`/api/clients/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });
      const j = await res.json();
      if (j.ok) {
        setClient(j.data);
        setEditMode(false);
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    await fetch(`/api/clients/${id}`, { method: "DELETE" });
    router.push("/clientes");
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-6 h-6 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!client) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-gray-500">Paciente no encontrado</p>
        <Link href="/clientes" className="text-[var(--color-primary)] hover:underline text-sm">
          ← Volver a pacientes
        </Link>
      </div>
    );
  }

  const status = client.customFields?.seStatus || "new";
  const st = STATUS_STYLE[status] ?? STATUS_STYLE.new;
  const edad = client.customFields?.edad;
  const motivo = client.customFields?.motivo;
  const infoAdicional = client.customFields?.info_adicional;

  return (
    <div className="flex flex-col h-full bg-[var(--color-accent,#F7F1EB)]/40">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="px-4 lg:px-8 pt-6 pb-4 border-b border-gray-100 bg-white">
        <div className="flex items-center gap-3 mb-1">
          <Link href="/clientes" className="text-gray-400 hover:text-gray-600 transition-colors">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
            </svg>
          </Link>
          <h1 className="text-gray-900 text-lg font-semibold">{client.name}</h1>
          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${st.bg}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
            {STATUSES.find((s) => s.key === status)?.label ?? status}
          </span>
        </div>
        <div className="ml-7 flex flex-wrap gap-3 text-xs text-gray-500">
          {edad && <span>Edad: <strong className="text-gray-700">{edad}</strong></span>}
          {client.email && <a href={`mailto:${client.email}`} className="hover:text-[var(--color-primary)]">{client.email}</a>}
          {client.phone && <a href={`tel:${client.phone}`} className="hover:text-[var(--color-primary)]">{client.phone}</a>}
        </div>
      </div>

      {/* ── Body ────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto px-4 lg:px-8 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 max-w-6xl">
          {/* Columna izquierda — datos paciente */}
          <div className="lg:col-span-1 space-y-6">
            <PatientCard
              client={client}
              editMode={editMode}
              editForm={editForm}
              setEditForm={setEditForm}
              onEdit={openEdit}
              onSave={saveEdit}
              onCancel={() => setEditMode(false)}
              saving={saving}
              motivo={motivo}
              infoAdicional={infoAdicional}
            />

            {/* Eliminar paciente — al final, en rojo discreto */}
            {!confirmDelete ? (
              <button
                onClick={() => setConfirmDelete(true)}
                className="w-full text-xs text-red-400 hover:text-red-600 transition-colors py-1.5"
              >
                Eliminar paciente
              </button>
            ) : (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 space-y-2">
                <p className="text-xs text-red-700 font-medium">¿Eliminar a {client.name}? Esto borra también sus archivos y notas.</p>
                <div className="flex gap-2">
                  <button onClick={() => setConfirmDelete(false)} className="flex-1 bg-white text-gray-700 border border-gray-200 text-xs font-medium py-1.5 rounded-md hover:bg-gray-50">Cancelar</button>
                  <button onClick={handleDelete} className="flex-1 bg-red-600 text-white text-xs font-semibold py-1.5 rounded-md hover:bg-red-700">Sí, eliminar</button>
                </div>
              </div>
            )}
          </div>

          {/* Columna central + derecha */}
          <div className="lg:col-span-2 space-y-6">
            <UpcomingBookingsSection clientEmail={client.email} />
            <AttachmentsSection clientId={id} />
            <NotesSection clientId={id} />
            <InteractionsLegacySection interactions={client.interactions ?? []} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── PatientCard ───────────────────────────────────────────────────────────────

function PatientCard({ client, editMode, editForm, setEditForm, onEdit, onSave, onCancel, saving, motivo, infoAdicional }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
        <span className="text-sm font-semibold text-gray-700">Datos del paciente</span>
        {editMode ? (
          <div className="flex items-center gap-2">
            <button onClick={onSave} disabled={saving} className="bg-[var(--color-primary)] hover:opacity-90 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-opacity disabled:opacity-50">
              {saving ? "Guardando…" : "Guardar"}
            </button>
            <button onClick={onCancel} className="text-xs text-gray-500 hover:text-gray-700 border border-gray-200 px-3 py-1.5 rounded-lg">Cancelar</button>
          </div>
        ) : (
          <button onClick={onEdit} className="text-xs text-gray-600 hover:text-gray-900 border border-gray-200 hover:border-gray-300 px-3 py-1.5 rounded-lg">Editar</button>
        )}
      </div>

      {editMode ? (
        <div className="p-5 space-y-3">
          {[
            { label: "Nombre", key: "name", type: "text" },
            { label: "Email", key: "email", type: "email" },
            { label: "Teléfono", key: "phone", type: "tel" },
            { label: "Edad", key: "edad", type: "text" },
          ].map(({ label, key, type }) => (
            <div key={key}>
              <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">{label}</label>
              <input
                type={type}
                value={editForm[key] || ""}
                onChange={(e) => setEditForm((f) => ({ ...f, [key]: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)]"
              />
            </div>
          ))}
          <div>
            <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Motivo de la consulta</label>
            <textarea rows={2} value={editForm.motivo || ""} onChange={(e) => setEditForm((f) => ({ ...f, motivo: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)] resize-none" />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Información adicional</label>
            <textarea rows={3} value={editForm.info_adicional || ""} onChange={(e) => setEditForm((f) => ({ ...f, info_adicional: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)] resize-none" />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Estado</label>
            <div className="flex flex-wrap gap-1.5">
              {STATUSES.map((s) => (
                <button key={s.key} onClick={() => setEditForm((f) => ({ ...f, status: s.key }))}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${editForm.status === s.key ? `${STATUS_STYLE[s.key].bg} border-transparent` : "bg-white border-gray-200 text-gray-500 hover:border-gray-300"}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${STATUS_STYLE[s.key].dot}`} />
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="p-5 space-y-3 text-sm">
          {motivo && (
            <div>
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Motivo de la consulta</div>
              <div className="text-gray-700 whitespace-pre-wrap leading-relaxed">{motivo}</div>
            </div>
          )}
          {infoAdicional && (
            <div>
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Info adicional</div>
              <div className="text-gray-700 whitespace-pre-wrap leading-relaxed">{infoAdicional}</div>
            </div>
          )}
          {client.notes && (
            <div>
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Notas rápidas</div>
              <div className="text-gray-600 whitespace-pre-wrap leading-relaxed">{client.notes}</div>
            </div>
          )}
          <div className="pt-2 border-t border-gray-50 text-xs text-gray-400">
            Alta: {fmtDate(client.createdAt)}
          </div>
        </div>
      )}
    </div>
  );
}

// ── UpcomingBookingsSection ───────────────────────────────────────────────────

function UpcomingBookingsSection({ clientEmail }) {
  const [bookings, setBookings] = useState([]);
  // Loading arranca true solo si vamos a hacer fetch — evita
  // setState-en-effect cuando no hay email.
  const [loading, setLoading] = useState(!!clientEmail);

  useEffect(() => {
    if (!clientEmail) return;
    const params = new URLSearchParams({
      clientEmail,
      future: "true",
      limit: "10",
    });
    fetch(`/api/citas/bookings?${params}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) setBookings(j.data.bookings ?? []);
      })
      .finally(() => setLoading(false));
  }, [clientEmail]);

  if (!clientEmail) return null;

  return (
    <SectionCard title="Próximas citas">
      {loading ? (
        <div className="px-5 py-6 text-center text-xs text-gray-400">Cargando…</div>
      ) : bookings.length === 0 ? (
        <div className="px-5 py-6 text-center text-xs text-gray-400">
          Sin citas futuras programadas.
        </div>
      ) : (
        <ul className="divide-y divide-gray-50">
          {bookings.map((b) => (
            <li key={b.id} className="px-5 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium text-gray-900 truncate">{b.eventType?.name ?? "Cita"}</div>
                <div className="text-xs text-gray-500">{fmtDateTime(b.scheduledAt)} · {b.duration} min</div>
              </div>
              <StatusChip status={b.status} />
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function StatusChip({ status }) {
  const map = {
    pending: { bg: "bg-amber-50 text-amber-700 border-amber-100", label: "Pendiente" },
    confirmed: { bg: "bg-emerald-50 text-emerald-700 border-emerald-100", label: "Confirmada" },
    completed: { bg: "bg-slate-100 text-slate-700 border-slate-200", label: "Realizada" },
    cancelled: { bg: "bg-neutral-100 text-neutral-500 border-neutral-200", label: "Cancelada" },
    no_show: { bg: "bg-violet-50 text-violet-700 border-violet-100", label: "No asistió" },
  };
  const cls = map[status] ?? map.pending;
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium border whitespace-nowrap ${cls.bg}`}>
      {cls.label}
    </span>
  );
}

// ── AttachmentsSection ────────────────────────────────────────────────────────

function AttachmentsSection({ clientId }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const reload = useCallback(() => {
    setLoading(true);
    fetch(`/api/clients/${clientId}/attachments`)
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) setItems(j.data.attachments ?? []);
      })
      .finally(() => setLoading(false));
  }, [clientId]);

  useEffect(() => { reload(); }, [reload]);

  async function handleFile(file) {
    setError(null);
    if (!file) return;
    if (file.type !== "application/pdf") {
      setError(`Solo PDF (recibido: ${file.type || "?"})`);
      return;
    }
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      setError(`Demasiado grande (${(file.size / (1024 * 1024)).toFixed(1)} MB > ${MAX_FILE_MB} MB)`);
      return;
    }
    if (items.length >= MAX_ATTACHMENTS) {
      setError(`Límite alcanzado: ${MAX_ATTACHMENTS} archivos por paciente`);
      return;
    }

    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(`/api/clients/${clientId}/attachments`, { method: "POST", body: fd });
      const j = await r.json();
      if (!j.ok) {
        setError(j.error || "Error al subir");
        return;
      }
      reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(att) {
    setConfirmDelete(null);
    const r = await fetch(`/api/clients/${clientId}/attachments/${att.id}`, { method: "DELETE" });
    if (r.ok || r.status === 204) reload();
  }

  return (
    <SectionCard
      title="Documentos"
      subtitle={`${items.length}/${MAX_ATTACHMENTS} · PDF, máx ${MAX_FILE_MB} MB`}
    >
      <div className="p-5 space-y-3">
        {/* Drop zone */}
        <label
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files?.[0]); }}
          className={`flex items-center justify-center gap-3 px-4 py-6 border-2 border-dashed rounded-xl cursor-pointer transition-colors ${
            dragOver
              ? "border-[var(--color-primary)] bg-[var(--color-accent,#F7F1EB)]/40"
              : "border-gray-200 hover:border-gray-300 bg-gray-50/50"
          }`}
        >
          <input
            type="file"
            accept="application/pdf"
            className="sr-only"
            onChange={(e) => handleFile(e.target.files?.[0])}
            disabled={uploading || items.length >= MAX_ATTACHMENTS}
          />
          {uploading ? (
            <div className="text-xs text-gray-500 flex items-center gap-2">
              <span className="w-3 h-3 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />
              Subiendo…
            </div>
          ) : (
            <div className="text-center">
              <div className="text-sm text-gray-600">Arrastra un PDF o haz clic para subir</div>
              <div className="text-[11px] text-gray-400 mt-0.5">Máximo {MAX_FILE_MB} MB</div>
            </div>
          )}
        </label>

        {error && (
          <div className="px-3 py-2 bg-red-50 border border-red-100 rounded-md text-xs text-red-700">{error}</div>
        )}

        {/* Lista */}
        {loading ? (
          <div className="py-4 text-center text-xs text-gray-400">Cargando…</div>
        ) : items.length === 0 ? (
          <div className="py-4 text-center text-xs text-gray-400">Sin documentos.</div>
        ) : (
          <ul className="divide-y divide-gray-50">
            {items.map((a) => (
              <li key={a.id} className="py-2.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-md bg-red-50 text-red-600 flex items-center justify-center shrink-0">
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M6 2h7l5 5v15a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm7 1.5V8h4.5L13 3.5z" /></svg>
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-800 truncate">{a.originalName}</div>
                    <div className="text-[11px] text-gray-400">{fmtBytes(a.fileSize)} · {fmtRelative(a.createdAt)}{a.uploadedBy ? ` · ${a.uploadedBy}` : ""}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <a
                    href={`/api/clients/${clientId}/attachments/${a.id}/download`}
                    className="text-[11px] font-semibold text-[var(--color-primary)] hover:underline"
                  >
                    Descargar
                  </a>
                  {confirmDelete === a.id ? (
                    <>
                      <button onClick={() => handleDelete(a)} className="text-[11px] font-semibold text-red-600 hover:underline">Confirmar</button>
                      <button onClick={() => setConfirmDelete(null)} className="text-[11px] text-gray-400 hover:text-gray-600">Cancelar</button>
                    </>
                  ) : (
                    <button onClick={() => setConfirmDelete(a.id)} className="text-[11px] text-gray-400 hover:text-red-600">Borrar</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </SectionCard>
  );
}

// ── NotesSection ──────────────────────────────────────────────────────────────

function NotesSection({ clientId }) {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const reload = useCallback(() => {
    setLoading(true);
    fetch(`/api/clients/${clientId}/notes`)
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) setNotes(j.data.notes ?? []);
      })
      .finally(() => setLoading(false));
  }, [clientId]);

  useEffect(() => { reload(); }, [reload]);

  async function add() {
    if (!content.trim()) return;
    setSaving(true);
    try {
      const r = await fetch(`/api/clients/${clientId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: content.trim() }),
      });
      const j = await r.json();
      if (j.ok) {
        setContent("");
        reload();
      }
    } finally {
      setSaving(false);
    }
  }

  async function del(noteId) {
    setConfirmDelete(null);
    const r = await fetch(`/api/clients/${clientId}/notes/${noteId}`, { method: "DELETE" });
    if (r.ok || r.status === 204) reload();
  }

  return (
    <SectionCard
      title="Notas internas"
      subtitle="Privadas — no visibles para el paciente"
    >
      <div className="p-5 space-y-4">
        {/* Form */}
        <div>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={2}
            placeholder="Escribe una nota interna…"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)] resize-none"
          />
          <div className="flex justify-end mt-2">
            <button
              onClick={add}
              disabled={!content.trim() || saving}
              className="bg-[var(--color-primary)] hover:opacity-90 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-opacity disabled:opacity-40"
            >
              {saving ? "Guardando…" : "Añadir nota"}
            </button>
          </div>
        </div>

        {/* Timeline */}
        {loading ? (
          <div className="py-4 text-center text-xs text-gray-400">Cargando…</div>
        ) : notes.length === 0 ? (
          <div className="py-4 text-center text-xs text-gray-400">Sin notas registradas.</div>
        ) : (
          <ul className="divide-y divide-gray-50 -mx-5">
            {notes.map((n) => (
              <li key={n.id} className="px-5 py-3">
                <div className="flex items-center gap-2 mb-1 text-xs text-gray-400">
                  <span>{fmtRelative(n.createdAt)}</span>
                  <span>·</span>
                  <span>{fmtDate(n.createdAt)}</span>
                  {n.createdBy && (<><span>·</span><span>{n.createdBy}</span></>)}
                  <span className="flex-1" />
                  {confirmDelete === n.id ? (
                    <>
                      <button onClick={() => del(n.id)} className="text-[11px] font-semibold text-red-600 hover:underline">Confirmar</button>
                      <button onClick={() => setConfirmDelete(null)} className="text-[11px] text-gray-400 hover:text-gray-600">Cancelar</button>
                    </>
                  ) : (
                    <button onClick={() => setConfirmDelete(n.id)} className="text-[11px] text-gray-400 hover:text-red-500">Borrar</button>
                  )}
                </div>
                <div className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{n.content}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </SectionCard>
  );
}

// ── InteractionsLegacySection (collapsible) ───────────────────────────────────

function InteractionsLegacySection({ interactions }) {
  const [open, setOpen] = useState(false);
  if (!interactions || interactions.length === 0) return null;

  return (
    <SectionCard
      title="Historial de interacciones"
      subtitle={`${interactions.length} registro${interactions.length === 1 ? "" : "s"} (legacy)`}
      action={
        <button onClick={() => setOpen((v) => !v)} className="text-[11px] font-semibold text-gray-500 hover:text-gray-800">
          {open ? "Ocultar" : "Mostrar"}
        </button>
      }
    >
      {open && (
        <ul className="divide-y divide-gray-50">
          {interactions.map((i) => (
            <li key={i.id} className="px-5 py-3">
              <div className="flex items-center gap-2 text-xs text-gray-400 mb-1">
                <span className="font-medium text-gray-600">{i.type}</span>
                <span>{fmtDate(i.date)}</span>
                {i.createdBy && <span>· {i.createdBy}</span>}
              </div>
              <div className="text-sm text-gray-700 whitespace-pre-wrap">{i.content}</div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

// ── SectionCard helper ────────────────────────────────────────────────────────

function SectionCard({ title, subtitle, action, children }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
        <div>
          <div className="text-sm font-semibold text-gray-700">{title}</div>
          {subtitle && <div className="text-[11px] text-gray-400 mt-0.5">{subtitle}</div>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}
