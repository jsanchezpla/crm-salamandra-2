/**
 * Piezas compartidas de la UI del módulo Soporte: etiquetas, colores de chips
 * y formato de fechas. Separadas para que bandeja, detalle e informes cuenten
 * la misma historia con los mismos colores.
 */

export const ESTADOS = {
  open: { label: "Abierto", chip: "bg-blue-50 text-blue-700 border-blue-200", dot: "bg-blue-500" },
  in_progress: { label: "En curso", chip: "bg-indigo-50 text-indigo-700 border-indigo-200", dot: "bg-indigo-500" },
  waiting: { label: "Esperando cliente", chip: "bg-amber-50 text-amber-700 border-amber-200", dot: "bg-amber-500" },
  resolved: { label: "Resuelto", chip: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "bg-emerald-500" },
  closed: { label: "Cerrado", chip: "bg-gray-100 text-gray-600 border-gray-200", dot: "bg-gray-400" },
};

export const PRIORIDADES = {
  critical: { label: "Crítica", chip: "bg-red-50 text-red-700 border-red-200" },
  high: { label: "Alta", chip: "bg-orange-50 text-orange-700 border-orange-200" },
  medium: { label: "Media", chip: "bg-sky-50 text-sky-700 border-sky-200" },
  low: { label: "Baja", chip: "bg-gray-50 text-gray-600 border-gray-200" },
};

export const ORDEN_PRIORIDADES = ["critical", "high", "medium", "low"];

export function fmtFecha(valor) {
  if (!valor) return "—";
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return "—";
  return (
    d.toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" }) +
    " · " +
    d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })
  );
}

export function haceCuanto(valor) {
  if (!valor) return "";
  const minutos = Math.floor((Date.now() - new Date(valor).getTime()) / 60000);
  if (minutos < 1) return "ahora mismo";
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `hace ${horas} h`;
  const dias = Math.floor(horas / 24);
  return dias === 1 ? "ayer" : `hace ${dias} días`;
}

/** Tiempo que queda (o que se ha pasado) hasta una fecha límite del SLA. */
export function plazo(dueAt) {
  if (!dueAt) return "";
  const mins = Math.round((new Date(dueAt).getTime() - Date.now()) / 60000);
  const abs = Math.abs(mins);
  const txt = abs < 60 ? `${abs} min` : abs < 48 * 60 ? `${Math.round(abs / 60)} h` : `${Math.round(abs / 1440)} días`;
  return mins >= 0 ? `quedan ${txt}` : `vencido hace ${txt}`;
}

/**
 * Chip SLA de un ticket para la bandeja: lo más urgente primero. Devuelve
 * null si no hay nada que enseñar (SLA apagado o todo en orden holgado).
 */
export function slaChip(sla) {
  if (!sla) return null;
  if (sla.firstResponse?.state === "breached") {
    return { texto: `1ª respuesta ${plazo(sla.firstResponse.dueAt)}`, clase: "bg-red-50 text-red-700 border-red-200" };
  }
  if (sla.resolution?.state === "breached") {
    return { texto: `Resolución ${plazo(sla.resolution.dueAt)}`, clase: "bg-red-50 text-red-700 border-red-200" };
  }
  if (sla.firstResponse?.state === "pending") {
    return { texto: `1ª respuesta: ${plazo(sla.firstResponse.dueAt)}`, clase: "bg-amber-50 text-amber-700 border-amber-200" };
  }
  if (sla.resolution?.state === "pending") {
    return { texto: `Resolver: ${plazo(sla.resolution.dueAt)}`, clase: "bg-gray-50 text-gray-500 border-gray-200" };
  }
  return null;
}
