/**
 * modules/mailing/api.js — hablar con /api/mailing desde las pantallas, sin
 * repetir el `fetch` + `res.json()` + «si no ok, lanza» en cada botón.
 *
 * Devuelve `data` del sobre `{ ok, data }` de la API, o lanza un Error con el
 * mensaje que mandó el servidor (que es el que se enseña tal cual).
 */
export async function api(ruta, { metodo = "GET", body, form } = {}) {
  const opciones = { method: metodo, headers: {} };
  if (form) opciones.body = form;
  else if (body !== undefined) {
    opciones.headers["Content-Type"] = "application/json";
    opciones.body = JSON.stringify(body);
  }
  const res = await fetch(`/api/mailing${ruta}`, opciones);
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  if (!res.ok || json?.ok === false) throw new Error(json?.error || `Error ${res.status}`);
  return json?.data ?? json;
}

export const inputCls =
  "w-full rounded-lg px-3 py-2 text-sm text-neutral-700 bg-white border border-neutral-200 focus:outline-none focus:border-neutral-400 transition disabled:bg-neutral-50";

export const botonPrimario =
  "inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-40 transition hover:opacity-90";
export const botonSecundario =
  "inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border border-neutral-200 text-neutral-700 hover:border-neutral-400 disabled:opacity-40 transition bg-white";
export const estiloPrimario = { background: "var(--color-primary, #1B3A2D)" };

export const ESTADO_CAMPANA = {
  borrador: { label: "Borrador", cls: "bg-neutral-100 text-neutral-600" },
  programada: { label: "Programada", cls: "bg-sky-100 text-sky-700" },
  enviando: { label: "Enviando", cls: "bg-amber-100 text-amber-700" },
  pausada: { label: "Pausada", cls: "bg-orange-100 text-orange-700" },
  enviada: { label: "Enviada", cls: "bg-emerald-100 text-emerald-700" },
  cancelada: { label: "Cancelada", cls: "bg-neutral-200 text-neutral-500" },
};

export function Chip({ estado }) {
  const e = ESTADO_CAMPANA[estado] ?? { label: estado, cls: "bg-neutral-100 text-neutral-600" };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${e.cls}`}>{e.label}</span>;
}

export function fecha(v, conHora = true) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-ES", conHora ? { dateStyle: "short", timeStyle: "short" } : { dateStyle: "short" });
}

export function num(n) {
  return new Intl.NumberFormat("es-ES").format(Number(n) || 0);
}
