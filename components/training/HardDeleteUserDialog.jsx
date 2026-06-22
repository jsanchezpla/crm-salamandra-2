"use client";

/**
 * Dialog confirmación BORRADO DEFINITIVO de un TrainingUser.
 * Llama a DELETE /api/training/users/[id]?hard=true.
 *
 * Requiere que el admin escriba el email exacto del usuario para confirmar
 * (anti pulsación accidental). Borra de la BD: TrainingUser, sus
 * CourseEnrollment y sus CourseRegistration. Irreversible.
 *
 * Props:
 *   - user            — { id, email, name?, lastName? }
 *   - onCancel()
 *   - onDeleted(user) — llamado tras éxito (la fila ya no existe)
 */
import { useState } from "react";

export default function HardDeleteUserDialog({ user, onCancel, onDeleted }) {
  const [confirmText, setConfirmText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fullName = [user.name, user.lastName].filter(Boolean).join(" ") || user.email;
  const expected = (user.email || "").trim().toLowerCase();
  const matches = confirmText.trim().toLowerCase() === expected;

  async function performDelete() {
    if (!matches) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/training/users/${user.id}?hard=true`, {
        method: "DELETE",
      });
      if (!res.ok && res.status !== 204) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "Error al eliminar");
      }
      onDeleted(user);
    } catch (e) {
      setError(e.message);
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <h2 className="text-base font-bold text-red-700 mb-2" style={{ fontFamily: "'Syne', sans-serif" }}>
          Eliminar definitivamente
        </h2>
        <div className="text-xs text-neutral-600 leading-relaxed space-y-2">
          <p>
            Vas a eliminar <strong>{fullName}</strong> de forma <strong>irreversible</strong>.
            Se borrarán también:
          </p>
          <ul className="list-disc list-inside ml-2 space-y-0.5 text-neutral-500">
            <li>Sus matrículas en cursos</li>
            <li>Sus registros previos al curso</li>
          </ul>
          <p className="text-neutral-500">
            Los intentos de cuestionario (snapshot de TutorLMS) se conservan, ya que
            no llevan FK al usuario.
          </p>
        </div>

        <div className="mt-4">
          <label className="block">
            <span className="block text-[11px] font-medium text-neutral-600 mb-1">
              Para confirmar, escribe el email del usuario: <strong>{user.email}</strong>
            </span>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              autoComplete="off"
              className="w-full rounded-lg px-3 py-2 text-sm text-neutral-700 border border-neutral-200 focus:outline-none focus:border-red-400 transition"
              placeholder={user.email}
            />
          </label>
        </div>

        {error && (
          <p className="text-xs text-red-500 mt-3">{error}</p>
        )}

        <div className="flex justify-end gap-2 pt-5">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 rounded-lg text-xs font-medium text-neutral-600 bg-neutral-100 hover:bg-neutral-200 transition disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={performDelete}
            disabled={loading || !matches}
            className="px-4 py-2 rounded-lg text-xs font-bold text-white transition-opacity disabled:opacity-40"
            style={{ background: "#B91C1C" }}
          >
            {loading ? "…" : "Eliminar definitivamente"}
          </button>
        </div>
      </div>
    </div>
  );
}
