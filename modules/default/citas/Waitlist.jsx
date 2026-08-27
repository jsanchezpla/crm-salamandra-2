"use client";

// modules/default/citas/Waitlist.jsx — la lista de espera de la agenda: las
// reservas 'pending' que llegan de la web con su fecha elegida, para
// confirmarlas (cobrando la retención si la hay) o rechazarlas (soltándola).

// ─── Lista de espera ────────────────────────────────────────────────────────
// Las reservas en estado 'pending': solicitudes de la web que la persona ya
// eligió con fecha y hora y esperan que se confirmen o rechacen.

import { useCallback, useEffect, useState } from "react";
import { formatMoney } from "@/lib/payments/money.js";
import { MODALITY_LABELS, PagoChip, STATUS_LABELS, fmtDateTime, fmtRelative } from "./chips.jsx";
export function Waitlist({ refreshKey, esAdmin, onCountChange, onActioned }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [rejectFor, setRejectFor] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/citas/bookings?status=pending&limit=50", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) {
          setItems(j.data.bookings ?? []);
          onCountChange?.(j.data.total ?? 0);
        }
      })
      .finally(() => setLoading(false));
  }, [onCountChange]);

  useEffect(() => { load(); }, [load, refreshKey]);

  /**
   * Confirmar. Cuando la cita tiene dinero retenido, esto ADEMÁS lo cobra, y si
   * el cobro no sale la cita NO se confirma: el servidor responde 409 con el
   * motivo. Se le enseña ese motivo tal cual —es una frase escrita para ella— en
   * vez de un "error al confirmar" que no dice nada.
   *
   * `sinCobrar` es la salida para cuando la reserva de la tarjeta ha caducado:
   * hay una persona real esperando y lo correcto no es rechazarla, es aceptarla
   * y cobrarle en consulta.
   */
  async function confirm(id, { sinCobrar = false } = {}) {
    setBusyId(id);
    setError(null);
    try {
      const r = await fetch(`/api/citas/bookings/${id}/confirm`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sinCobrar ? { sinCobrar: true } : {}),
      });
      const j = await r.json();
      if (!j.ok) { setError(j.error || "Error al confirmar"); return; }
      onActioned?.();
      load();
    } finally {
      setBusyId(null);
    }
  }

  /**
   * Pedirle al paciente que vuelva a poner una tarjeta.
   *
   * Se le dice a la profesional si el correo salió DE VERDAD: dar esto por hecho
   * cuando el envío ha fallado la deja esperando una respuesta que nadie va a
   * dar. Si no salió, se le ofrece el enlace para mandarlo por donde pueda.
   */
  async function pedirTarjeta(id) {
    setBusyId(id);
    setError(null);
    try {
      const r = await fetch(`/api/citas/bookings/${id}/pedir-tarjeta`, { method: "POST" });
      const j = await r.json();
      if (!j.ok) { setError(j.error || "No se pudo pedir la tarjeta"); return; }
      if (j.data?.correoEnviado === false) {
        setError(
          `Retención preparada, pero el correo NO salió. Pásale este enlace: ${j.data.enlace}`
        );
      }
      onActioned?.();
      load();
    } finally {
      setBusyId(null);
    }
  }

  async function reject(id) {
    setBusyId(id);
    setError(null);
    try {
      const r = await fetch(`/api/citas/bookings/${id}/reject`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cancellationReason: rejectReason.trim() || null }),
      });
      const j = await r.json();
      if (!j.ok) { setError(j.error || "Error al rechazar"); return; }
      setRejectFor(null);
      setRejectReason("");
      onActioned?.();
      load();
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return <div className="px-6 lg:px-10 py-12 text-center text-sm text-neutral-400">Cargando lista de espera…</div>;
  }

  if (items.length === 0) {
    return (
      <div className="px-6 lg:px-10 py-16 text-center">
        <div className="text-base text-neutral-700 font-medium">Sin solicitudes pendientes</div>
        <p className="text-xs text-neutral-400 mt-1">Las nuevas solicitudes desde la web aparecerán aquí.</p>
      </div>
    );
  }

  return (
    <div className="px-4 lg:px-10 py-6 max-w-5xl mx-auto space-y-3">
      {error && <div className="px-3 py-2 bg-red-50 border border-red-100 rounded-md text-xs text-red-700">{error}</div>}
      {items.map((b) => {
        const isReject = rejectFor === b.id;
        return (
          <article key={b.id} className="bg-white border border-neutral-200 rounded-xl shadow-sm overflow-hidden">
            <div className="p-5 flex flex-col lg:flex-row lg:items-start gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium border bg-amber-50 text-amber-700 border-amber-100">
                    {STATUS_LABELS.pending}
                  </span>
                  {/* Sin esto, una solicitud cobrada y otra sin pagar se veían
                      idénticas aquí, y se podía confirmar la que nadie ha pagado. */}
                  <PagoChip
                    estado={b.paymentStatus}
                    motivoCancelacion={b.cancellationReason}
                    amount={b.amount}
                    caducaEn={b.authorizationExpiresAt}
                  />
                  <span className="text-xs text-neutral-400">{fmtRelative(b.createdAt)}</span>
                </div>
                <h3 className="text-base font-semibold text-neutral-900">{b.clientName}</h3>
                <div className="text-xs text-neutral-500 mt-0.5">
                  {b.clientEmail && <a href={`mailto:${b.clientEmail}`} className="hover:text-[var(--color-primary)]">{b.clientEmail}</a>}
                  {b.clientEmail && b.clientPhone && " · "}
                  {b.clientPhone && <a href={`tel:${b.clientPhone}`} className="hover:text-[var(--color-primary)]">{b.clientPhone}</a>}
                </div>

                <dl className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-y-1 gap-x-4 text-xs">
                  <WaitlistDetail label="Servicio" value={b.eventType?.name ?? "—"} />
                  <WaitlistDetail label="Cuándo" value={fmtDateTime(b.scheduledAt)} />
                  <WaitlistDetail label="Modalidad" value={MODALITY_LABELS[b.modality] ?? b.modality} />
                </dl>

                {b.additionalData && (
                  <div className="mt-3 px-3 py-2 bg-neutral-50 border border-neutral-100 rounded-md">
                    <div className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider mb-0.5">Respuesta al formulario</div>
                    <p className="text-xs text-neutral-700 whitespace-pre-wrap leading-relaxed">{b.additionalData}</p>
                  </div>
                )}
              </div>

              <div className="shrink-0 flex flex-col gap-2 lg:w-44">
                {isReject ? (
                  <>
                    <textarea
                      rows={2}
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      placeholder="Motivo (opcional, se envía por email)"
                      className="w-full border border-neutral-200 rounded-md px-2 py-1.5 text-xs focus:outline-none focus:border-[var(--color-primary)] resize-none"
                    />
                    <div className="flex gap-2">
                      <button onClick={() => { setRejectFor(null); setRejectReason(""); }} disabled={busyId === b.id} className="flex-1 bg-white border border-neutral-200 text-neutral-700 text-xs font-medium py-1.5 rounded-md hover:bg-neutral-50 disabled:opacity-50">
                        Cancelar
                      </button>
                      <button onClick={() => reject(b.id)} disabled={busyId === b.id} className="flex-1 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold py-1.5 rounded-md disabled:opacity-50">
                        {busyId === b.id ? "…" : "Rechazar"}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    {/* El botón dice lo que va a pasar. "Confirmar" a secas,
                        cuando además cobra 45 €, es información que se le
                        oculta justo en el momento en que la necesita.

                        Y mientras el paciente teclea su tarjeta NO se puede
                        confirmar: el servidor lo rechaza, pero un botón activo
                        que devuelve un error es una trampa. Se apaga y se dice
                        por qué. */}
                    {/* Apuntar, rechazar y CONFIRMAR: cualquiera del equipo
                        desde el 06/08/2026. Confirmar se abrió después que los
                        otros dos, con Rodrigo revisándolo, porque puede cobrar
                        la tarjeta retenida. */}
                    <button
                      onClick={() => confirm(b.id)}
                      disabled={busyId === b.id || b.paymentStatus === "authorizing"}
                      title={b.paymentStatus === "authorizing" ? "Está introduciendo su tarjeta ahora mismo" : undefined}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold py-2 rounded-md transition-colors disabled:opacity-50"
                    >
                      {busyId === b.id
                        ? "…"
                        : b.paymentStatus === "authorizing"
                          ? "Esperando su tarjeta…"
                          : b.paymentStatus === "authorized" && Number.isInteger(b.amount)
                            ? `Confirmar y cobrar ${formatMoney(b.amount)}`
                            : "Confirmar"}
                    </button>

                    {/* Sin dinero reservado (caducó, lo soltaron o el banco lo
                        rechazó) queda una persona real esperando. La salida no
                        es rechazarla: es aceptarla y cobrarle en consulta. */}
                    {(b.paymentStatus === "void" || b.paymentStatus === "failed") && (
                      <>
                        {/* Esta sí sigue siendo de admin: manda a la paciente
                            un correo con un enlace de pago, y no se pidió
                            abrirla. Quien no lo sea tiene al lado la salida
                            buena para este caso —confirmar sin cobrar y cobrar
                            en consulta—, así que no se queda atascado. */}
                        {esAdmin && (
                          <button
                            onClick={() => pedirTarjeta(b.id)}
                            disabled={busyId === b.id}
                            className="bg-white hover:bg-neutral-50 text-neutral-700 border border-neutral-300 text-xs font-medium py-2 rounded-md transition-colors disabled:opacity-50"
                            title="Le enviamos un correo con un enlace para que meta otra tarjeta. La cita se le guarda mientras tanto."
                          >
                            Pedirle otra tarjeta
                          </button>
                        )}
                        <button
                          onClick={() => confirm(b.id, { sinCobrar: true })}
                          disabled={busyId === b.id}
                          className="bg-white hover:bg-neutral-50 text-neutral-700 border border-neutral-300 text-xs font-medium py-2 rounded-md transition-colors disabled:opacity-50"
                          title="La cita queda confirmada sin cobrar nada online. Le cobras en consulta."
                        >
                          Confirmar sin cobrar
                        </button>
                      </>
                    )}

                    <button onClick={() => setRejectFor(b.id)} disabled={busyId === b.id} className="bg-white hover:bg-red-50 text-red-600 border border-red-200 text-xs font-medium py-2 rounded-md transition-colors disabled:opacity-50">
                      Rechazar
                    </button>
                  </>
                )}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function WaitlistDetail({ label, value }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold text-neutral-400 uppercase tracking-wider">{label}</dt>
      <dd className="text-neutral-700 mt-0.5">{value}</dd>
    </div>
  );
}
