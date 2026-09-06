/**
 * lib/clients/piezasFicha.js — qué paneles «de consulta» monta la ficha de
 * cliente de cada centro, y con qué palabras.
 *
 * (Fichero nuevo en /lib, regla #2. El motivo: la decisión de qué pestañas
 * lleva la ficha la toma el SERVIDOR —la página, que sabe los módulos del
 * tenant— y la ficha es un componente "use client" que no puede preguntarlo.
 * Escrita dentro del componente sería una lista de slugs; aquí es una regla
 * por módulos que un cliente nuevo cumple de fábrica, igual que
 * `formularioAlta.js` decide qué se pregunta y `vocabulario.js` cómo se llama.)
 *
 * ── DE DÓNDE VIENEN ESTOS TRES PANELES ──────────────────────────────────────
 * Vivían en `modules/overrides/nutri-laura/` y solo los montaba la ficha de
 * Laura, aunque sus tablas (`client_notes`, `client_attachments`, `bookings`) y
 * sus endpoints son de TODOS los clientes desde el principio, gateados solo
 * por `clients` y `citas`. El 18/08/2026 (CLAUDE.md, «En Leads la pirámide
 * está al revés») pasaron a `components/clients/` y el módulo base los monta:
 *
 *   · Notas / Historia clínica — `client_notes`. Entradas de texto con autor y
 *     fecha, borrado y paginación.
 *   · Documentos — `client_attachments`. Ficheros por ficha, con «que la
 *     persona lo vea» en su portal, y las firmas documento a documento.
 *   · Sesiones / Citas — la lista de `bookings` de la ficha con Confirmar y
 *     Rechazar desde ahí mismo.
 *
 * ── POR QUÉ NO SE LOS DAMOS A TODOS ─────────────────────────────────────────
 * Porque en un centro clínico ya existen POR OTRO LADO, con más cuerpo:
 *
 *   · la historia clínica del paciente son las sesiones e informes del módulo
 *     `clinica`, no unas notas sueltas en la ficha de la familia que paga;
 *   · el archivo del cliente es el módulo `documents_avanzado` (carpetas,
 *     buscador, cuota), y `documents.client_id` ya cuelga cada fichero de su
 *     ficha;
 *   · y las sesiones de un paciente son `clinic_sessions`, que ya se llaman
 *     así en su menú. Una segunda «Sesiones» en la ficha de la familia con las
 *     reservas de la agenda sería la misma palabra para dos cosas.
 *
 * Y porque **Aumenta no cambia** (decisión de Jorge, 18/08/2026): es el cliente
 * que más usa el CRM, tiene los tres módulos de arriba, y su ficha tiene que
 * amanecer mañana igual que hoy. Estas reglas la dejan exactamente donde está
 * —y con ella a somos y a la demo general, que tienen la misma forma—. El día
 * que un centro clínico pida la lista de citas en la ficha, se le quita el
 * `!clinica` a `sesiones` y le sale a todos los que tengan Citas: es UN cambio
 * en UNA línea, y a propósito no una lista de slugs.
 *
 * ── LOS DOS AVISOS DE SIEMPRE ───────────────────────────────────────────────
 * · Se decide por MÓDULOS, no por slug, y la condición negativa es la que
 *   importa (igual que en `vocabulario.js`).
 * · nutri_laura sigue en su override y NO pasa por aquí: sus paneles se los
 *   monta ella con sus propias palabras («la paciente»). Lo que decide esta
 *   función es lo que ve el resto.
 */

import { VOCABULARIO_CLIENTE, vocabularioCliente } from "./vocabulario.js";

/**
 * Qué paneles de consulta lleva la ficha de este centro.
 * `tieneModulo` es `hasModule` del contexto (servidor) o un `Set.has`.
 */
