"use client";

/**
 * ClientNotesPanel — la pestaña «Notas» / «Historia clínica» de la ficha.
 *
 * Nació en `modules/overrides/nutri-laura/` como pestaña de la ficha de Laura,
 * donde estas anotaciones SON el seguimiento clínico. Pasó aquí el 18/08/2026
 * (CLAUDE.md, «En Leads la pirámide está al revés»): la tabla `client_notes` y
 * los endpoints /api/clients/:id/notes son de TODOS los clientes desde el
 * principio, y solo una ficha los usaba. Ahora lo montan la ficha por defecto
 * —para quien decida `lib/clients/piezasFicha.js`— y la de Laura, cada una con
 * sus palabras: el panel no sabe si habla de un cliente o de una paciente,
 * se lo dicen por `textos`.
 *
 * Funcionalidad:
 *   - GET /api/clients/:id/notes paginado (limit 50 por página, incremental).
 *   - POST nueva entrada (textarea + botón "Añadir entrada").
 *   - PATCH corregir una entrada sin perder su fecha (04/09/2026, AV-0040 de
 *     Laura: solo había «Borrar», así que una errata costaba tirar la entrada
 *     entera y volver a escribirla con la fecha de hoy). La corregida se marca
 *     «(editada)» con la fecha del cambio: en una historia clínica hay que ver
 *     que una anotación se ha tocado.
 *   - DELETE nota (sin restricción por autor — backend no enforza y Laura es
 *     la única usuaria; aplicamos la regla de borrado-sin-restricción del
 *     Checkpoint 3). Editar sigue la MISMA política que borrar.
 *
 * Backlog (Checkpoint 4 o futuro):
 *   - Filtro por autor.
 *   - Restricción de borrado y edición por autor (UI + backend).
 *
 * Estados visuales:
 *   - Loading inicial: 3 skeletons pulsantes (no spinner, mejor percepción).
 *   - Vacío: mensaje amable invitando a escribir la primera nota.
 *   - Error: banner rojo con botón "Reintentar".
 *   - Borrado con confirmación inline (sin window.confirm).
 *   - Edición inline: la entrada se vuelve textarea en su sitio; Escape
 *     cancela. Solo una entrada en edición a la vez.
 */

import { useCallback, useEffect, useState } from "react";
import TimestampRelative from "../ui/TimestampRelative.jsx";
import { fueEditada, filasParaEditar } from "../../lib/clients/notas.js";

const PAGE_LIMIT = 50;

/** Las palabras por defecto: las de un cliente cualquiera. */
const TEXTOS_POR_DEFECTO = {
  titulo: "Nueva nota",
  placeholder: "Lo que conviene recordar de este cliente… (uso interno, no lo ve el cliente)",
  boton: "Añadir nota",
  vacio: "Todavía no hay notas. Escribe la primera arriba.",
};

export default function ClientNotesPanel({ clientId, textos: textosProp }) {
  const textos = { ...TEXTOS_POR_DEFECTO, ...(textosProp ?? {}) };
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

  // Edición inline: una entrada a la vez (`editId`), con su borrador aparte
  // para que Cancelar deje la nota como estaba.
  const [editId, setEditId] = useState(null);
  const [editContent, setEditContent] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState(null);

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

  function startEdit(note) {
    setConfirmDelete(null);
    setEditError(null);
    setEditId(note.id);
    setEditContent(note.content ?? "");
  }

  function cancelEdit() {
    setEditId(null);
    setEditContent("");
    setEditError(null);
  }

  async function handleEditSave(noteId) {
    const value = editContent.trim();
    if (!value) return;
    setSavingEdit(true);
    setEditError(null);
    try {
      const r = await fetch(`/api/clients/${clientId}/notes/${noteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: value }),
      });
      const j = await r.json();
      if (!j?.ok) {
        setEditError(j?.error || `Error al guardar (HTTP ${r.status})`);
        return;
      }
      // Sustituimos la fila con lo que devuelve el servidor: así el
      // «(editada)» sale con SU `updatedAt`, no con uno inventado aquí.
      const actualizada = j.data ?? {};
      setNotes((prev) =>
        prev.map((n) => (n.id === noteId ? { ...n, ...actualizada } : n))
      );
      cancelEdit();
    } catch (e) {
      setEditError(e.message);
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDelete(noteId) {
    setConfirmDelete(null);
    if (editId === noteId) cancelEdit();
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
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      {/* Composer */}
      <div className="px-5 py-4 border-b border-gray-100">
        <div className="text-sm font-semibold text-gray-700 mb-2">
          {textos.titulo}
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
          placeholder={textos.placeholder}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)] resize-none placeholder:text-gray-300"
        />
        <div className="flex justify-end mt-2">
          <button
            onClick={handleAdd}
            disabled={!content.trim() || saving}
            className="bg-[var(--color-primary)] hover:opacity-90 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-opacity disabled:opacity-40"
          >
            {saving ? "Guardando…" : textos.boton}
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
            {textos.vacio}
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
                  {fueEditada(n) && (
                    <>
                      <span>·</span>
                      <span className="italic">
                        editada <TimestampRelative date={n.updatedAt} />
                      </span>
                    </>
                  )}
                  <span className="flex-1" />
                  {editId === n.id ? null : confirmDelete === n.id ? (
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
                    <>
                      <button
                        onClick={() => startEdit(n)}
                        className="text-[11px] text-gray-400 hover:text-[var(--color-primary)]"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => setConfirmDelete(n.id)}
                        className="text-[11px] text-gray-400 hover:text-red-500"
                      >
                        Borrar
                      </button>
                    </>
                  )}
                </div>
                {editId === n.id ? (
                  <div>
                    {editError && (
                      <div className="px-3 py-2 mb-2 bg-red-50 border border-red-100 rounded-md text-xs text-red-700">
                        {editError}
                      </div>
                    )}
                    <textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") cancelEdit();
                      }}
                      rows={filasParaEditar(editContent)}
                      autoFocus
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)] resize-y leading-relaxed"
                    />
                    <div className="flex justify-end items-center gap-2 mt-2">
                      <button
                        onClick={cancelEdit}
                        disabled={savingEdit}
                        className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1.5 disabled:opacity-50"
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={() => handleEditSave(n.id)}
                        disabled={!editContent.trim() || savingEdit}
                        className="bg-[var(--color-primary)] hover:opacity-90 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-opacity disabled:opacity-40"
                      >
                        {savingEdit ? "Guardando…" : "Guardar cambios"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                    {n.content}
                  </div>
                )}
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
