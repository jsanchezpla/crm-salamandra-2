export function fmt(n, decimals = 2, { fallback = "—" } = {}) {
  if (n === null || n === undefined || n === "") return fallback;
  const num = parseFloat(n);
  if (Number.isNaN(num)) return fallback;
  return num.toLocaleString("es-ES", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

const DIA_MADRID = new Intl.DateTimeFormat("es-ES", {
  timeZone: "Europe/Madrid",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

/**
 * Una fecha tal como la lee una persona: DD/MM/AAAA (AV-0146 de Aumenta).
 * Un «2026-09-15» a secas (DATEONLY) se da la vuelta sin pasar por Date, para
 * no perder un día; un instante (Date o ISO con hora) se lee en hora de Madrid,
 * que cortar el ISO lo da en UTC.
 */
export function fmtDate(d) {
  if (!d) return "—";
  const s = String(d);
  const soloDia = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (soloDia) return `${soloDia[3]}/${soloDia[2]}/${soloDia[1]}`;
  const date = d instanceof Date ? d : new Date(s);
  if (Number.isNaN(date.getTime())) return s;
  return DIA_MADRID.format(date);
}

/** Un instante con su hora de Madrid: «15/09/2026 10:30». */
export function fmtDateTime(d) {
  if (!d) return "—";
  const date = d instanceof Date ? d : new Date(String(d));
  if (Number.isNaN(date.getTime())) return String(d);
  const hora = date.toLocaleTimeString("es-ES", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit" });
  return `${DIA_MADRID.format(date)} ${hora}`;
}
