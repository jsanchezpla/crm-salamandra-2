"use client";

// modules/overrides/nutri-laura/LeadsDetailPanel.jsx — el panel lateral de un
// interesado en el embudo de Laura: datos de contacto, UTM, cambio de etapa y
// conversión a paciente. Pieza del override LeadsModule.jsx, solo de
// nutri_laura. Las etapas y sus colores viven en LeadsModule.jsx (la prueba
// de etapas los lee de allí).

// ─── Panel de detalle ─────────────────────────────────────────────────────────


import { useEffect, useState } from "react";
import { STAGES, STAGE_STYLE, formatDate } from "./LeadsModule.jsx";
export function LeadDetailPanel({
  lead,
  open,
  saving,
  converting,
  convertDone,
  onClose,
  onStageChange,
  onSave,
  onNotesChange,
  onDelete,
  onConvert,
}) {
  const [notes, setNotes] = useState("");
  const [notesDirty, setNotesDirty] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState({});

  useEffect(() => {
    if (lead) {
      setNotes(lead.notes ?? "");
      setNotesDirty(false);
      setConfirmDelete(false);
      setEditMode(false);
    }
  }, [lead?.id]);

  function openEdit() {
    setEditForm({
      name: lead.name || "",
      phone: lead.phone || "",
      email: lead.email || "",
      edad: lead.customFields?.edad || "",
      motivo: lead.customFields?.motivo || "",
      info_adicional: lead.customFields?.info_adicional || "",
    });
    setEditMode(true);
  }

  async function saveEdit() {
    const updates = {
      name: editForm.name.trim() || null,
      phone: editForm.phone.trim() || null,
      email: editForm.email.trim() || null,
      customFields: {
        edad: editForm.edad.trim() || null,
        motivo: editForm.motivo.trim() || null,
        info_adicional: editForm.info_adicional.trim() || null,
      },
    };
    const ok = await onSave(lead.id, updates);
    if (ok) setEditMode(false);
  }

  async function saveNotes() {
    await onNotesChange(lead.id, notes);
    setNotesDirty(false);
  }

  if (!lead) return null;

  const edad = lead.customFields?.edad;
  const motivo = lead.customFields?.motivo;
  const infoAdicional = lead.customFields?.info_adicional;
  const utmSource = lead.customFields?.utmSource;
  const utmMedium = lead.customFields?.utmMedium;
  const utmCampaign = lead.customFields?.utmCampaign;

  return (
    <div
      className={`fixed top-14 lg:top-0 right-0 bottom-0 lg:h-full w-full lg:w-[440px] bg-white border-l border-gray-200 shadow-2xl flex flex-col z-40 transition-transform duration-300 ${
        open ? "translate-x-0" : "translate-x-full"
      }`}
    >
      {/* Header panel */}
      <div className="px-5 pt-5 pb-4 border-b border-gray-100 flex items-start justify-between gap-4 border-t-[3px] border-t-[var(--color-primary)]">
        <div className="min-w-0">
          <h2 className="text-gray-900 font-semibold text-base truncate">
            {lead.name || lead.title || "Sin nombre"}
          </h2>
          <p className="text-gray-400 text-xs mt-0.5">{formatDate(lead.createdAt)}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0 mt-0.5">
          {!editMode && (
            <button
              onClick={openEdit}
              title="Editar lead"
              className="text-gray-400 hover:text-gray-700 transition-colors"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                className="w-4 h-4"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10"
                />
              </svg>
            </button>
          )}
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              className="w-5 h-5"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {editMode ? (
        /* ── Modo edición ── */
        <div className="flex-1 overflow-y-auto px-5 py-5">
          <div className="space-y-4">
            <div>
              <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                Nombre
              </label>
              <input
                type="text"
                value={editForm.name}
                onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:border-[var(--color-primary)] transition-colors"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                Teléfono
              </label>
              <input
                type="tel"
                value={editForm.phone}
                onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))}
                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:border-[var(--color-primary)] transition-colors"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                Email
              </label>
              <input
                type="email"
                value={editForm.email}
                onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:border-[var(--color-primary)] transition-colors"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                Edad
              </label>
              <input
                type="text"
                value={editForm.edad}
                onChange={(e) => setEditForm((f) => ({ ...f, edad: e.target.value }))}
                placeholder="Ej. 34, 'menor de edad'…"
                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:border-[var(--color-primary)] transition-colors"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                ¿Qué te gustaría trabajar en el proceso conmigo?
              </label>
              <textarea
                value={editForm.motivo}
                onChange={(e) => setEditForm((f) => ({ ...f, motivo: e.target.value }))}
                rows={3}
                placeholder="Objetivo o motivo de la consulta"
                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:border-[var(--color-primary)] transition-colors resize-none"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
                ¿Algo más que deba saber?
              </label>
              <textarea
                value={editForm.info_adicional}
                onChange={(e) => setEditForm((f) => ({ ...f, info_adicional: e.target.value }))}
                rows={3}
                placeholder="Intolerancias, alergias, condiciones médicas…"
                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:border-[var(--color-primary)] transition-colors resize-none"
              />
            </div>
          </div>
          <div className="flex gap-2 mt-6">
            <button
              onClick={saveEdit}
              disabled={saving}
              className="flex-1 bg-[var(--color-primary)] hover:opacity-90 text-white text-sm font-semibold py-2.5 rounded-lg transition-opacity disabled:opacity-50"
            >
              {saving ? "Guardando…" : "Guardar cambios"}
            </button>
            <button
              onClick={() => setEditMode(false)}
              className="px-4 bg-white border border-gray-200 text-gray-600 text-sm font-medium py-2.5 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        /* ── Modo vista ── */
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
          {/* Estado */}
          <div>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">
              Estado
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {STAGES.map((s) => {
                const isActive = lead.stage === s.key;
                const style = STAGE_STYLE[s.key];
                return (
                  <button
                    key={s.key}
                    disabled={saving}
                    onClick={() => onStageChange(lead.id, s.key)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border transition-colors disabled:opacity-50 ${
                      isActive
                        ? "border-[var(--color-primary)] bg-green-50 text-green-700"
                        : "border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-700 bg-white"
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${style.dot}`} />
                    {s.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Contacto */}
          <div>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-3">
              Contacto
            </p>
            <div className="space-y-2.5">
              <DetailRow
                icon="phone"
                label="Teléfono"
                value={lead.phone}
                href={`tel:${lead.phone}`}
              />
              <DetailRow
                icon="email"
                label="Email"
                value={lead.email}
                href={`mailto:${lead.email}`}
              />
              <DetailRow icon="user" label="Edad" value={edad} />
            </div>
          </div>

          {/* Cuestionario */}
          <div>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-3">
              Cuestionario
            </p>
            <div className="space-y-3">
              <div>
                <p className="text-[11px] text-gray-400 mb-1">
                  ¿Qué te gustaría trabajar en el proceso conmigo?
                </p>
                <p className="text-sm text-gray-700 whitespace-pre-wrap max-h-[240px] overflow-y-auto">
                  {motivo || <span className="text-gray-300">Sin respuesta</span>}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-gray-400 mb-1">¿Algo más que deba saber?</p>
                <p className="text-sm text-gray-700 whitespace-pre-wrap max-h-[240px] overflow-y-auto">
                  {infoAdicional || <span className="text-gray-300">Sin respuesta</span>}
                </p>
              </div>
            </div>
          </div>

          {/* UTMs */}
          {(utmSource || utmMedium || utmCampaign) && (
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-3">
                Origen
              </p>
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-1.5">
                {utmSource && <UtmRow label="Fuente" value={utmSource} />}
                {utmMedium && <UtmRow label="Medio" value={utmMedium} />}
                {utmCampaign && <UtmRow label="Campaña" value={utmCampaign} />}
              </div>
            </div>
          )}

          {/* Notas */}
          <div>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">
              Notas internas
            </p>
            <textarea
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
                setNotesDirty(true);
              }}
              placeholder="Añade notas sobre este lead…"
              rows={4}
              className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:border-[var(--color-primary)] transition-colors resize-none"
            />
            {notesDirty && (
              <button
                onClick={saveNotes}
                className="mt-2 text-xs text-[var(--color-primary)] hover:opacity-80 transition-opacity font-medium"
              >
                Guardar notas
              </button>
            )}
          </div>

          {/* Convertir a paciente */}
          {lead.stage !== "paciente" && (
            <div className="pt-2 border-t border-gray-100">
              {convertDone ? (
                <div className="w-full flex items-center justify-center gap-2 bg-emerald-50 text-emerald-700 text-sm font-medium py-2 rounded-lg border border-emerald-200">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    className="w-4 h-4"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                  Convertido a paciente
                </div>
              ) : (
                <button
                  onClick={() => onConvert(lead)}
                  disabled={converting}
                  className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium py-2 rounded-lg transition-colors disabled:opacity-50"
                >
                  {converting ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      className="w-4 h-4"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M19 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM4 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 0110.374 21c-2.331 0-4.512-.645-6.374-1.766z"
                      />
                    </svg>
                  )}
                  {converting ? "Convirtiendo…" : "Convertir a paciente"}
                </button>
              )}
            </div>
          )}

          {/* Eliminar */}
          <div className="pt-2 border-t border-gray-100">
            {confirmDelete ? (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                <p className="text-red-700 text-xs font-medium mb-3">
                  ¿Eliminar este lead? Esta acción no se puede deshacer.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => onDelete(lead.id)}
                    className="flex-1 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold py-2 rounded-lg transition-colors"
                  >
                    Sí, eliminar
                  </button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="flex-1 bg-white border border-gray-200 text-gray-600 text-xs font-semibold py-2 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="flex items-center gap-2 text-gray-400 hover:text-red-500 text-xs font-medium transition-colors py-1"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  className="w-3.5 h-3.5"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
                  />
                </svg>
                Eliminar lead
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────

function DetailRow({ icon, label, value, href }) {
  const icons = {
    phone: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        className="w-3.5 h-3.5"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z"
        />
      </svg>
    ),
    email: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        className="w-3.5 h-3.5"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"
        />
      </svg>
    ),
    user: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        className="w-3.5 h-3.5"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"
        />
      </svg>
    ),
  };

  return (
    <div className="flex items-center gap-3">
      <span className="text-gray-400 shrink-0">{icons[icon]}</span>
      <span className="text-gray-400 w-20 shrink-0 text-xs">{label}</span>
      {value ? (
        href ? (
          <a
            href={href}
            className="text-gray-700 text-xs hover:text-[var(--color-primary)] transition-colors"
          >
            {value}
          </a>
        ) : (
          <span className="text-gray-700 text-xs">{value}</span>
        )
      ) : (
        <span className="text-gray-300 text-xs">—</span>
      )}
    </div>
  );
}

function UtmRow({ label, value }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-gray-400 w-16 shrink-0">{label}</span>
      <span className="text-gray-600 font-mono">{value}</span>
    </div>
  );
}
