"use client";

/**
 * components/citas/siguientesDeLaCita.js — «¿y las que vienen después?»
 * (12/09/2026, Rodrigo: «en las citas necesito que si borro o muevo una cita
 * me proponga borrar o mover esa y todas las citas futuras, por si me he
 * equivocado»).
 *
 * ── POR QUÉ ESTO NO ESTÁ EN LA PANTALLA ────────────────────────────────────
 * La pregunta sale desde SIETE sitios: la ficha de la cita (al cambiar la
 * hora, al cancelarla, al borrarla y al aplicar un hueco propuesto por la IA),
 * arrastrar una cita en el calendario, pegarla tras cortarla, y cancelar una
 * cita desde la ficha del paciente, en tres ficheros distintos (dos de ellos de
 * 1.500 líneas: `CitaDetalleModal.jsx` y `CitasModule.jsx`). Con el `fetch` y el diálogo
 * escritos en cada sitio, en un mes una vía preguntaría y otra no —que es
 * exactamente el fallo del que nace esto: arrastrar una cita no preguntaba
 * nada aunque la ficha ya lo hiciera desde el 11/09—.
 *
 * Aquí vive el CÓMO (contar, preguntar, aplicar y contarlo); el texto de cada
 * pregunta vive en `lib/citas/preguntaDeSerie.js` (y la regla de qué es «una
 * siguiente», en `lib/citas/siguientesIguales.js`, que es de servidor); el
 * servidor decide de verdad en `/api/citas/bookings/[id]/siguientes`.
 *
 * ── EL ORDEN, QUE NO ES CAPRICHO ───────────────────────────────────────────
 * No hay serie: «las siguientes» se DEDUCEN de esta cita (mismo niño, mismo
 * tipo, mismo día de la semana y misma hora de pared). De ahí dos reglas:
 *   · CONTAR antes de tocarla. Con la hora ya cambiada, las hermanas serían
 *     otras.
 *   · Al BORRAR, las siguientes van primero y esta al final: si se borra esta
 *     antes, ya no hay de quién deducirlas.
 */

import { preguntaDeSerie, resumenDeSerie } from "../../lib/citas/preguntaDeSerie.js";

/** Qué se dice cuando la llamada se cae a medio camino. */
const FALLO = {
  mover: "Las siguientes no se han movido",
  cancelar: "Las siguientes no se han cancelado",
  borrar: "Las siguientes no se han borrado",
};

/**
 * Cuántas citas iguales a esta vienen después, y hasta cuándo llegan.
 *
 * Se llama ANTES de tocar la cita. `anterior` es la hora que tenía, para
 * cuando quien llama ya la ha movido y hay que buscar las hermanas por la hora
 * vieja. Si algo falla devuelve `null`: no preguntar por la serie no puede
 * impedir mover o borrar la cita que se tenía delante.
 */
export async function contarSiguientes(bookingId, { anterior = null } = {}) {
  try {
    const q = anterior ? `?anterior=${encodeURIComponent(anterior)}` : "";
    const r = await fetch(`/api/citas/bookings/${bookingId}/siguientes${q}`, { cache: "no-store" });
    const j = await r.json();
    return j.ok ? j.data : null;
  } catch {
    return null;
  }
}

/** ¿Hay serie de la que hablar? */
export const haySiguientes = (serie) => Number(serie?.siguientes ?? 0) > 0;

/**
 * Sobre qué se aplica lo que se acaba de pulsar: `"solo"` esta cita,
 * `"serie"` esta y las que se repiten después, o `null` (no hacer nada).
 *
 * Se pregunta ANTES de tocar nada, que es lo que distingue esto de mover: una
 * cita borrada no vuelve, así que la elección no puede llegar después.
 *
 * Sin siguientes no hay nada que elegir y se pide la confirmación de siempre
 * (`sinSerie`); sin ella, se sigue adelante como si se hubiera dicho «solo».
 */
export async function alcanceDeSerie(accion, { serie, lineas = [], elegir, confirmar, sinSerie = null }) {
  if (haySiguientes(serie) && elegir) {
    return await elegir(preguntaDeSerie(accion, { n: serie.siguientes, hasta: serie.hasta, lineas }));
  }
  if (sinSerie && confirmar) return (await confirmar(sinSerie)) ? "solo" : null;
  return "solo";
}

/**
 * Hace con las siguientes lo que se acaba de hacer con esta, y lo cuenta:
 * cuántas han salido y, con su fecha y su motivo, las que se han quedado como
 * estaban (la que choca con otra cita al mover, la que está cobrada al
 * borrar). Callarse esas es lo que hace que alguien dé por resuelta una serie
 * que sigue en pie.
 *
 * @returns `{ hechas, saltadas }`, o `null` si no se pudo (ya avisado).
 */
export async function aplicarALasSiguientes(accion, { bookingId, motivo = null, anterior = null, nuevo = null, avisar, ocupado }) {
  ocupado?.(true);
  try {
    const url = `/api/citas/bookings/${bookingId}/siguientes`;
    const peticion =
      accion === "borrar"
        ? { method: "DELETE" }
        : {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              accion === "cancelar" ? { accion: "cancelar", motivo } : { scheduledAtAnterior: anterior, scheduledAt: nuevo }
            ),
          };
    const r = await fetch(url, peticion);
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || FALLO[accion]);
    const hechas = j.data.movidas ?? j.data.canceladas ?? j.data.borradas ?? 0;
    const saltadas = j.data.saltadas ?? [];
    // El aviso NO resuelve hasta que lo cierran: primero se suelta la pantalla.
    ocupado?.(false);
    await avisar?.(resumenDeSerie(accion, { hechas, saltadas }));
    return { hechas, saltadas };
  } catch (e) {
    ocupado?.(false);
    await avisar?.({ titulo: FALLO[accion], texto: e.message });
    return null;
  }
}

/**
 * Mover las siguientes, que se pregunta DESPUÉS de mover esta: la cita que se
 * tenía delante ya está donde se quería, y si la respuesta es no, las demás se
 * quedan como estaban. Vale para las tres formas de mover una cita —la ficha,
 * arrastrarla y pegarla tras cortarla—.
 */
export async function ofrecerMoverSiguientes({ bookingId, serie, anterior, nuevo, confirmar, avisar, ocupado }) {
  if (!haySiguientes(serie)) return null;
  const quiere = await confirmar(preguntaDeSerie("mover", { n: serie.siguientes, hasta: serie.hasta }));
  if (!quiere) return null;
  return await aplicarALasSiguientes("mover", { bookingId, anterior, nuevo, avisar, ocupado });
}
