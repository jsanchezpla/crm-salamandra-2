"use client";

/**
 * Dialog confirmación archivar (soft delete) un TrainingUser.
 * Llama a DELETE /api/training/users/[id] sin flags (= archivar).
 *
 * Props:
 *   - user            — { id, email, name?, lastName? }
 *   - onCancel()
 *   - onArchived(user) — llamado tras éxito
 */
import { useState } from "react";

export default function ArchiveUserDialog({ user, onCancel, onArchived }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fullName = [user.name, user.lastName].filter(Boolean).join(" ") || user.email;

  async function performArchive() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/training/users/${user.id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "Error al archivar");
      }
      onArchived(user);
    } catch (e) {
      setError(e.message);
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <h2 className="text-base font-bold text-neutral-900 mb-2" style={{ fontFamily: "'Syne', sans-serif" }}>
          Archivar usuario
        </h2>
        <div className="text-xs text-neutral-600 leading-relaxed space-y-2">
          <p>¿Archivar a <strong>{fullName}</strong>?</p>
          <p>
            Sus matrículas y datos se conservan. Si vuelves a importar un Excel
            con su email, se reactivará automáticamente.
          </p>
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
            onClick={performArchive}
            disabled={loading}
            className="px-4 py-2 rounded-lg text-xs font-bold text-white transition-opacity disabled:opacity-50"
            style={{ background: "#DC2626" }}
          >
            {loading ? "…" : "Archivar"}
          </button>
        </div>
      </div>
    </div>
  );
}
