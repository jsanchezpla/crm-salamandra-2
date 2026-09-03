/**
 * lib/buzon/alRegistro.js — de un aviso del Buzón a una tarea del Registro.
 *
 * (Fichero nuevo en /lib, regla #2: la forma de la tarea la necesitan el botón
 * «Enviar al registro» de `/admin/buzon` —`POST /api/admin/buzon/[id]/registro`—
 * y la prueba que la fija, `scripts/_smoke-buzon-al-registro.mjs`. No toca base
 * de datos, para que esa prueba corra sin Postgres.)
 *
 * ── POR QUÉ EXISTE (Rodrigo, 02/09/2026) ────────────────────────────────────
 * «El objetivo de una tarea del buzón es enviarlo al registro para que ahí se
 * arregle.» Hasta hoy eso lo hacía a mano /mailbox: leer el aviso, escribir la
 * tarea en `backlog`, publicar y marcar el aviso «en curso». Aquí está la
 * mitad que se puede hacer sola: convertir el aviso en un bloque con la forma
 * que pide `docs/como-apuntar-en-el-tablero.md` —título con prefijo por tipo,
 * `*Se comprueba*`, `*Dónde*`, `*Comprobado en producción*`— y meterlo en
 * «Sin comprobar», que es la sala de espera de lo que nadie ha ido a ver.
 *
 * Lo que NO hace: decidir prioridad ni reescribir lo que cuenta el cliente.
 * Eso lo hace una persona desde `/admin/tablero`, con el aviso ya dentro.
 */

import { MAX_TITULO, SIN_COMPROBAR } from "../tablero/editor.js";
import { MAX_FICHEROS as MAX_CAPTURAS_POR_TAREA } from "../tablero/tableroStorage.js";
import { referencia } from "./buzon.js";

/**
 * Qué capturas del aviso viajan con la tarea (03/09/2026).
 *
 * ── POR QUÉ VIAJAN ─────────────────────────────────────────────────────────
 * Hasta hoy el botón apuntaba el texto y las capturas se quedaban en el Buzón.
 * Rodrigo: «las capturas adjuntadas al buzón no se envían al registro, y
 * después cuando copio del registro la tarea a Claude no me adjunta la
 * captura». Media captura de pantalla explica más que el texto entero, y quien
 * va a resolver la tarea lee el Registro, no el Buzón.
 *
 * Viajan TODAS las del aviso —las del alta y las del hilo, también las de
 * nuestras notas internas, que son nuestras— por orden de llegada, hasta el
 * tope de una tarea del Registro (3). Si hay más, las que sobran se quedan en
 * el Buzón y la tarea lo dice: el tope del tablero existe por nginx
 * (`tableroStorage.js`), no se levanta desde aquí.
 *
 * Devuelve `{ viajan, quedan }`: las fichas que se copian y cuántas no caben.
 */
export function capturasQueViajan(aviso) {
  const todas = (Array.isArray(aviso?.adjuntos) ? aviso.adjuntos : [])
    .filter((a) => a && a.ruta)
    .slice()
    .sort((a, b) => {
      const ta = new Date(a.createdAt ?? 0).getTime() || 0;
      const tb = new Date(b.createdAt ?? 0).getTime() || 0;
      return ta - tb;
    });
  const viajan = todas.slice(0, MAX_CAPTURAS_POR_TAREA);
  return { viajan, quedan: todas.length - viajan.length };
}

/**
 * La línea del cuerpo que dice que hay capturas. Es el INDICADOR: quien lea la
 * tarea —una persona o el Claude al que se la pegan— sabe que hay algo que ver
 * y dónde. Sin capturas no se escribe nada: una línea que dijera «sin capturas»
 * en cada tarea es ruido.
 */
export function lineaDeCapturas({ viajan, quedan }) {
  const n = viajan.length;
  if (!n) return null;
  const nombres = viajan.map((a) => `«${unaLinea(a.nombre) || "captura"}»`).join(", ");
  const partes = [
    `**Capturas.** ${n === 1 ? "Lleva 1 captura" : `Lleva ${n} capturas`} del Buzón (${nombres}), colgadas de esta tarea en el Registro: se ven en /admin/tablero y se bajan con \`node scripts/registro.mjs capturas <ficha>\`.`,
  ];
  if (quedan) {
    partes.push(
      `${quedan === 1 ? "Otra captura se queda" : `Otras ${quedan} se quedan`} en el Buzón porque una tarea admite ${MAX_CAPTURAS_POR_TAREA}: se ven en /admin/buzon.`
    );
  }
  return partes.join(" ");
}

/** El prefijo del título, como los escribe /mailbox desde el 13/08/2026. */
export const PREFIJO_POR_TIPO = Object.freeze({
  error: "Fallo",
  duda: "Duda",
  mejora: "Mejora",
});

