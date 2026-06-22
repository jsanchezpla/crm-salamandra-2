"use client";

/**
 * Drawer para crear un empleado individual desde la ficha de empresa.
 * Alternativa al import por Excel cuando solo se quiere dar de alta a 1.
 *
 * Crea con type='company' y active=false (pre-aprobado: se activa cuando
 * el empleado complete su registro en el campus, igual que un importado).
 *
 * Props:
 *   - companyId, companyName
 *   - onClose()       — cerrar sin acción
 *   - onCreated(user) — cierra y refresca lista de empleados
 */
import { useState } from "react";

export default function CreateEmployeeDrawer({ companyId, companyName, onClose, onCreated }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [lastName, setLastName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [nif, setNif] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const canSubmit = email.trim().length > 0 && !submitting;

  async function handleSubmit(e) {
    e?.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/training/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          email: email.trim(),
          name: name.trim() || undefined,
          lastName: lastName.trim() || undefined,
          birthDate: birthDate || undefined,
          nif: nif.trim() || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Error al crear el empleado");
      onCreated(json.data);
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div
        onClick={onClose}
        className="fixed inset-x-0 top-14 lg:top-0 bottom-0 z-40 bg-black/40"
        aria-hidden="true"
      />
      <aside
        role="dialog"
        aria-label="Crear empleado"
        className="fixed right-0 top-14 lg:top-0 bottom-0 z-50 w-full sm:max-w-md bg-white shadow-2xl flex flex-col"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-neutral-100 flex items-center justify-between">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-neutral-900" style={{ fontFamily: "'Syne', sans-serif" }}>
              Crear empleado
            </h2>
            <p className="text-[11px] text-neutral-400 truncate">{companyName}</p>
          </div>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-700 transition-colors"
            title="Cerrar"
            aria-label="Cerrar"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <form id="create-employee-form" onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            <label className="block">
              <span className="block text-[11px] font-medium text-neutral-500 mb-1">
                Email <span className="text-red-500">*</span>
              </span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="alumno@empresa.com"
                className="w-full rounded-lg px-3 py-2 text-sm text-neutral-700 border border-neutral-200 focus:outline-none focus:border-neutral-400 transition"
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-[11px] font-medium text-neutral-500 mb-1">Nombre</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg px-3 py-2 text-sm text-neutral-700 border border-neutral-200 focus:outline-none focus:border-neutral-400 transition"
              />
            </label>
            <label className="block">
              <span className="block text-[11px] font-medium text-neutral-500 mb-1">Apellidos</span>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="w-full rounded-lg px-3 py-2 text-sm text-neutral-700 border border-neutral-200 focus:outline-none focus:border-neutral-400 transition"
              />
            </label>
          </div>

          <label className="block">
            <span className="block text-[11px] font-medium text-neutral-500 mb-1">Fecha de nacimiento</span>
            <input
              type="date"
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm text-neutral-700 border border-neutral-200 focus:outline-none focus:border-neutral-400 transition"
            />
          </label>

          <label className="block">
            <span className="block text-[11px] font-medium text-neutral-500 mb-1">NIF</span>
            <input
              type="text"
              value={nif}
              onChange={(e) => setNif(e.target.value)}
              placeholder="Opcional"
              className="w-full rounded-lg px-3 py-2 text-sm text-neutral-700 border border-neutral-200 focus:outline-none focus:border-neutral-400 transition"
            />
          </label>

          <div className="rounded-lg bg-neutral-50 border border-neutral-100 p-3">
            <p className="text-[11px] text-neutral-600 leading-relaxed">
              El empleado se crea como <strong>pre-aprobado</strong> (inactivo). Se
              activará automáticamente cuando complete su registro en el campus,
              igual que un empleado importado por Excel.
            </p>
          </div>

          {error && (
            <div className="px-4 py-2.5 bg-red-50 border border-red-100 rounded-lg text-xs text-red-600">
              {error}
            </div>
          )}
        </form>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-neutral-100 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-3 py-2 rounded-lg text-xs font-medium text-neutral-600 bg-neutral-100 hover:bg-neutral-200 transition disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="submit"
            form="create-employee-form"
            disabled={!canSubmit}
            className="px-4 py-2 rounded-lg text-xs font-bold text-white transition-opacity disabled:opacity-40"
            style={{ background: "var(--color-primary)" }}
          >
            {submitting ? "Creando…" : "Crear empleado"}
          </button>
        </div>
      </aside>
    </>
  );
}
