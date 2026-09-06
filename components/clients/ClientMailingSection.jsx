"use client";

/**
 * ClientMailingSection — qué campañas de mailing ha recibido esta ficha, si
 * las abrió y si pinchó (sprint 2 del módulo Mailing, 06/09/2026). Al lado
 * del hilo de WhatsApp por el mismo criterio: es lo que el centro le ha
 * contado a esa persona, leído desde su ficha.
 *
 * ── SE ESCONDE SOLA ─────────────────────────────────────────────────────────
 * Devuelve `null` si el centro no tiene el módulo (el endpoint contesta 403),
 * si la persona no puede recibir nada y nunca se le ha mandado nada, o
 * mientras carga: `PanelPestana` declara entonces la pestaña vacía y no sale
 * en el menú (misma regla que WhatsApp). `onEstado(hay)` es para la ficha de
 * nutri_laura, que pinta sus pestañas a mano.
 */

import { useEffect, useState } from "react";

const fmt = (iso) => (iso ? new Date(iso).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Madrid" }) : "—");

const ESTADO = {
  enviado: ["Enviado", "text-emerald-700"],
  pendiente: ["Pendiente", "text-amber-700"],
  esperando: ["Pendiente", "text-amber-700"],
  procesando: ["Enviando", "text-amber-700"],
  fallido: ["Fallido", "text-red-700"],
  suprimido: ["No enviado (baja)", "text-neutral-500"],
  rebotado: ["Rebotado", "text-red-700"],
  queja: ["Marcado como spam", "text-red-700"],
};

export default function ClientMailingSection({ clientId, onEstado }) {
  const [datos, setDatos] = useState(null);

  useEffect(() => {
    let vivo = true;
    fetch(`/api/mailing/historial?clientId=${encodeURIComponent(clientId)}`)
      .then(async (r) => {
        if (!r.ok) return null; // 403 sin módulo, 404…: no hay pestaña
        const j = await r.json().catch(() => null);
        return j?.ok ? j.data : null;
      })
      .then((d) => {
        if (!vivo) return;
        setDatos(d);
        onEstado?.(!!d && (d.envios.length > 0 || !!d.supresion));
      })
      .catch(() => {
        if (vivo) onEstado?.(false);
      });
    return () => {
      vivo = false;
    };
  }, [clientId, onEstado]);

  if (!datos || (datos.envios.length === 0 && !datos.supresion)) return null;

  return (
    <section className="rounded-xl border border-neutral-100 bg-white p-4 lg:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-lg text-[var(--ink-900)]">Mailing</h3>
          <p className="text-xs text-neutral-500 mt-0.5">Las campañas y novedades que le ha mandado el centro.</p>
        </div>
        <div className="text-xs">
          {datos.supresion ? (
            <span className="inline-flex px-2 py-0.5 rounded-full bg-neutral-200 text-neutral-700 font-semibold">
              De baja desde el {fmt(datos.supresion.desde)} ({datos.supresion.motivo})
            </span>
          ) : datos.consentimiento?.casilla ? (
            <span className="inline-flex px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-semibold">Recibe novedades</span>
          ) : (
            <span className="inline-flex px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold">
              {datos.consentimiento?.respondio ? "No quiere novedades" : "Sin marcar la casilla de novedades"}
            </span>
          )}
        </div>
      </div>

      {datos.envios.length > 0 && (
        <table className="w-full text-sm mt-4">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-neutral-400 border-b border-neutral-100">
              <th className="py-2 pr-3">Correo</th>
              <th className="py-2 pr-3">Estado</th>
              <th className="py-2 pr-3 text-right">Abierto</th>
              <th className="py-2 pr-3 text-right">Clics</th>
              <th className="py-2">Cuándo</th>
            </tr>
          </thead>
          <tbody>
            {datos.envios.map((e) => {
              const [label, cls] = ESTADO[e.estado] ?? [e.estado, "text-neutral-600"];
              return (
                <tr key={e.id} className="border-b border-neutral-50 align-top">
                  <td className="py-2 pr-3">
                    <div className="text-neutral-900">{e.asunto || e.campana?.nombre || "—"}</div>
                    <div className="text-[11px] text-neutral-400">
                      {e.secuencia ? `Secuencia · ${e.secuencia.nombre}` : e.campana?.nombre}
                      {e.variante ? ` · asunto ${e.variante.toUpperCase()}` : ""}
                    </div>
                  </td>
                  <td className={`py-2 pr-3 text-xs font-semibold ${cls}`}>{label}</td>
                  <td className="py-2 pr-3 text-right">{e.aperturas > 0 ? "✓" : "—"}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{e.clics || "—"}</td>
                  <td className="py-2 text-xs text-neutral-500 whitespace-nowrap">{fmt(e.enviadoAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <p className="text-[11px] text-neutral-400 mt-3">La apertura es orientativa (muchos buzones la marcan solos); el clic es el dato que vale.</p>
    </section>
  );
}
