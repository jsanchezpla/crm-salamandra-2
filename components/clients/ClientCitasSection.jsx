"use client";

/**
 * ClientCitasSection — «Citas» de la ficha: hoy, un solo interruptor
 * (06/08/2026, Rodrigo).
 *
 * ── QUÉ RESUELVE ────────────────────────────────────────────────────────────
 * El centro puede pedir que TODA reserva del portal espere su visto bueno. Eso
 * está bien con quien llega de nuevas y es trabajo tirado con la paciente de
 * siempre —la que viene los martes a la misma hora—: confirmarle a mano cada
 * cita no decide nada. Aquí se la exime, una a una y cuando la profesional
 * quiera.
 *
 * Solo EXIME: encenderlo no salta ninguna otra puerta (formulario, contrato,
 * identidad) ni el cobro. Una cita con precio sigue naciendo pendiente hasta que
 * la tarjeta responde.
 *
 * La sección no se pinta si el centro no tiene Citas: sería un interruptor que
 * no gobierna nada.
 */

import { useCallback, useEffect, useState } from "react";

export default function ClientCitasSection({ clientId }) {
  const [disponible, setDisponible] = useState(false);
  const [auto, setAuto] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  const cargar = useCallback(() => {
    let vivo = true;
    Promise.all([
      fetch("/api/citas/event-types").then((r) => ({ ok: r.ok, status: r.status })),
      fetch(`/api/clients/${clientId}`).then((r) => r.json()).catch(() => null),
    ])
      .then(([citas, ficha]) => {
        if (!vivo) return;
        // 403/404 = este centro no tiene Citas.
        setDisponible(citas.ok);
        setAuto(!!ficha?.data?.autoConfirmBookings);
      })
      .catch(() => {})
      .finally(() => vivo && setCargando(false));
    return () => { vivo = false; };
  }, [clientId]);

  useEffect(() => cargar(), [cargar]);

  async function alternar(valor) {
    const previo = auto;
    setAuto(valor); // optimista: es un interruptor, la espera se nota
    setGuardando(true);
    setError(null);
    try {
      const r = await fetch(`/api/clients/${clientId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoConfirmBookings: valor }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.error || "No se pudo guardar");
    } catch (e) {
      setAuto(previo); // se deshace: que el interruptor no mienta
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  }

  if (cargando || !disponible) return null;

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden mt-6">
      <div className="px-5 py-4 border-b border-gray-100">
        <span className="text-sm font-semibold text-gray-700">Citas</span>
      </div>

      <div className="p-5">
        <label className="flex items-start gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={auto}
            onChange={(e) => alternar(e.target.checked)}
            disabled={guardando}
            className="mt-0.5 w-4 h-4 rounded border-gray-300 accent-[var(--color-primary)]"
          />
          <span>
            <span className="block text-sm text-gray-800">Confirmar sus citas automáticamente</span>
            <span className="block text-xs text-gray-500 mt-0.5">
              Sus reservas desde el área privada entran ya confirmadas, sin pasar por tu bandeja. Útil con
              quien viene siempre el mismo día y a la misma hora. No afecta a las citas con pago, que siguen
              esperando a la tarjeta.
            </span>
          </span>
        </label>

        {error && <div className="mt-3 text-xs text-red-600">{error}</div>}
      </div>
    </div>
  );
}
