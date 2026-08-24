"use client";

/**
 * ClientBookingsPanel — las citas de esa persona dentro de su ficha, con
 * Confirmar y Rechazar desde ahí mismo.
 *
 * Nació en `modules/overrides/nutri-laura/` como pestaña «Sesiones» de la
 * ficha de Laura. Pasó aquí el 18/08/2026 (CLAUDE.md, «En Leads la pirámide
 * está al revés»): los endpoints de `bookings` son de todo el que tenga Citas,
 * y solo una ficha los enseñaba. Lo montan la ficha por defecto —para quien
 * decida `lib/clients/piezasFicha.js`; en un centro clínico no, que ya llama
 * «Sesiones» a otra cosa— y la de Laura, cada una con sus palabras por
 * `textos`.
 *
 * Funcionalidad:
 *   - GET /api/citas/bookings?clientEmail=:email&limit=50 — el backend filtra
 *     por email exacto (case-insensitive). Booking NO tiene FK a Client.
 *   - PATCH /api/citas/bookings/:id/confirm — pending → confirmed.
 *   - PATCH /api/citas/bookings/:id/reject  — pending → cancelled (con razón).
 *
 * Distinción visual cancelled vs rejected:
 *   El backend solo tiene status="cancelled" sin distinguir si la cita venía
 *   de pending (rechazo) o confirmed (cancelación). Heurística aplicada:
 *   `status==="cancelled" && cancellationReason` → "Rechazada" (rojo).
 *   `status==="cancelled" && !cancellationReason` → "Cancelada" (gris).
 *   Backlog: exponer el campo real desde audit log para no depender de la
 *   heurística.
 *
 * Permisos:
 *   confirmar y rechazar lo hace CUALQUIERA del equipo desde el 06/08/2026
 *   (decisión de Rodrigo, ver los dos endpoints): la API solo pide sesión y
 *   módulo `citas`. Este panel se quedó atrás y siguió enseñando «Solo admin»
 *   donde el backend ya decía que sí — corregido el 14/08/2026, a la vez que
 *   se abrió la ficha entera al equipo de la consulta.
 *
 * Errores:
 *   - 403 race condition ("no se puede confirmar/rechazar en estado X") →
 *     banner explicativo + refetch automático para sincronizar estado.
 *   - 409 solapamiento (confirm) → banner con la razón.
 *
 * Badges semánticos en tailwind sólido (no var(--color-primary)) — siguen
 * siendo universales (rojo=error, verde=ok) y no deben depender del
 * branding del tenant.
 */

import { useCallback, useEffect, useState } from "react";

function fmtDateTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-ES", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusMeta(b) {
  switch (b.status) {
    case "pending":
      return { label: "Pendiente", cls: "bg-yellow-100 text-yellow-800" };
    case "confirmed":
      return { label: "Confirmada", cls: "bg-green-100 text-green-800" };
    case "cancelled":
      return b.cancellationReason
        ? { label: "Rechazada", cls: "bg-red-100 text-red-800" }
        : { label: "Cancelada", cls: "bg-neutral-100 text-neutral-600" };
    case "completed":
      return { label: "Completada", cls: "bg-blue-100 text-blue-800" };
    case "no_show":
      return { label: "No asistió", cls: "bg-purple-100 text-purple-800" };
    default:
      return { label: b.status, cls: "bg-gray-100 text-gray-600" };
  }
}

/** Las palabras por defecto: las de un cliente cualquiera. */
const TEXTOS_POR_DEFECTO = {
  titulo: "Citas de este cliente",
  vacio: "Este cliente no tiene citas registradas.",
  avisoRechazo: "El cliente recibirá un email automático con tu motivo (si lo escribes).",
};

