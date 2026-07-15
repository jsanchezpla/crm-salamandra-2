"use client";

/**
 * ClientDetailModule (override nutri_laura) — ficha de paciente con tabs.
 *
 * Tabs:
 *   1. Información — PatientCard editable inline + historial legacy collapsible.
 *   2. Notas — timeline interno (ClientNotesPanel).
 *   3. Adjuntos — PDFs del paciente (ClientAttachmentsPanel).
 *   4. Citas — bookings del paciente con confirm/reject (ClientBookingsPanel).
 *
 * Decisiones clave:
 *   - editMode + editForm viven en este componente padre, NO en PatientCard.
 *     Cambiar de tab desmonta InfoTab pero el state sobrevive aquí, así que
 *     al volver a Información los inputs reaparecen con lo que el usuario
 *     tenía escrito (regla #1 del Checkpoint 3: no romper edición inline).
 *   - InteractionsLegacySection archivado a `_InteractionsLegacySection.jsx`:
 *     la tabla `interactions` no existe en crm_nutri_laura, así que la sección
 *     se quitó del render. El backend tolera la tabla missing (try/catch en
 *     GET /api/clients/:id) y otros tenants siguen recibiendo el array para
 *     su default module.
 *   - Permisos: gate por `me.role ∈ {admin, superadmin, employee}` antes
 *     de pintar el detalle. Sin rol válido → mensaje "Sin acceso".
 *
 * Endpoints usados directamente:
 *   - GET    /api/auth/me
 *   - GET    /api/clients/:id
 *   - PUT    /api/clients/:id
 *   - DELETE /api/clients/:id
 *
 * El branding sale de CSS vars inyectadas por el layout del dashboard
 * (var(--color-primary) = #A97873 en nutri_laura).
 */

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

import ClientNotesPanel from "./ClientNotesPanel.jsx";
import ClientAttachmentsPanel from "./ClientAttachmentsPanel.jsx";
import ClientBookingsPanel from "./ClientBookingsPanel.jsx";
import ClientPlansPanel from "./ClientPlansPanel.jsx";
import ClientModulesSection from "../../../components/clients/ClientModulesSection.jsx";

const TABS = [
  { key: "info", label: "Información" },
  { key: "notes", label: "Notas" },
  { key: "attachments", label: "Adjuntos" },
  { key: "bookings", label: "Citas" },
  // Tab "Plan" añadida en Sprint Recetario C4. Solo visible en nutri_laura.
  { key: "plan", label: "Plan" },
];

const ROLES_WITH_ACCESS = new Set(["admin", "superadmin", "employee"]);

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

