/**
 * lib/training/formacionAbierta.js — el interruptor «formación abierta» del
 * módulo Formación, y las palabras de la portada según esté o no encendido.
 *
 * (Fichero nuevo en /lib, regla #2. El motivo: la portada de Formación y el
 * menú lateral tienen que decidir LO MISMO —si se enseñan Empresas,
 * Cuestionarios y el botón de sincronizar con WordPress— y hasta el 18/08/2026
 * lo decidían por separado: la portada con un override entero para Aumenta y
 * el menú con una lista de slugs. Aquí está la regla una vez, y los dos la
 * leen.)
 *
 * ── QUÉ ES «FORMACIÓN ABIERTA» ──────────────────────────────────────────────
 * Un centro que vende cursos a PERSONAS, una a una: familias, profesionales
 * sueltos. No matricula empresas, no evalúa con cuestionarios y sus cursos no
 * llegan de un TutorLMS. Es Aumenta (psicopedagogía, B2C). Lo contrario es la
 * academia online de Retorika: empresas que compran formación para sus
 * empleados, exámenes, y WordPress mandando cursos y matrículas.
 *
 * ── POR QUÉ ES UN INTERRUPTOR Y NO UNA REGLA POR MÓDULOS ────────────────────
 * Las otras reglas de la casa (`vocabulario.js`, `piezasFicha.js`) se deciden
 * por los módulos del tenant, porque ahí hay algo que mirar. Aquí no lo hay:
 * Aumenta y Retorika tienen exactamente los mismos módulos y venden formación
 * de dos maneras distintas. Es un «esto sí / esto no» puro: el peldaño 3 de
 * la escalera de la regla #16 (CLAUDE.md), `featureFlags` del módulo.
 *
 * ── POR QUÉ NO SE LEEN LAS BANDERAS VIEJAS ──────────────────────────────────
 * Aumenta lleva desde junio en `logicOverrides` de `training` tres banderas
 * —`b2bEnabled`, `quizzesEnabled`, `tutorlmsConnected`, todas a false— que el
 * doc describía como «indicativas: no las lee nadie». Parecen hechas para esto,
 * y NO se usan a propósito: nutri_laura también lleva `b2bEnabled: false` y
 * `tutorlmsConnected: false`, y ve la portada COMPLETA porque lo pidió («Laura
 * quiere ver la UI completa», app/(dashboard)/formacion/page.jsx). Leerlas le
 * habría quitado Empresas y el botón de sincronizar sin que nadie se lo
 * pidiera. Un interruptor nuevo y explícito no arrastra ese pasado; las
 * banderas viejas se quedan como están, inertes, hasta que alguien decida
 * borrarlas.
 *
 * ── CÓMO SE ENCIENDE ────────────────────────────────────────────────────────
 *   node scripts/formacion-abierta.js <slug> --encender   (o --apagar)
 * Escribe `featureFlags.formacionAbierta` en la fila `training` del tenant e
 * invalida su caché. Sin código, sin despliegue.
 */

/** La clave dentro de `tenant_modules.feature_flags` del módulo `training`. */
export const FLAG_FORMACION_ABIERTA = "formacionAbierta";

/**
 * ¿Es formación abierta? `flags` es el JSONB `featureFlags` de la fila
 * `training` del tenant (o el `hasFeatureFlag` del contexto, si se prefiere).
 * Sin bandera → NO: la portada completa es la de siempre y nadie la pierde por
 * defecto.
 */
export function esFormacionAbierta(flags) {
  if (typeof flags === "function") return !!flags(FLAG_FORMACION_ABIERTA);
  return flags?.[FLAG_FORMACION_ABIERTA] === true;
}

/** Los hijos del menú de Formación que una formación abierta no ofrece. */
export const HIJOS_OCULTOS_FORMACION_ABIERTA = ["formacion-empresas", "formacion-cuestionarios"];

/**
 * Las palabras de la portada. Las de «completa» son las de siempre; las de
 * «abierta» son las que valen para cualquier centro B2C. Un tenant puede pisar
 * las suyas desde la página (`TEXTOS_POR_TENANT`), que es donde viven las
 * frases que solo son de uno.
 */
export function textosPortada(abierta) {
  if (!abierta) {
    return {
      eyebrow: "Conocimiento · Formación",
      tituloSufijo: "— empresas, cursos, alumnos",
      intro: "Gestión centralizada de empresas cliente, catálogo de cursos y matrículas de alumnos.",
      ayudaModulo:
        "Es el centro de control de tu academia online. Desde aquí gestionas las empresas que compran formación, tu catálogo de cursos, los alumnos inscritos y los exámenes que han hecho. Los datos llegan automáticamente desde tu WordPress, no tienes que meterlos a mano.",
      descCursos: "Catálogo de cursos sincronizados con WordPress",
      ayudaCursos:
        "El listado completo de cursos que ofreces. Pulsa cualquier curso para abrir su ficha: ahí ves toda la información del curso y los registros del curso (los alumnos apuntados con sus datos). También puedes editar el nombre, activar o desactivar un curso y ver cuándo se sincronizó por última vez con tu academia online.",
      descAlumnos: "Las personas, una ficha por cada una",
      ayudaAlumnos:
        "Todas las personas registradas en tu plataforma, tanto las que se apuntan por su cuenta como los empleados que vienen de una empresa. Una fila por PERSONA, no por curso. Puedes buscar por nombre o email, filtrar por empresa y exportar la lista a Excel. Para dar de alta a los de una empresa de golpe, se hace desde Empresas: abre su ficha e importa el Excel de empleados.",
      descMatriculas: "Quién está apuntado a qué curso",
      ayudaMatriculas:
        "Aquí no se dan de alta personas: se ve quién está apuntado a qué. Cada fila es una matrícula —el alumno, el curso y la fecha—, así que la misma persona sale tantas veces como cursos tenga. Puedes filtrar por curso o por empresa para saber, por ejemplo, qué empleados de una empresa están haciendo un curso concreto.",
      metricaAlumnos:
        "Personas registradas, contadas una vez cada una: las que se apuntan por su cuenta más los empleados de empresa.",
    };
  }
  return {
    eyebrow: "Conocimiento · Formación abierta",
    tituloSufijo: "— cursos abiertos",
    intro: "Cursos abiertos a particulares: catálogo, alumnos y matrículas. Inscripciones individuales, sin empresas intermediarias.",
    ayudaModulo:
      "Es el centro de control de tu formación abierta: tu catálogo de cursos, las personas inscritas y sus matrículas.",
    descCursos: "Catálogo de cursos abiertos",
    ayudaCursos:
      "El listado completo de cursos que ofreces. Pulsa cualquier curso para abrir su ficha: ahí ves toda la información del curso y las personas apuntadas. También puedes editar el nombre y activar o desactivar un curso.",
    descAlumnos: "Las personas, una ficha por cada una",
    ayudaAlumnos:
      "Todas las personas registradas, una fila por persona. Puedes buscar por nombre o email y exportar la lista a Excel.",
    descMatriculas: "Quién está apuntado a qué curso",
    ayudaMatriculas:
      "Aquí no se dan de alta personas: se ve quién está apuntado a qué. Cada fila es una matrícula —el alumno, el curso y la fecha—, así que la misma persona sale tantas veces como cursos tenga. Puedes filtrar por curso.",
    metricaAlumnos: "Personas registradas, contadas una vez cada una.",
  };
}
