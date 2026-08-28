/**
 * contactoCita.js — qué contacto necesita una cita, y qué se pierde sin él.
 *
 * ── DE DÓNDE SALE (28/08/2026, Lau de Aumenta) ─────────────────────────────
 *
 * El alta manual exigía correo Y teléfono, siempre, y no dejaba guardar sin los
 * dos. Medido en producción ese día: de los 1.050 pacientes activos de Aumenta,
 * **164 no se podían citar** porque su familia no tiene correo ni teléfono en
 * ningún sitio del CRM —ni en la ficha, ni en los tutores, ni en la pestaña de
 * contactos—. Ese dato no existe y ningún cambio de código lo inventa: o se le
 * pide a la familia, o se deja de exigir. Jorge eligió lo segundo, avisando.
 *
 * ── EL PRINCIPIO YA ESTABA ACEPTADO, SOLO QUE EN PEQUEÑO ────────────────────
 *
 * El servidor ya permitía crear una cita sin correo en un caso: la «consulta
 * externa». Y el motivo que escribió Rodrigo el 07/08/2026 es literalmente el
 * de los 164:
 *
 *   «Exigirle un correo obligaba a inventarse uno, que es peor que no tenerlo:
 *    acaba habiendo citas apuntadas a direcciones falsas.»
 *
 * Un requisito que no se puede cumplir no protege el dato: lo ensucia. La gente
 * escribe `sincorreo@sincorreo.com` para poder seguir, y entonces el CRM cree
 * que tiene un correo bueno y le manda ahí la confirmación. Es peor que el
 * hueco, porque el hueco se ve.
 *
 * Así que la excepción se generaliza y deja de ser un caso especial. Comprobado
 * antes de tocarla: `es_consulta_externa` está a `false` en las **1.083 fichas
 * de Aumenta y en las de todos los demás clientes** — o sea que esa excepción no
 * la ha usado nadie nunca, y no se pierde nada al subsumirla.
 *
 * ── POR QUÉ EN /lib Y NO EN CADA SITIO ─────────────────────────────────────
 *
 * Porque la regla estaba escrita CUATRO veces —la pantalla, el POST, el PATCH y
 * la reserva pública— y ya divergían: la pantalla era más dura que el servidor,
 * y por eso la excepción de la consulta externa era inalcanzable desde el CRM.
 * Añadir una quinta versión relajada era pedir el mismo lío otra vez.
 *
 * Aquí la regla tiene un nombre y una prueba, y la usan la pantalla y el
 * servidor. Si mañana se decide volver a exigirlo, o exigirlo solo en algunos
 * centros, se cambia en un sitio.
 *
 * ── LO QUE ESTO **NO** ARREGLA, Y ESTÁ MEDIDO ──────────────────────────────
 *
 * Una cita sin correo no descuenta del bono: `asignarSesion` engancha el bono
 * por correo, mientras que el listado de bonos ya engancha también por ficha.
 * Es una asimetría real y NO se toca aquí, porque mueve dinero y porque medido
 * el 28/08/2026 no afecta a nadie: los únicos bonos de toda la plataforma son
 * los 15 de `nutri_laura`, cuyos clientes tienen todos su correo, y **Aumenta
 * no tiene ni uno**. Queda dicho para el día que eso cambie.
 *
 * Y el área privada de la familia entra por CORREO. Una cita sin correo no sale
 * ahí — pero es que una familia sin correo tampoco puede entrar al área privada,
 * así que no se pierde nada que hoy tuviera.
 */

/** Lo que hay que rellenar, con el nombre que ve la persona. */
const CANALES = [
  {
    clave: "correo",
    rotulo: "correo",
    de: (c) => c.clientEmail,
    // Lo que esa familia NO va a recibir. Se escribe en su idioma, no en el
    // nuestro: quien apunta la cita tiene que poder decidir con esto delante.
    pierde: [
      "la confirmación por correo",
      "el recordatorio de la víspera",
      "el enlace para cancelar o cambiar la cita",
      "verla en su área privada",
    ],
  },
  {
    clave: "telefono",
    rotulo: "teléfono",
    de: (c) => c.clientPhone,
    pierde: ["poder avisarle por teléfono si hay un cambio de última hora"],
  },
];

const vacio = (v) => !v || !String(v).trim();

/**
 * Repasa el contacto de una cita.
 *
 * Devuelve SIEMPRE un objeto; nunca lanza ni bloquea. Decidir qué hacer con
 * `falta` es de quien llama: la pantalla pide confirmación, el servidor lo deja
 * pasar y lo apunta.
 *
 * @param {{clientEmail?: string|null, clientPhone?: string|null}} datos
 * @returns {{completo: boolean, falta: string[], rotulos: string[], seVaAPerder: string[]}}
 */
export function repasarContactoDeCita(datos) {
  const c = datos ?? {};
  const faltantes = CANALES.filter((canal) => vacio(canal.de(c)));
  return {
    completo: faltantes.length === 0,
    falta: faltantes.map((f) => f.clave),
    rotulos: faltantes.map((f) => f.rotulo),
    seVaAPerder: faltantes.flatMap((f) => f.pierde),
  };
}

/**
 * La frase que se le enseña a quien está apuntando la cita.
 *
 * Se construye aquí y no en el JSX para que diga lo mismo en la pantalla, en el
 * correo de aviso y en cualquier sitio que la necesite mañana. Devuelve null si
 * no falta nada, para poder hacer `const aviso = avisoDeContacto(...); if
 * (aviso) …` sin repetir la condición.
 */
export function avisoDeContacto(repaso) {
  if (!repaso || repaso.completo) return null;
  const que = repaso.rotulos.join(" ni ");
  return {
    titulo: `Esta familia no tiene ${que}`,
    texto:
      `Puedes crear la cita igualmente, pero esta familia se queda sin:\n\n` +
      repaso.seVaAPerder.map((p) => `· ${p}`).join("\n") +
      `\n\nTendrás que avisarle tú.`,
    confirmar: "Crearla igualmente",
  };
}