function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function NutriLauraClientDetailModule() {
  const { id } = useParams();
  const router = useRouter();

  const [me, setMe] = useState(null);
  const [meLoading, setMeLoading] = useState(true);

  const [client, setClient] = useState(null);
  const [loadingClient, setLoadingClient] = useState(true);
  const [clientError, setClientError] = useState(null);

  const [tab, setTab] = useState("info");

  // Edición inline en el padre — preserva state al cambiar tabs.
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Permisos
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((j) => setMe(j?.ok ? j.data : null))
      .catch(() => setMe(null))
      .finally(() => setMeLoading(false));
  }, []);

  // Cliente
  const loadClient = useCallback(() => {
    setLoadingClient(true);
    setClientError(null);
    fetch(`/api/clients/${id}`)
      .then((r) => r.json())
      .then((j) => {
        if (!j?.ok) throw new Error(j?.error || "Error al cargar el paciente");
        setClient(j.data);
      })
      .catch((e) => setClientError(e.message))
      .finally(() => setLoadingClient(false));
  }, [id]);

  useEffect(() => { loadClient(); }, [loadClient]);

  function openEdit() {
    if (!client) return;
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
    setEditError(null);
    setEditMode(true);
  }

  function cancelEdit() {
    setEditMode(false);
    setEditError(null);
  }

  async function saveEdit() {
    setSaving(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/clients/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });
      const j = await res.json();
      if (!j?.ok) {
        setEditError(j?.error || `Error al guardar (HTTP ${res.status})`);
        return;
      }
      setClient(j.data);
      setEditMode(false);
    } catch (e) {
      setEditError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    await fetch(`/api/clients/${id}`, { method: "DELETE" });
    router.push("/clientes");
  }

  // ── Render gates ──────────────────────────────────────────────────────────
  if (meLoading || loadingClient) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-6 h-6 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!me || !ROLES_WITH_ACCESS.has(me.role)) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 px-4 text-center">
        <div className="text-2xl">🔒</div>
        <p className="text-gray-500 text-sm">No tienes acceso a esta ficha.</p>
        <Link href="/" className="text-[var(--color-primary)] hover:underline text-sm">
          ← Volver al dashboard
        </Link>
      </div>
    );
  }

  if (clientError) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 px-4 text-center">
        <p className="text-red-600 text-sm">No se pudo cargar el paciente:</p>
        <p className="text-xs text-gray-500">{clientError}</p>
        <div className="flex gap-2 mt-2">
          <button
            onClick={loadClient}
            className="text-xs font-semibold text-white px-3 py-1.5 rounded-lg hover:opacity-90"
            style={{ background: "var(--color-primary)" }}
          >
            Reintentar
          </button>
          <Link
            href="/clientes"
            className="text-xs text-gray-600 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50"
          >
            Volver
          </Link>
        </div>
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
  // leadId puede venir como client.leadId (modelo) o como customFields.leadId
  // (compat de overrides antiguos) — soportamos los dos.
  const leadId = client.leadId ?? client.customFields?.leadId ?? null;

  return (
    <div className="flex flex-col h-full bg-[var(--color-accent,#F7F1EB)]/40">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="px-4 lg:px-8 pt-6 pb-4 border-b border-gray-100 bg-white">
        <div className="flex items-center gap-3 mb-1 flex-wrap">
          <Link
            href="/clientes"
            className="text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Volver a pacientes"
          >
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
          {client.email && (
            <a href={`mailto:${client.email}`} className="hover:text-[var(--color-primary)]">
              {client.email}
            </a>
          )}
          {client.phone && (
            <a href={`tel:${client.phone}`} className="hover:text-[var(--color-primary)]">
              {client.phone}
            </a>
          )}
          {leadId && (
            <Link
              href={`/leads?focus=${encodeURIComponent(leadId)}`}
              className="hover:text-[var(--color-primary)] underline-offset-2 hover:underline"
              title="Ver lead origen"
            >
              ↳ Lead origen
            </Link>
          )}
        </div>
      </div>

      {/* ── Tabs ───────────────────────────────────────────────────────────── */}
      <div className="border-b border-gray-100 bg-white">
        <div className="px-4 lg:px-8 flex items-center gap-1 overflow-x-auto whitespace-nowrap">
          {TABS.map((t) => (
            <TabButton
              key={t.key}
              active={tab === t.key}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </TabButton>
          ))}
        </div>
      </div>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto px-4 lg:px-8 py-6">
        {tab === "info" && (
          <InfoTab
            client={client}
            motivo={motivo}
            infoAdicional={infoAdicional}
            editMode={editMode}
            editForm={editForm}
            setEditForm={setEditForm}
            onEdit={openEdit}
            onSave={saveEdit}
            onCancel={cancelEdit}
            saving={saving}
            editError={editError}
            confirmDelete={confirmDelete}
            setConfirmDelete={setConfirmDelete}
            onDelete={handleDelete}
          />
        )}

        {tab === "notes" && <ClientNotesPanel clientId={id} />}

        {tab === "attachments" && <ClientAttachmentsPanel clientId={id} />}

        {tab === "bookings" && (
          <ClientBookingsPanel
            clientEmail={client.email}
            userRole={me.role}
          />
        )}

        {tab === "plan" && <ClientPlansPanel clientId={id} />}
      </div>
    </div>
  );
}

// ── TabButton ────────────────────────────────────────────────────────────────

function TabButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-sm font-semibold px-3 lg:px-4 py-3 border-b-2 transition-colors shrink-0 ${
        active
          ? "border-[var(--color-primary)] text-gray-900"
          : "border-transparent text-gray-400 hover:text-gray-700"
      }`}
    >
      {children}
    </button>
  );
}

// ── InfoTab ──────────────────────────────────────────────────────────────────

function InfoTab({
  client,
  motivo,
  infoAdicional,
  editMode,
  editForm,
  setEditForm,
  onEdit,
  onSave,
  onCancel,
  saving,
  editError,
  confirmDelete,
  setConfirmDelete,
  onDelete,
}) {
  return (
    <div className="max-w-lg space-y-6">
      <PatientCard
        client={client}
        editMode={editMode}
        editForm={editForm}
        setEditForm={setEditForm}
        onEdit={onEdit}
        onSave={onSave}
        onCancel={onCancel}
        saving={saving}
        editError={editError}
        motivo={motivo}
        infoAdicional={infoAdicional}
      />

      <ClientModulesSection clientId={client.id} />

      {!confirmDelete ? (
        <button
          onClick={() => setConfirmDelete(true)}
          className="w-full text-xs text-red-400 hover:text-red-600 transition-colors py-1.5"
        >
          Eliminar paciente
        </button>
      ) : (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 space-y-2">
          <p className="text-xs text-red-700 font-medium">
            ¿Eliminar a {client.name}? Esto borra también sus archivos y notas.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setConfirmDelete(false)}
              className="flex-1 bg-white text-gray-700 border border-gray-200 text-xs font-medium py-1.5 rounded-md hover:bg-gray-50"
            >
              Cancelar
            </button>
            <button
              onClick={onDelete}
              className="flex-1 bg-red-600 text-white text-xs font-semibold py-1.5 rounded-md hover:bg-red-700"
            >
              Sí, eliminar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── PatientCard ──────────────────────────────────────────────────────────────

function PatientCard({
  client,
  editMode,
  editForm,
  setEditForm,
  onEdit,
  onSave,
  onCancel,
  saving,
  editError,
  motivo,
  infoAdicional,
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
        <span className="text-sm font-semibold text-gray-700">Datos del paciente</span>
        {editMode ? (
          <div className="flex items-center gap-2">
            <button
              onClick={onSave}
              disabled={saving}
              className="bg-[var(--color-primary)] hover:opacity-90 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-opacity disabled:opacity-50"
            >
              {saving ? "Guardando…" : "Guardar"}
            </button>
            <button
              onClick={onCancel}
              className="text-xs text-gray-500 hover:text-gray-700 border border-gray-200 px-3 py-1.5 rounded-lg"
            >
              Cancelar
            </button>
          </div>
        ) : (
          <button
            onClick={onEdit}
            className="text-xs text-gray-600 hover:text-gray-900 border border-gray-200 hover:border-gray-300 px-3 py-1.5 rounded-lg"
          >
            Editar
          </button>
        )}
      </div>

      {editMode ? (
        <div className="p-5 space-y-3">
          {editError && (
            <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-md text-xs text-red-700">
              {editError}
            </div>
          )}
          {[
            { label: "Nombre", key: "name", type: "text" },
            { label: "Email", key: "email", type: "email" },
            { label: "Teléfono", key: "phone", type: "tel" },
            { label: "Edad", key: "edad", type: "text" },
          ].map(({ label, key, type }) => (
            <div key={key}>
              <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
                {label}
              </label>
              <input
                type={type}
                value={editForm[key] || ""}
                onChange={(e) => setEditForm((f) => ({ ...f, [key]: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)]"
              />
            </div>
          ))}
          <div>
            <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
              Motivo de la consulta
            </label>
            <textarea
              rows={2}
              value={editForm.motivo || ""}
              onChange={(e) => setEditForm((f) => ({ ...f, motivo: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)] resize-none"
            />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
              Información adicional
            </label>
            <textarea
              rows={3}
              value={editForm.info_adicional || ""}
              onChange={(e) => setEditForm((f) => ({ ...f, info_adicional: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)] resize-none"
            />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
              Estado
            </label>
            <div className="flex flex-wrap gap-1.5">
              {STATUSES.map((s) => (
                <button
                  key={s.key}
                  onClick={() => setEditForm((f) => ({ ...f, status: s.key }))}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                    editForm.status === s.key
                      ? `${STATUS_STYLE[s.key].bg} border-transparent`
                      : "bg-white border-gray-200 text-gray-500 hover:border-gray-300"
                  }`}
                >
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
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
                Motivo de la consulta
              </div>
              <div className="text-gray-700 whitespace-pre-wrap leading-relaxed">{motivo}</div>
            </div>
          )}
          {infoAdicional && (
            <div>
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
                Info adicional
              </div>
              <div className="text-gray-700 whitespace-pre-wrap leading-relaxed">{infoAdicional}</div>
            </div>
          )}
          {client.notes && (
            <div>
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
                Notas rápidas
              </div>
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

