"use client";

/**
 * ClientPortalMonthsSection — «Acceso al portal por meses» de la ficha de
 * cliente (sprint Aumenta 2026-07, punto 2.3).
 *
 * Cuando el centro activa el bloqueo por impago, la familia ve los documentos
 * de un mes solo si consta el cobro de ese mes. Aquí se ve, mes a mes, qué
 * tiene abierto y qué retenido, y se puede abrir uno A MANO (becas, acuerdos de
 * pago, un cobro que entró por fuera del CRM).
 *
 * Si el tenant NO tiene el bloqueo activado, la sección no se pinta: sería una
 * pantalla que no gobierna nada.
 */

import { useCallback, useEffect, useState } from "react";
import HelpTooltip from "../ui/HelpTooltip.jsx";

function nombreMes(mes) {
  const [a, m] = mes.split("-").map(Number);
  const d = new Date(a, m - 1, 1);
  const txt = d.toLocaleDateString("es-ES", { month: "long", year: "numeric" });
  return txt.charAt(0).toUpperCase() + txt.slice(1);
}

export default function ClientPortalMonthsSection({ clientId }) {
  const [datos, setDatos] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyMes, setBusyMes] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    let alive = true;
    fetch(`/api/clients/${clientId}/portal-months`)
      .then(async (r) => ({ r, d: await r.json().catch(() => ({})) }))
      .then(({ r, d }) => {
        if (!alive) return;
        if (r.status === 403) { setDatos(null); return; }
        if (!d.ok) throw new Error(d.error || "No se pudo cargar el acceso al portal");
        setDatos(d.data);
        setError(null);
      })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [clientId]);

  useEffect(() => load(), [load]);

  async function alternar(mes, abierto) {
    setBusyMes(mes);
    setError(null);
    try {
      const r = await fetch(`/api/clients/${clientId}/portal-months`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mes, abierto }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.error || "No se pudo guardar");
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyMes(null);
    }
  }

  if (loading || !datos?.activo) return null;

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden mt-6">
      <div className="px-5 py-4 border-b border-gray-100">
        <span className="text-sm font-semibold text-gray-700 inline-flex items-center gap-1.5">
          Acceso al portal por meses
          <HelpTooltip title="Acceso al portal por meses" placement="bottom">
            Esta sección solo aparece si tienes activado el bloqueo por impago. Con él, la familia
            entra a su área privada siempre, pero{" "}
            <strong className="text-white">los documentos de cada mes se le abren cuando consta
            el cobro de ESE mes</strong> — no del total.
            {" "}
            Abrir uno a mano no registra ningún cobro: es para becas, acuerdos de pago o dinero que
            entró por fuera del CRM.
          </HelpTooltip>
        </span>
        <p className="text-xs text-gray-500 mt-1">
          La familia ve los documentos de cada mes cuando consta su cobro. Aquí puedes abrir un mes
          a mano si hace falta.
        </p>
      </div>

      <div className="p-5">
        <ul className="divide-y divide-gray-100">
          {datos.meses.map((m) => (
            <li key={m.mes} className="py-2.5 flex items-center gap-3 flex-wrap">
              <div className="min-w-0 flex-1">
                <div className="text-sm text-gray-800">{nombreMes(m.mes)}</div>
                <div className="text-xs text-gray-500">
                  {m.documentos > 0
                    ? `${m.documentos} documento${m.documentos === 1 ? "" : "s"} compartido${m.documentos === 1 ? "" : "s"}`
                    : "Sin documentos"}
                </div>
              </div>
              <span
                className={`text-[11px] px-2 py-0.5 rounded-full shrink-0 ${
                  m.cobrado
                    ? "bg-emerald-50 text-emerald-700"
                    : m.manual
                      ? "bg-blue-50 text-blue-700"
                      : "bg-amber-50 text-amber-700"
                }`}
              >
                {m.cobrado ? "Cobrado" : m.manual ? "Abierto a mano" : "Pendiente de cobro"}
              </span>
              {/* El mes cobrado no se puede cerrar desde aquí: lo abre el cobro,
                  y quitarlo daría una falsa sensación de control. */}
              {!m.cobrado && (
                <button
                  onClick={() => alternar(m.mes, !m.manual)}
                  disabled={busyMes === m.mes}
                  className="text-xs text-[var(--color-primary)] hover:underline disabled:opacity-40 shrink-0"
                >
                  {busyMes === m.mes ? "Guardando…" : m.manual ? "Volver a cerrar" : "Abrir a mano"}
                </button>
              )}
            </li>
          ))}
        </ul>
        {error && <div className="text-xs text-rose-600 mt-3">{error}</div>}
      </div>
    </div>
  );
}
