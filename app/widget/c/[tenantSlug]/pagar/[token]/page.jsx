"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import PasoTarjeta from "../../_components/PasoTarjeta.jsx";
import { formatMoney } from "../../../../../../lib/payments/money.js";

/**
 * "Vuelve a introducir tu tarjeta": la página a la que lleva el enlace del
 * correo cuando la reserva anterior caducó o el banco la rechazó.
 *
 * Se sirve dentro del widget (mismo layout, mismos colores) porque el paciente
 * puede llegar aquí desde su correo en el móvil, sin haber pasado por la web de
 * la profesional. Tiene que reconocer de quién es esto en el primer vistazo.
 *
 * A diferencia del flujo de reserva, aquí NO se pide nada más: la cita ya existe
 * y sus datos están guardados. Solo la tarjeta.
 */
function fmtLong(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-ES", {
    timeZone: "Europe/Madrid",
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const heading = { fontFamily: "var(--widget-font-display)", fontWeight: 500 };

export default function PagarCitaPage() {
  const params = useParams();
  const tenantSlug = params?.tenantSlug;
  const token = params?.token;

  const [info, setInfo] = useState(null);
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [problema, setProblema] = useState(null);
  const [listo, setListo] = useState(false);

  useEffect(() => {
    let cancelado = false;
    async function cargar() {
      try {
        const [rInfo, rPago] = await Promise.all([
          fetch(`/api/public/c/${tenantSlug}/info`, { cache: "no-store" }),
          fetch(`/api/public/c/${tenantSlug}/pagar/${token}`, { cache: "no-store" }),
        ]);
        const jInfo = await rInfo.json().catch(() => null);
        const jPago = await rPago.json().catch(() => null);
        if (cancelado) return;

        setInfo(jInfo?.data ?? null);
        if (!rPago.ok || !jPago?.ok) {
          setProblema(jPago?.error || "Este enlace ya no es válido.");
          return;
        }
        setDatos(jPago.data);
      } catch {
        if (!cancelado) setProblema("No hemos podido cargar esta página. Inténtalo en un momento.");
      } finally {
        if (!cancelado) setCargando(false);
      }
    }
    if (tenantSlug && token) cargar();
    return () => { cancelado = true; };
  }, [tenantSlug, token]);

  if (cargando) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-[var(--widget-text-muted)]">
        Cargando…
      </div>
    );
  }

  const Marco = ({ children }) => (
    <div className="min-h-screen bg-[var(--widget-bg)] px-4 py-10">
      <div className="max-w-md mx-auto">
        <div className="rounded-lg border border-[var(--widget-border)] bg-[var(--widget-card)] p-6">
          {children}
        </div>
      </div>
    </div>
  );

  if (problema) {
    return (
      <Marco>
        <p className="text-[11px] tracking-[0.14em] uppercase text-[var(--widget-text-faint)] mb-2">
          {info?.name ?? "Citas"}
        </p>
        <h1 className="text-[24px] leading-tight text-[var(--widget-text)] mb-3" style={heading}>
          No podemos abrir este enlace
        </h1>
        <p className="text-[13px] leading-relaxed text-[var(--widget-text-muted)]">{problema}</p>
        <p className="text-[12px] leading-relaxed text-[var(--widget-text-faint)] mt-4">
          Si crees que es un error, responde al correo que te enviamos y lo resolvemos.
        </p>
      </Marco>
    );
  }

  if (listo) {
    return (
      <Marco>
        <p className="text-[11px] tracking-[0.14em] uppercase text-[var(--widget-text-faint)] mb-2">
          Listo
        </p>
        <h1 className="text-[24px] leading-tight text-[var(--widget-text)] mb-3" style={heading}>
          Ya está
        </h1>
        <p className="text-[13px] leading-relaxed text-[var(--widget-text-muted)] mb-4">
          Hemos reservado {formatMoney(datos.importe)} en tu tarjeta. {info?.name ?? "Tu profesional"}{" "}
          confirmará la cita y entonces —y solo entonces— se hará el cobro.
        </p>
        <p className="text-[12px] leading-relaxed text-[var(--widget-text-faint)]">
          Puedes cerrar esta página. Te escribiremos en cuanto esté confirmada.
        </p>
      </Marco>
    );
  }

  return (
    <Marco>
      <p className="text-[11px] tracking-[0.14em] uppercase text-[var(--widget-text-faint)] mb-2">
        {info?.name ?? "Citas"}
      </p>
      <h1 className="text-[24px] leading-tight text-[var(--widget-text)] mb-2" style={heading}>
        Tu tarjeta, otra vez
      </h1>
      <p className="text-[13px] leading-relaxed text-[var(--widget-text-muted)] mb-5">
        Tu cita sigue en pie. Solo necesitamos una tarjeta válida para guardarte la hora.
      </p>

      <div className="space-y-2 border-y border-[var(--widget-border)] py-4 mb-5">
        <Fila etiqueta="Servicio" valor={datos.cita.eventTypeName} />
        <Fila etiqueta="Cuándo" valor={fmtLong(datos.cita.scheduledAt)} />
        <Fila etiqueta="Importe" valor={formatMoney(datos.importe)} />
      </div>

      <PasoTarjeta
        clientSecret={datos.clientSecret}
        publishableKey={datos.publishableKey}
        importe={datos.importe}
        nombreServicio={datos.cita.eventTypeName}
        onListo={() => setListo(true)}
      />
    </Marco>
  );
}

function Fila({ etiqueta, valor }) {
  return (
    <div className="flex text-[13px]">
      <span className="w-24 shrink-0 text-[var(--widget-text-faint)]">{etiqueta}</span>
      <span className="text-[var(--widget-text)]">{valor ?? "—"}</span>
    </div>
  );
}