export function piezasDeFicha(tieneModulo) {
  const tiene = (k) => !!tieneModulo(k);
  // «Centro clínico» = atiende pacientes. Es lo que separa una ficha de familia
  // de una ficha de empresa, y de ahí cuelgan casi todos los paneles de abajo.
  const clinico = tiene("pacientes") || tiene("clinica");
  return {
    notas: tiene("clients") && !tiene("clinica"),
    documentos: tiene("clients") && !tiene("documents_avanzado"),
    sesiones: tiene("citas") && !tiene("clinica"),

    /* ── Paneles que hasta el 25/08/2026 salían SIEMPRE ────────────────────
     *
     * Se gatean porque Rodrigo abrió la ficha de RTVE —una radio, en el CRM de
     * booking de una cantante— y se encontró con esto:
     *
     *   «Padres y tutores — sin tutores»
     *   «Esta familia todavía no tiene contrato subido»
     *   «Consulta externa… su historia clínica y sus documentos»
     *   «Avisos de mis citas por correo / por WhatsApp»
     *
     * Ninguno de los cuatro se escondía por módulo: unos solo miraban si el
     * usuario era admin y otros esperaban un 403 que nunca llegaba, porque su
     * endpoint gatea por `clients` y `clients` lo tiene todo el mundo.
     *
     * Se comprobó en producción antes de esconderlos: de los seis clientes sin
     * módulos clínicos, NINGUNO tiene un solo dato en los cuatro paneles.
     * Aumenta, que sí tiene 965 fichas con tutores, los conserva todos porque
     * tiene los tres módulos. No se le esconde nada a nadie que lo use.
     */

    // Padres y tutores: quien firma por un menor. Sin pacientes no hay menores.
    tutores: tiene("pacientes"),

    // Consulta externa: viene por un acuerdo con una empresa y su HISTORIA
    // CLÍNICA se guarda aquí. Es clínico de arriba abajo.
    consultaExterna: clinico,

    // El Contrato de Prestación de Servicios del centro, que se firma en el
    // ÁREA PRIVADA — y el área privada es de Citas. Sin Citas no hay portal,
    // así que «Firmas en el portal: 0 de 1» no significa nada.
    // Ojo: no basta con tener `documents`. Un cliente puede querer el archivo
    // de documentos (riders, dosieres) y no tener portal ninguno.
    contratoPortal: tiene("citas"),

    // Por dónde acepta que se le avise DE SUS CITAS. Sin Citas no hay avisos
    // que preferir.
    avisosCitas: tiene("citas"),

    // Qué campañas de mailing ha recibido y si las abrió (sprint 2 del módulo,
    // 06/09/2026). Solo donde hay módulo; la pestaña además se esconde sola
    // si a esa ficha nunca se le ha mandado nada.
    mailing: tiene("mailing"),
  };
}

/** Todo apagado: lo que recibe la ficha si el servidor no ha podido decidir. */
export const PIEZAS_NINGUNA = Object.freeze({
  notas: false,
  documentos: false,
  sesiones: false,
  tutores: false,
  consultaExterna: false,
  contratoPortal: false,
  avisosCitas: false,
  mailing: false,
});

/**
 * Las palabras de cada panel según cómo se llame el cliente en ese centro.
 *
 * Los textos que llevan «el cliente» / «el paciente» salen de aquí para que
 * los tres paneles hablen igual que el sidebar y la pantalla de Clientes. En
 * la consulta de nutrición las notas SON la historia clínica y las citas SON
 * sesiones —es como las llama la propia Laura—; en el resto son notas y citas.
 */
export function textosPiezas(vocab = VOCABULARIO_CLIENTE) {
  const esPaciente = vocab.singular === "paciente";
  const el = `el ${vocab.singular}`; // «el cliente» / «el paciente»
  const este = `este ${vocab.singular}`;
  return {
    notas: esPaciente
      ? {
          pestana: "Historia clínica",
          titulo: "Nueva entrada de historia clínica",
          placeholder: `Evolución, observaciones, acuerdos de la sesión… (uso interno, no lo ve ${el})`,
          boton: "Añadir entrada",
          vacio: "La historia clínica está vacía. Escribe la primera entrada arriba.",
        }
      : {
          pestana: "Notas",
          titulo: "Nueva nota",
          placeholder: `Lo que conviene recordar de ${este}… (uso interno, no lo ve ${el})`,
          boton: "Añadir nota",
          vacio: "Todavía no hay notas. Escribe la primera arriba.",
        },
    documentos: {
      pestana: "Documentos",
      limite: `archivos por ${vocab.singular}`,
      loSubio: `Lo subió ${el}`,
      loVe: `${cap(el)} lo ve`,
      queLoVea: `Que ${el} lo vea`,
      faltaFirma: el,
    },
    sesiones: {
      pestana: "Citas",
      titulo: esPaciente ? "Sesiones del paciente" : `Citas de ${este}`,
      vacio: `${cap(este)} no tiene citas registradas.`,
      avisoRechazo: `${cap(el)} recibirá un email automático con tu motivo (si lo escribes).`,
    },
  };
}

/** Piezas y textos de una vez, que es como los pide la página. */
export function fichaSegunModulos(tieneModulo) {
  return {
    piezas: piezasDeFicha(tieneModulo),
    textos: textosPiezas(vocabularioCliente(tieneModulo)),
  };
}

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
