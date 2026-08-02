"use client";

/**
 * TimestampRelative — render textual relativo ("hace 5 min") con tooltip
 * absoluto (fecha completa, zona horaria Madrid). Si el timestamp supera
 * 30 días, muestra fecha absoluta corta en lugar del relativo.
 *
 * Pensado para timelines (notas, adjuntos, citas) del módulo Clientes en
 * el override nutri-laura. Sin libs externas, sin re-render automático: si el
 * componente queda montado mucho rato, el texto se queda "congelado" — para el
 * caso de uso (timelines con pocas filas visibles a la vez) es aceptable.
 *
 * ── Por qué la hora se lee DESPUÉS de montar (arreglado 02/08/2026) ─────────
 *
 * Antes se llamaba a `Date.now()` durante el render. En un componente de
 * cliente eso es un **desajuste de hidratación**: el servidor pinta "hace 5
 * minutos", el navegador calcula su propio ahora y pinta "hace 6", y React
 * avisa y reemplaza el nodo. Con textos de un timeline no se nota, pero es un
 * fallo real y el linter lo señala con razón.
 *
 * Ahora el primer pintado usa la fecha ABSOLUTA (determinista, igual en
 * servidor y cliente) y el texto relativo aparece al montar. Nadie ve el
 * cambio: ocurre en el mismo instante en que la página se vuelve interactiva.
 *
 * Props:
 *   - date: string ISO o Date (obligatorio; null/undefined → "—").
 *   - className: clases tailwind opcionales para el <time>.
 */

import { useEffect, useState } from "react";

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

function fmtRelative(d, ahora) {
  const ms = ahora - d.getTime();
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
  // `null` hasta que monta: es lo que hace que servidor y cliente pinten lo
  // mismo en el primer render. Ver cabecera.
  const [ahora, setAhora] = useState(null);
  useEffect(() => setAhora(Date.now()), []);

  if (!date) return <span className={className}>—</span>;
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return <span className={className}>—</span>;

  const days = ahora === null ? null : Math.floor((ahora - d.getTime()) / (24 * 3600 * 1000));
  const display = ahora === null || days > 30 ? fmtShort(d) : fmtRelative(d, ahora);

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
