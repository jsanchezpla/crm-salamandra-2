/**
 * lib/citas/preguntaDeSerie.js — cómo se PREGUNTA por «esta y las siguientes»
 * (12/09/2026, Rodrigo: «en las citas necesito que si borro o muevo una cita
 * me proponga borrar o mover esa y todas las citas futuras, por si me he
 * equivocado»).
 *
 * ── POR QUÉ ES UN FICHERO Y NO DOS LÍNEAS EN CADA PANTALLA ─────────────────
 * La pregunta sale desde SIETE sitios: la ficha de la cita (al cambiar la
 * hora, al cancelarla, al borrarla y al aplicar un hueco propuesto por la IA),
 * arrastrar una cita en el calendario, pegarla tras cortarla, y cancelar una
 * cita desde la ficha del paciente. Siete textos escritos a mano acaban diciendo
 * siete cosas distintas del mismo aviso, y alguno se olvida de decir lo que
 * importa (que al borrar en bloque no sale ningún correo, que la cobrada se
 * queda).
 *
 * ── POR QUÉ NO VIVE EN `siguientesIguales.js`, QUE ES SU CASA ──────────────
 * Porque esto lo lee el NAVEGADOR. `siguientesIguales.js` importa `slots.js`,
 * que importa `festivos.js`, que hace `await import("sequelize")`: meterlo en
 * un componente de cliente arrastra el ORM entero al bundle y el build se cae
 * (comprobado hoy). Aquí no hay ni un import, a propósito.
 *
 * La regla de qué es «una siguiente» sigue en `lib/citas/siguientesIguales.js`
 * (servidor) y el cómo se pide y se aplica, en
 * `components/citas/siguientesDeLaCita.js` (navegador).
 */

/** «37 citas más como esta», y hasta cuándo llegan. */
export function frasesDeSerie({ n, hasta }) {
  const cuantas = n === 1 ? "1 cita más como esta" : `${n} citas más como esta`;
  const cuando = `mismo día de la semana y misma hora${hasta ? `, hasta el ${hasta}` : ""}`;
  return { cuantas, cuando, frase: `Hay ${cuantas} de aquí en adelante (${cuando}).` };
}

/**
 * El diálogo que pregunta por la serie.
 *
 * `mover` se pregunta DESPUÉS de mover esta —ya está donde se quería, así que
 * es un sí o un no (`confirmar`)—. `cancelar` y `borrar` se preguntan ANTES de
 * tocar nada, porque una cita borrada no vuelve: son tres respuestas
 * (`elegir`) —solo esta, la serie entera, o dejarlo como está—.
 *
 * `lineas` son las advertencias que ya traiga la pantalla: que al borrar no
 * sale ningún correo, que la sesión del bono vuelve a quedar libre…
 */
export function preguntaDeSerie(accion, { n, hasta, lineas = [] } = {}) {
  const { frase } = frasesDeSerie({ n, hasta });
  if (accion === "mover") {
    return {
      titulo: "¿Mover también las siguientes?",
      texto: `${frase} ¿Las muevo también a la nueva hora? Si alguna choca con otra cita, esa se queda donde está y te lo digo.`,
      confirmar: n === 1 ? "Sí, moverla también" : "Sí, moverlas también",
      cancelar: "Solo esta",
    };
  }
  if (accion === "cancelar") {
    return {
      titulo: "Cancelar la cita",
      texto: [...lineas, frase].join("\n\n"),
      opciones: [
        { valor: "solo", label: "Cancelar solo esta cita" },
        {
          valor: "serie",
          label: n === 1 ? "Cancelar esta y la siguiente" : `Cancelar esta y las ${n} siguientes`,
          tono: "peligro",
          pista: "De las siguientes no se avisa por correo: díselo tú",
        },
      ],
      cancelar: "Dejarlo como está",
    };
  }
  return {
    titulo: "Borrar la cita",
    texto: [...lineas, frase].join("\n\n"),
    opciones: [
      { valor: "solo", label: "Borrar solo esta cita", tono: "peligro" },
      {
        valor: "serie",
        label: n === 1 ? "Borrar esta y la siguiente" : `Borrar esta y las ${n} siguientes`,
        tono: "peligro",
        pista: "La que esté cobrada se queda y te lo digo",
      },
    ],
    cancelar: "No borrar nada",
  };
}

/** Cómo se llama en pantalla lo que se acaba de hacer con la serie. */
const RESUMEN = {
  mover: { una: "cita movida a la nueva hora", varias: "citas movidas a la nueva hora", bien: "Movidas", aMedias: "Movidas, con huecos", resto: "Estas se han quedado donde estaban:" },
  cancelar: { una: "cita cancelada", varias: "citas canceladas", bien: "Canceladas", aMedias: "Canceladas, menos algunas", resto: "Estas siguen en pie:" },
  borrar: { una: "cita borrada", varias: "citas borradas", bien: "Borradas", aMedias: "Borradas, menos algunas", resto: "Estas siguen ahí:" },
};

/**
 * Lo que se cuenta al acabar: cuántas se hicieron y, con su fecha y su motivo,
 * las que se han quedado como estaban. Callarse las que no se hicieron es lo
 * que hace que alguien dé por desprogramada una cita que sigue en pie.
 */
export function resumenDeSerie(accion, { hechas = 0, saltadas = [] } = {}) {
  const r = RESUMEN[accion] ?? RESUMEN.mover;
  const lineas = saltadas.slice(0, 8).map((x) => `· ${x.fecha}: ${x.motivo}`);
  if (saltadas.length > 8) lineas.push(`· … y ${saltadas.length - 8} más`);
  return {
    titulo: saltadas.length ? r.aMedias : r.bien,
    texto:
      `${hechas} ${hechas === 1 ? r.una : r.varias}.` +
      (saltadas.length ? `\n\n${r.resto}\n${lineas.join("\n")}` : ""),
  };
}
