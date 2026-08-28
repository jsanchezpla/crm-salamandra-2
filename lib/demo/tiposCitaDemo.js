/**
 * lib/demo/tiposCitaDemo.js — los tipos de cita que se siembran en las demos.
 *
 * ── POR QUÉ ESTO SALIÓ DEL SEED (28/08/2026) ────────────────────────────────
 * Los ocho tipos de las cuatro demos NO SE PODÍAN GUARDAR. Nacían aceptando
 * modalidad presencial con la dirección vacía, y la comprobación que exige esa
 * dirección corre al GUARDAR, no al sembrar: o sea que nacían en un estado que
 * la propia pantalla rechaza. Abrir uno en Citas → Tipos de cita y darle a
 * guardar —aunque solo se le cambiara el nombre— devolvía «El campo 'location'
 * es obligatorio cuando se acepta modalidad presencial». En cuatro de los ocho
 * pasaba lo mismo con el teléfono.
 *
 * Y las demos son el escaparate: dan sesión de admin a cualquier visitante, así
 * que quien entraba a curiosear y tocaba un tipo de cita se llevaba un error
 * rojo con jerga de programador dentro.
 *
 * ── POR QUÉ EN /lib Y NO EN EL SEED ─────────────────────────────────────────
 * Porque el fallo no fue el dato, fue que NADIE LO MIRABA. El seed escribía
 * directo al modelo, saltándose la regla de `lib/citas/validation.js` que la
 * pantalla sí aplica. Mientras el catálogo viviera dentro de un script de 900
 * líneas no había dónde apuntar una prueba.
 *
 * Aquí sí: `scripts/_smoke-tipos-cita-demo.mjs` pasa CADA entrada por
 * `validateModalityFields`, la misma función que usa el endpoint. Si mañana
 * alguien añade un tipo telefónico sin número, `npm test` se pone rojo antes de
 * que llegue a ninguna demo.
 *
 * Este fichero NO IMPORTA NADA, igual que su hermano `demos.js`: lo lee un
 * script de Node suelto y tiene que poder cargarse sin arrastrar el ORM.
 */

/**
 * Dirección y teléfono de mentira, a propósito.
 *
 * Un escaparate no puede enseñar la dirección real de una clínica real, y un
 * teléfono con pinta de auténtico acabaría sonando en casa de alguien. «Calle
 * Ejemplo» es el marcador de posición de toda la vida, y el 900 000 000 es un
 * número gratuito que no está asignado a nadie: se lee como un teléfono y no
 * llama a ninguna parte.
 */
export const SITIO_DEMO = "Calle Ejemplo 1, 28001 Madrid";
export const TELEFONO_DEMO = "+34 900 000 000";

/**
 * Los tipos de cita de una demo, en orden.
 *
 * `modalities` manda sobre los otros dos campos: si lleva `presencial` hace
 * falta `location`, y si lleva `phone` hace falta `phoneNumber`. `online` no
 * exige nada (el modo por defecto es el manual: la profesional pega el enlace
 * en la cita concreta, ver `lib/citas/validation.js`).
 */
export const TIPOS_CITA_DEMO = [
  {
    name: "Primera consulta",
    slug: "primera-consulta",
    duration: 60,
    color: "#3B82F6",
    modalities: ["presencial", "online"],
    location: SITIO_DEMO,
  },
  {
    name: "Sesión seguimiento",
    slug: "sesion-seguimiento",
    duration: 45,
    color: "#10B981",
    modalities: ["presencial", "online", "phone"],
    location: SITIO_DEMO,
    phoneNumber: TELEFONO_DEMO,
  },
];
