"use client";

// modules/default/citas/chips.jsx — los rótulos, colores y chips que
// comparten la agenda, la ficha de la cita, el alta manual y la lista de
// espera: estado, modalidad y cobro (con la retención de Stripe explicada en
// cristiano), más los formatos de fecha. Nada de aquí habla con la API.


import { formatMoney } from "@/lib/payments/money.js";
export const inputCls =
  "w-full rounded-lg px-3 py-2 text-sm text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition placeholder-neutral-300";

export const STATUS_LABELS = {
  pending: "Pendiente",
  confirmed: "Confirmada",
  completed: "Completada",
  cancelled: "Cancelada",
  no_show: "No asistió",
};

export const STATUS_COLORS = {
  confirmed: "bg-emerald-50 text-emerald-700 border-emerald-100",
  completed: "bg-slate-100 text-slate-700 border-slate-200",
  cancelled: "bg-neutral-100 text-neutral-500 border-neutral-200",
  no_show: "bg-violet-50 text-violet-700 border-violet-100",
};

export const MODALITY_LABELS = { presencial: "Presencial", phone: "Teléfono", online: "Online" };

export function fmtDateTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  return d.toLocaleString("es-ES", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Fecha/hora local para los <input> date/time. NO usar toISOString(): eso pasa
// a UTC y en España adelantaría/retrasaría una o dos horas el hueco pulsado.
export function toDateInput(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function toTimeInput(d) {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function fmtRelative(value) {
  if (!value) return "";
  const min = Math.floor((Date.now() - new Date(value).getTime()) / 60000);
  if (min < 1) return "ahora mismo";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "ayer" : `hace ${d} días`;
}

export function StatusChip({ value }) {
  const cls = STATUS_COLORS[value] ?? "bg-neutral-100 text-neutral-500 border-neutral-200";
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium border ${cls}`}>
      {STATUS_LABELS[value] ?? value}
    </span>
  );
}

export function ModalityChip({ value }) {
  return (
    <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium border bg-white border-neutral-200 text-neutral-600">
      {MODALITY_LABELS[value] ?? value}
    </span>
  );
}

// ── Cobro online ───────────────────────────────────────────────────────────
// Sin esto había que abrir el panel de Stripe para saber si una cita estaba
// pagada. Las citas sin precio (paymentStatus 'none') no pintan nada: quien no
// cobra online no debe ver ni rastro de esto.
// La palabra IMPORTA. "Retenido" no puede leerse como "cobrado": es la
// diferencia entre cerrar el día creyendo que has cobrado y saber que aún no.
// Por eso ninguno de los estados de retención usa el verde de "Cobrada".
export const PAGO_LABELS = {
  pending: "Pago pendiente",
  authorizing: "Esperando tarjeta",
  authorized: "Retenido, sin cobrar",
  capturing: "Cobrando…",
  paid: "Cobrada",
  refunded: "Devuelta",
  failed: "No se pudo cobrar",
  void: "Sin cobro",
};

export const PAGO_COLORS = {
  pending: "bg-amber-50 text-amber-700 border-amber-100",
  authorizing: "bg-neutral-100 text-neutral-600 border-neutral-200",
  authorized: "bg-amber-50 text-amber-800 border-amber-200",
  capturing: "bg-sky-50 text-sky-700 border-sky-100",
  paid: "bg-emerald-50 text-emerald-700 border-emerald-100",
  refunded: "bg-sky-50 text-sky-700 border-sky-100",
  failed: "bg-red-50 text-red-700 border-red-100",
  void: "bg-neutral-100 text-neutral-500 border-neutral-200",
};

export const PAGO_AYUDA = {
  authorized: "El importe está reservado en su tarjeta. Se cobrará al confirmar la cita.",
  capturing: "Se está cobrando ahora mismo.",
  // 'failed' NO tiene frase fija aquí: depende de POR QUÉ falló. Ver `ayudaCobroFallido`.
  void: "No hay dinero reservado: se liberó o caducó. Puedes confirmarla y cobrar en consulta.",
};

/** Cuánto queda para que muera una retención, en cristiano. */
export function cuantoQuedaDeRetencion(fecha) {
  if (!fecha) return null;
  const ms = new Date(fecha).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  if (ms <= 0) return { texto: "caducada", urgente: true };
  const horas = ms / 3_600_000;
  if (horas < 1) return { texto: `caduca en ${Math.max(1, Math.round(ms / 60_000))} min`, urgente: true };
  if (horas < 48) return { texto: `caduca en ${Math.round(horas)} h`, urgente: horas < 24 };
  return { texto: `caduca en ${Math.round(horas / 24)} días`, urgente: false };
}

/**
 * Los motivos que escribe NUESTRO código cuando retira una cita porque el dinero
 * nunca llegó a moverse (`retirarCitaImpagada`, en `lib/payments/entityHooks.js`).
 * Se comparan literales a propósito: los escribe el flujo de pagos, no una
 * persona, así que o casan exactamente o no son de los nuestros.
 */
export const MOTIVOS_PAGO_SIN_COMPLETAR = new Set([
  "No se completó el pago a tiempo", // el checkout caducó: carrito abandonado
  "El pago no se completó", // liquidación diferida (SEPA, Multibanco…) que nunca cuajó
]);

/**
 * ¿El cobro se quedó a medias por parte del paciente, en vez de rechazarlo el banco?
 *
 * DE DÓNDE SALE (10/08/2026, una clienta de Laura)
 * `paymentStatus: 'failed'` lo escriben DOS caminos que no se parecen en nada:
 *   · `lib/citas/cobroCita.js` — el banco rechaza de verdad la captura;
 *   · `lib/payments/entityHooks.js` — el checkout caducó sin pagarse, o el pago
 *     diferido nunca liquidó. Ahí el banco no ha rechazado nada: no ha llegado a
 *     haber cobro que rechazar.
 * La pantalla enseñaba SIEMPRE el primero, así que se le pudo decir a una
 * paciente que su banco había fallado siendo falso.
 *
 * Solo se afirma lo que consta ESCRITO en la cita. Si el motivo no es uno de los
 * nuestros —una cancelación a mano de la profesional, o un motivo que se borró al
 * reactivar la cita (`app/api/citas/bookings/[id]/route.js`)— devuelve `false` y
 * el texto sale neutro: preferimos decir que no se sabe a acusar al banco sin
 * pruebas. Aquí no se decide nada del cobro, solo lo que se lee en pantalla.
 */
export function pagoQuedoSinCompletar(cancellationReason) {
  return MOTIVOS_PAGO_SIN_COMPLETAR.has(
    typeof cancellationReason === "string" ? cancellationReason.trim() : ""
  );
}

/** La frase corta del globito cuando el cobro consta fallido. */
export function ayudaCobroFallido(cancellationReason) {
  return pagoQuedoSinCompletar(cancellationReason)
    ? "No llegó a completar el pago. No es un rechazo del banco, y no se le ha cobrado nada."
    : "El cobro no se completó y no se le ha cobrado nada. Puedes reintentarlo o pedirle otra tarjeta.";
}

export function PagoChip({ estado, amount, caducaEn, motivoCancelacion = null }) {
  if (!estado || estado === "none") return null;
  const cls = PAGO_COLORS[estado] ?? "bg-neutral-100 text-neutral-500 border-neutral-200";
  const importe = Number.isInteger(amount) && amount > 0 ? ` · ${formatMoney(amount)}` : "";
  const queda = estado === "authorized" ? cuantoQuedaDeRetencion(caducaEn) : null;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium border ${cls}`}
        title={
          estado === "failed" ? ayudaCobroFallido(motivoCancelacion) : (PAGO_AYUDA[estado] ?? undefined)
        }
      >
        {PAGO_LABELS[estado] ?? estado}
        {importe}
      </span>
      {queda && (
        <span className={`text-[11px] ${queda.urgente ? "text-red-600 font-medium" : "text-neutral-400"}`}>
          {queda.texto}
        </span>
      )}
    </span>
  );
}