export default function ClientBookingsPanel({ clientId, clientEmail, textos: textosProp }) {
  const textos = { ...TEXTOS_POR_DEFECTO, ...(textosProp ?? {}) };
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [actionId, setActionId] = useState(null); // booking.id en curso
  const [actionError, setActionError] = useState(null);

  const [rejectFor, setRejectFor] = useState(null); // booking.id pendiente de razón
  const [rejectReason, setRejectReason] = useState("");

  const reload = useCallback(() => {
    // Desde 2026-07-22 se busca por el ENLACE real (clientId) y, además, por
    // email: así siguen apareciendo las citas antiguas que se quedaron sin
    // enlazar. Con solo uno de los dos bastaba para que faltaran citas.
    if (!clientId && !clientEmail) {
      setBookings([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ limit: "50" });
    if (clientId) params.set("clientId", clientId);
    if (clientEmail) params.set("clientEmail", clientEmail);
    fetch(`/api/citas/bookings?${params.toString()}`)
      .then((r) => r.json())
      .then((j) => {
        if (!j?.ok) throw new Error(j?.error || "Error al cargar citas");
        setBookings(j.data?.bookings ?? []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [clientId, clientEmail]);

  useEffect(() => { reload(); }, [reload]);

  async function handleConfirm(booking) {
    setActionId(booking.id);
    setActionError(null);
    try {
      const r = await fetch(`/api/citas/bookings/${booking.id}/confirm`, {
        method: "PATCH",
      });
      const j = await r.json().catch(() => ({}));
      if (!j?.ok) {
        if (r.status === 403) {
          setActionError(j?.error || "La cita ya no se puede confirmar (cambió de estado).");
          reload();
        } else if (r.status === 409) {
          setActionError(j?.error || "Solapamiento con otra cita activa.");
        } else {
          setActionError(j?.error || `Error al confirmar (HTTP ${r.status})`);
        }
        return;
      }
      // Actualización optimista en local.
      setBookings((prev) => prev.map((x) => (x.id === booking.id ? j.data : x)));
    } catch (e) {
      setActionError(e.message);
    } finally {
      setActionId(null);
    }
  }

  async function handleReject(booking) {
    setActionId(booking.id);
    setActionError(null);
    try {
      const r = await fetch(`/api/citas/bookings/${booking.id}/reject`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cancellationReason: rejectReason.trim() || null }),
      });
      const j = await r.json().catch(() => ({}));
      if (!j?.ok) {
        if (r.status === 409) {
          setActionError(j?.error || "La cita ya no se puede rechazar (cambió de estado).");
          reload();
        } else {
          setActionError(j?.error || `Error al rechazar (HTTP ${r.status})`);
        }
        return;
      }
      setBookings((prev) => prev.map((x) => (x.id === booking.id ? j.data : x)));
      setRejectFor(null);
      setRejectReason("");
    } catch (e) {
      setActionError(e.message);
    } finally {
      setActionId(null);
    }
  }

  // Ya no hace falta email: con el enlace real (clientId) sus citas aparecen
  // aunque la ficha no tenga correo. Antes esta pantalla se rendía aquí.
  if (!clientId && !clientEmail) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm px-5 py-6 text-center text-xs text-gray-500">
        No se pueden listar las citas de esta ficha.
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-gray-700">{textos.titulo}</div>
          <div className="text-[11px] text-gray-400 mt-0.5">
            {clientId
              ? <>Citas enlazadas a esta ficha{clientEmail ? <> y a <span className="font-mono">{clientEmail}</span></> : null}</>
              : <>Cruce por email <span className="font-mono">{clientEmail}</span></>}
          </div>
        </div>
        <button
          onClick={reload}
          className="text-[11px] font-semibold text-gray-500 hover:text-gray-800 border border-gray-200 px-2.5 py-1 rounded-md hover:bg-gray-50"
        >
          Refrescar
        </button>
      </div>

      {actionError && (
        <div className="mx-5 mt-3 px-3 py-2 bg-red-50 border border-red-100 rounded-md text-xs text-red-700 flex items-center justify-between gap-2">
          <span>{actionError}</span>
          <button
            onClick={() => setActionError(null)}
            className="text-[11px] font-semibold underline hover:no-underline"
          >
            Cerrar
          </button>
        </div>
      )}

      <div className="px-2 lg:px-5 py-2">
        {error && (
          <div className="my-3 px-3 py-2 bg-red-50 border border-red-100 rounded-md text-xs text-red-700 flex items-center justify-between gap-2">
            <span>{error}</span>
            <button
              type="button"
              onClick={reload}
              className="text-[11px] font-semibold underline hover:no-underline"
            >
              Reintentar
            </button>
          </div>
        )}

        {loading ? (
          <ul className="divide-y divide-gray-50">
            {[0, 1, 2].map((i) => (
              <li key={i} className="py-3 px-3 flex items-center gap-3 animate-pulse">
                <div className="h-4 w-2/5 bg-gray-100 rounded" />
                <div className="h-4 w-1/5 bg-gray-100 rounded" />
                <div className="h-4 w-20 bg-gray-100 rounded ml-auto" />
              </li>
            ))}
          </ul>
        ) : bookings.length === 0 && !error ? (
          <div className="py-10 text-center text-xs text-gray-400">
            {textos.vacio}
          </div>
        ) : (
          <>
            {/* Tabla en sm+ */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="text-left px-4 py-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Fecha</th>
                    <th className="text-left px-4 py-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Tipo</th>
                    <th className="text-left px-4 py-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Estado</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {bookings.map((b) => {
                    const meta = statusMeta(b);
                    const inFlight = actionId === b.id;
                    return (
                      <tr key={b.id} className="border-b border-gray-50 hover:bg-gray-50/60">
                        <td className="px-4 py-3 text-xs text-gray-700">
                          <div>{fmtDateTime(b.scheduledAt)}</div>
                          <div className="text-[11px] text-gray-400">{b.duration} min</div>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-700">
                          {b.eventType?.name ?? "Cita"}
                          {/* Número de sesión dentro del bono (04/08/2026). */}
                          {b.sessionNumber > 0 && (
                            <div className="text-[11px] text-[var(--color-primary)] mt-0.5">
                              Sesión {b.sessionNumber}
                              {Number(b.eventType?.sessionsCount) > 1 ? ` de ${b.eventType.sessionsCount}` : ""}
                            </div>
                          )}
                          {/* Respuestas del formulario de la cita, si lo tenía. */}
                          {Array.isArray(b.formAnswers?.respuestas) && b.formAnswers.respuestas.length > 0 && (
                            <details className="mt-1">
                              <summary className="text-[11px] text-gray-500 cursor-pointer hover:text-gray-800">
                                Lo que contestó antes de la cita
                              </summary>
                              <div className="mt-1 space-y-1.5 pl-1 border-l-2 border-gray-100">
                                {b.formAnswers.respuestas.map((r) => (
                                  <div key={r.id} className="pl-2">
                                    <div className="text-[10px] uppercase tracking-wider text-gray-400">
                                      {r.label}
                                    </div>
                                    <div className="text-[11px] text-gray-700 whitespace-pre-wrap">
                                      {r.valor === "" || r.valor == null ? "—" : String(r.valor)}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </details>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${meta.cls}`}>
                            {meta.label}
                          </span>
                          {b.cancellationReason && b.status === "cancelled" && (
                            <div className="text-[11px] text-gray-400 mt-0.5 italic">
                              {b.cancellationReason}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {b.status === "pending" && (
                            <div className="flex justify-end gap-1.5">
                              <button
                                onClick={() => handleConfirm(b)}
                                disabled={inFlight}
                                className="text-[11px] font-semibold text-green-700 bg-green-50 hover:bg-green-100 px-2.5 py-1 rounded-md transition disabled:opacity-50"
                              >
                                {inFlight ? "…" : "Confirmar"}
                              </button>
                              <button
                                onClick={() => { setRejectFor(b.id); setRejectReason(""); setActionError(null); }}
                                disabled={inFlight}
                                className="text-[11px] font-semibold text-red-700 bg-red-50 hover:bg-red-100 px-2.5 py-1 rounded-md transition disabled:opacity-50"
                              >
                                Rechazar
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Cards en <sm */}
            <ul className="sm:hidden divide-y divide-gray-50">
              {bookings.map((b) => {
                const meta = statusMeta(b);
                const inFlight = actionId === b.id;
                return (
                  <li key={b.id} className="py-3 px-3">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-gray-900 truncate">
                          {b.eventType?.name ?? "Cita"}
                        </div>
                        <div className="text-xs text-gray-500">{fmtDateTime(b.scheduledAt)} · {b.duration} min</div>
                      </div>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap ${meta.cls}`}>
                        {meta.label}
                      </span>
                    </div>
                    {b.cancellationReason && b.status === "cancelled" && (
                      <div className="text-[11px] text-gray-400 italic mb-1">
                        Motivo: {b.cancellationReason}
                      </div>
                    )}
                    {b.status === "pending" && (
                      <div className="flex gap-1.5 mt-2">
                        <button
                          onClick={() => handleConfirm(b)}
                          disabled={inFlight}
                          className="flex-1 text-[11px] font-semibold text-green-700 bg-green-50 hover:bg-green-100 px-2.5 py-1.5 rounded-md transition disabled:opacity-50"
                        >
                          {inFlight ? "…" : "Confirmar"}
                        </button>
                        <button
                          onClick={() => { setRejectFor(b.id); setRejectReason(""); setActionError(null); }}
                          disabled={inFlight}
                          className="flex-1 text-[11px] font-semibold text-red-700 bg-red-50 hover:bg-red-100 px-2.5 py-1.5 rounded-md transition disabled:opacity-50"
                        >
                          Rechazar
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      {/* Modal inline "Razón del rechazo" — NO usa lib externa. z-50: la
          escala de la regla 13 (iba a z-[90] cuando era solo de Laura). */}
      {rejectFor && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col">
            <div className="px-5 py-3.5 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-900">Rechazar cita</h3>
              <p className="text-[11px] text-gray-500 mt-0.5">
                {textos.avisoRechazo}
              </p>
            </div>
            <div className="p-5">
              <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
                Motivo (opcional)
              </label>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={3}
                placeholder="Ej. La franja ya no está disponible. Podemos verla el lunes."
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--color-primary)] resize-none placeholder:text-gray-300"
              />
            </div>
            <div className="px-5 py-3 border-t border-gray-100 flex gap-2">
              <button
                onClick={() => { setRejectFor(null); setRejectReason(""); }}
                disabled={actionId === rejectFor}
                className="flex-1 text-xs font-medium text-gray-700 border border-gray-200 px-3 py-2 rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  const b = bookings.find((x) => x.id === rejectFor);
                  if (b) handleReject(b);
                }}
                disabled={actionId === rejectFor}
                className="flex-1 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 px-3 py-2 rounded-lg disabled:opacity-50"
              >
                {actionId === rejectFor ? "Rechazando…" : "Confirmar rechazo"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
