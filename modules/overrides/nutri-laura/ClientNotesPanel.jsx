"use client";

/**
 * ClientNotesPanel — tab "Historia clínica" del detalle de paciente (nutri_laura).
 *
 * Se llamaba "Notas"; para Laura estas anotaciones SON el seguimiento clínico,
 * así que se renombró la UI. Por dentro NO cambia nada: misma tabla
 * `client_notes`, mismos endpoints /api/clients/:id/notes y misma clave de tab
 * (`notes`). El resto de tenants sigue viendo "Notas" (modules/default/).
 *
 * Funcionalidad:
 *   - GET /api/clients/:id/notes paginado (limit 50 por página, incremental).
 *   - POST nueva entrada (textarea + botón "Añadir entrada").
 *   - DELETE nota (sin restricción por autor — backend no enforza y Laura es
 *     la única usuaria; aplicamos la regla de borrado-sin-restricción del
 *     Checkpoint 3).
 *
 * Backlog (Checkpoint 4 o futuro):
 *   - PATCH endpoint para edición inline (no existe todavía en backend).
 *   - Filtro por autor.
 *   - Restricción de borrado por autor (UI + backend).
 *
 * Estados visuales:
 *   - Loading inicial: 3 skeletons pulsantes (no spinner, mejor percepción).
 *   - Vacío: mensaje amable invitando a escribir la primera nota.
 *   - Error: banner rojo con botón "Reintentar".
 *   - Borrado con confirmación inline (sin window.confirm).
 */

import { useCallback, useEffect, useState } from "react";
import TimestampRelative from "../../../components/ui/TimestampRelative.jsx";

const PAGE_LIMIT = 50;

export default function ClientNotesPanel({ clientId }) {
  const [notes, setNotes] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);

  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  const [confirmDelete, setConfirmDelete] = useState(null);

  const fetchPage = useCallback(
    async (targetPage, { append }) => {
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      try {
        const r = await fetch(
          `/api/clients/${clientId}/notes?page=${targetPage}&limit=${PAGE_LIMIT}`
        );
        const j = await r.json();
        if (!j?.ok) throw new Error(j?.error || `HTTP ${r.status}`);
        const fetched = j.data?.notes ?? [];
        setTotal(typeof j.data?.total === "number" ? j.data.total : fetched.length);
        setNotes((prev) => (append ? [...prev, ...fetched] : fetched));
        setPage(targetPage);
      } catch (e) {
        setError(e.message);
      } finally {
        if (append) setLoadingMore(false);
        else setLoading(false);
      }
    },
    [clientId]
  );

  useEffect(() => {
    fetchPage(1, { append: false });
  }, [fetchPage]);

  async function handleAdd() {
    const value = content.trim();
    if (!value) return;
    setSaving(true);
    setSubmitError(null);
    try {
      const r = await fetch(`/api/clients/${clientId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: value }),
      });
      const j = await r.json();
      if (!j?.ok) {
        setSubmitError(j?.error || `Error al guardar (HTTP ${r.status})`);
        return;
      }
      // Inyectamos la nueva nota arriba y recargamos página 1 para mantener
      // total/paginación coherentes con backend. Es 1 fetch extra pero
      // simplifica el cálculo de hasMore.
      setContent("");
      fetchPage(1, { append: false });
    } catch (e) {
      setSubmitError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(noteId) {
    setConfirmDelete(null);
    try {
      const r = await fetch(`/api/clients/${clientId}/notes/${noteId}`, {
        method: "DELETE",
      });
      if (r.ok || r.status === 204) {
        // Optimista: quitamos de la lista local sin refetch completo.
        setNotes((prev) => prev.filter((n) => n.id !== noteId));
        setTotal((t) => Math.max(0, t - 1));
      }
    } catch {
      // Si falla, recargamos para reconciliar.
      fetchPage(1, { append: false });
    }
  }

  const hasMore = notes.length < total;

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden max-w-3xl">
      {/* Composer */}
      <div className="px-5 py-4 border-b border-gray-100">
        <div className="text-sm font-semibold text-gray-700 mb-2">
          Nueva entrada de historia clínica
        </div>
        {submitError && (
          <div className="px-3 py-2 mb-2 bg-red-50 border border-red-100 rounded-md text-xs text-red-700">
            {submitError}
          </div>
        )}
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={3}
          placeholder="Evolución, observaciones, acuerdos de la sesión… (uso interno, no lo ve la paciente)"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)] resize-none placeholder:text-gray-300"
        />
        <div className="flex justify-end mt-2">
          <button
            onClick={handleAdd}
            disabled={!content.trim() || saving}
            className="bg-[var(--color-primary)] hover:opacity-90 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-opacity disabled:opacity-40"
          >
            {saving ? "Guardando…" : "Añadir entrada"}
          </button>
        </div>
      </div>

      {/* Lista / estados */}
      <div className="px-5 py-2">
        {error && (
          <div className="my-3 px-3 py-2 bg-red-50 border border-red-100 rounded-md text-xs text-red-700 flex items-center justify-between gap-2">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => fetchPage(1, { append: false })}
              className="text-[11px] font-semibold underline hover:no-underline"
            >
              Reintentar
            </button>
          </div>
        )}

        {loading ? (
          <ul className="divide-y divide-gray-50">
            {[0, 1, 2].map((i) => (
              <li key={i} className="py-3 animate-pulse">
                <div className="h-3 w-32 bg-gray-100 rounded mb-2" />
                <div className="h-4 w-full bg-gray-100 rounded mb-1.5" />
                <div className="h-4 w-3/4 bg-gray-100 rounded" />
              </li>
            ))}
          </ul>
        ) : notes.length === 0 && !error ? (
          <div className="py-10 text-center text-xs text-gray-400">
            La historia clínica está vacía. Escribe la primera entrada arriba.
          </div>
        ) : (
          <ul className="divide-y divide-gray-50">
            {notes.map((n) => (
              <li key={n.id} className="py-3">
                <div className="flex items-center gap-2 mb-1 text-xs text-gray-400 flex-wrap">
                  <TimestampRelative date={n.createdAt} />
                  {n.createdBy && (
                    <>
                      <span>·</span>
                      <span className="truncate">{n.createdBy}</span>
                    </>
                  )}
                  <span className="flex-1" />
                  {confirmDelete === n.id ? (
                    <>
                      <button
                        onClick={() => handleDelete(n.id)}
                        className="text-[11px] font-semibold text-red-600 hover:underline"
                      >
                        Confirmar
                      </button>
                      <button
                        onClick={() => setConfirmDelete(null)}
                        className="text-[11px] text-gray-400 hover:text-gray-600"
                      >
                        Cancelar
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setConfirmDelete(n.id)}
                      className="text-[11px] text-gray-400 hover:text-red-500"
                    >
                      Borrar
                    </button>
                  )}
                </div>
                <div className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                  {n.content}
                </div>
              </li>
            ))}
          </ul>
        )}

        {hasMore && !loading && (
          <div className="py-3 text-center">
            <button
              onClick={() => fetchPage(page + 1, { append: true })}
              disabled={loadingMore}
              className="text-xs text-[var(--color-primary)] font-semibold hover:underline disabled:opacity-50"
            >
              {loadingMore ? "Cargando…" : `Cargar más (${total - notes.length} restantes)`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
