"use client";

/**
 * TimestampRelative — render textual relativo ("hace 5 min") con tooltip
 * absoluto (fecha completa, zona horaria Madrid). Si el timestamp supera
 * 30 días, muestra fecha absoluta corta en lugar del relativo.
 *
 * Pensado para timelines (notas, adjuntos, citas) del módulo Clientes en
 * el override nutri-laura. Sin libs externas, sin estado, sin re-render
 * automático: si el componente queda montado mucho rato, el texto se
 * queda "congelado" — para el caso de uso (timelines con pocas filas
 * visibles a la vez) es aceptable.
 *
 * Props:
 *   - date: string ISO o Date (obligatorio; null/undefined → "—").
 *   - className: clases tailwind opcionales para el <time>.
 */

const ABSOLUTE_OPTS = {
  day: "2-digit",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Madrid",
};

const SHORT_OPTS = {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "Europe/Madrid",
};

function fmtAbsolute(d) {
  return d.toLocaleString("es-ES", ABSOLUTE_OPTS);
}

function fmtShort(d) {
  return d.toLocaleDateString("es-ES", SHORT_OPTS);
}

function fmtRelative(d) {
  const ms = Date.now() - d.getTime();
  if (ms < 0) return "en el futuro";
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "hace un momento";
  if (min < 60) return min === 1 ? "hace 1 minuto" : `hace ${min} minutos`;
  const h = Math.floor(min / 60);
  if (h < 24) return h === 1 ? "hace 1 hora" : `hace ${h} horas`;
  const days = Math.floor(h / 24);
  if (days === 1) return "ayer";
  return `hace ${days} días`;
}

export default function TimestampRelative({ date, className = "" }) {
  if (!date) return <span className={className}>—</span>;
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return <span className={className}>—</span>;

  const days = Math.floor((Date.now() - d.getTime()) / (24 * 3600 * 1000));
  const display = days > 30 ? fmtShort(d) : fmtRelative(d);

  return (
    <time
      dateTime={d.toISOString()}
      title={fmtAbsolute(d)}
      className={className}
    >
      {display}
    </time>
  );
}
