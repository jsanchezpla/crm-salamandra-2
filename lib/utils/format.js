export function fmt(n, decimals = 2, { fallback = "—" } = {}) {
  if (n === null || n === undefined || n === "") return fallback;
  const num = parseFloat(n);
  if (Number.isNaN(num)) return fallback;
  return num.toLocaleString("es-ES", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function fmtDate(d) {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}