/** dd/mm/aaaa en hora de Madrid; «fecha desconocida» si no hay fecha. */
export function ddmmaaaa(valor) {
  const d = valor instanceof Date ? valor : valor ? new Date(valor) : null;
  if (!d || Number.isNaN(d.getTime())) return "fecha desconocida";
  const partes = new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(d);
  const p = Object.fromEntries(partes.filter((x) => x.type !== "literal").map((x) => [x.type, x.value]));
  return `${p.day}/${p.month}/${p.year}`;
}

/** Todo en una línea: el título y la cola de clientes tienen que caber en una. */
export function unaLinea(valor) {
  return String(valor ?? "").replace(/\s+/g, " ").trim();
}

/**
 * El cuerpo del aviso tal cual lo escribió, pero sin nada que el parser del
 * Registro pueda leer como estructura: una línea que empiece por «#» partiría
 * la tarea en dos (o abriría una sección) y un `<!--id:…-->` colaría una ficha.
 */
export function sinEstructura(valor) {
  return String(valor ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/^\s*#+\s*/, "").replace(/<!--/g, "<!- -"))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** `Buzón - Fallo: <asunto>`, en una línea y dentro del tope del Registro. */
export function tituloDeAviso(aviso) {
  const prefijo = PREFIJO_POR_TIPO[aviso?.tipo] ?? "Aviso";
  // El «·» separa el título de la cola de clientes en la cabecera de la tarea:
  // uno dentro del asunto la partiría por el sitio equivocado.
  const asunto = unaLinea(aviso?.asunto).replace(/·/g, "-").replace(/^#+\s*/, "") || "(sin asunto)";
  const titulo = `Buzón - ${prefijo}: ${asunto}`;
  if (titulo.length <= MAX_TITULO) return titulo;
  return `${titulo.slice(0, MAX_TITULO - 1).trimEnd()}…`;
}

/**
 * La tarea entera, lista para `crearTarea()`: `{ seccion, titulo, quien, cuerpo }`.
 *
 * `quien` es el slug del cliente, que es lo que el tablero usa para agrupar
 * por cliente. `hoy` se pasa para que la prueba fije la fecha.
 */
export function tareaDesdeAviso(aviso, { hoy = new Date() } = {}) {
  const ref = referencia(aviso?.numero);
  const centro = unaLinea(aviso?.tenantNombre) || unaLinea(aviso?.tenantSlug) || "un cliente";
  const quienEscribe = unaLinea(aviso?.usuarioNombre) || "alguien del centro";
  const bloquea = aviso?.bloquea ? "dice que le impide trabajar" : "no marcó que le impida trabajar";
  const cuerpo = sinEstructura(aviso?.cuerpo) || "(sin texto)";
  const pantalla = aviso?.pantalla
    ? `\`${unaLinea(aviso.pantalla)}\`, la pantalla desde la que escribió`
    : "no dijo desde qué pantalla";
  const mensajes = Array.isArray(aviso?.mensajes) ? aviso.mensajes.filter((m) => !m?.interno).length : 0;
  const hilo =
    mensajes > 0
      ? ` El hilo lleva ${mensajes} ${mensajes === 1 ? "mensaje" : "mensajes"}: se lee entero en /admin/buzon.`
      : "";
  const fecha = ddmmaaaa(hoy);
  const capturas = lineaDeCapturas(capturasQueViajan(aviso));

  const lineas = [
    `**Lo que nos cuentan.** ${cuerpo}`,
    "",
    `**De dónde sale.** ${ref} de ${centro}, escrito por ${quienEscribe} el ${ddmmaaaa(aviso?.createdAt)}; ${bloquea}.${hilo} Enviado al Registro desde el Buzón el ${fecha}.`,
    "",
    ...(capturas ? [capturas, ""] : []),
    "*Se comprueba*: pendiente de decir cómo; lo escribe quien vaya a verlo.",
    `*Dónde*: ${pantalla}.`,
    `*Comprobado en producción*: sin comprobar; entró desde el Buzón el ${fecha} y nadie ha ido a verlo aún.`,
  ];

  return {
    seccion: SIN_COMPROBAR,
    titulo: tituloDeAviso(aviso),
    quien: unaLinea(aviso?.tenantSlug) || "varios",
    cuerpo: lineas.join("\n"),
  };
}

/**
 * ¿El Registro ya cita este aviso? Se mira ANTES de apuntar, para no meter dos
 * veces lo mismo: /mailbox lleva desde agosto escribiendo tareas con la
 * referencia dentro y el botón no lo sabe por la fila (`registro_ficha` es del
 * 02/09/2026). Solo se mira el `backlog`: si la tarea ya se cerró y el cliente
 * vuelve a escribir, apuntarla otra vez es lo correcto.
 */
export function yaEstaEnElRegistro(contenido, numero) {
  if (numero == null) return false;
  const ref = referencia(numero).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${ref}(?!\\d)`).test(String(contenido ?? ""));
}
