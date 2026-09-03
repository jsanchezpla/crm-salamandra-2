/**
 * lib/citas/horarioPropio.js — el interruptor «sin horario propio» del módulo
 * Citas (03/09/2026, Rodrigo, para Aumenta).
 *
 * ── QUÉ RESUELVE ────────────────────────────────────────────────────────────
 * En Aumenta las terapeutas no tienen hora fija de entrada ni de salida: las
 * citas se las coloca administración, que es quien sabe cuándo puede cada una,
 * y las familias NO piden cita por la web. Ponerles un horario semanal en el
 * CRM no describiría nada real y solo estorbaría: la agenda pública lo respeta
 * a rajatabla (`horarioProfesional.js`: sin horario ese día, ni un hueco) y
 * todos los avisos de «esta persona no tiene su horario puesto» serían ruido
 * en una casa donde nadie va a rellenarlo nunca.
 *
 * Con el interruptor ENCENDIDO (`featureFlags.sinHorarioPropio` de `citas`):
 *   · el menú de Citas no ofrece «Mi horario» (`Sidebar.jsx`);
 *   · la ficha de Equipo no pinta el bloque «Horario de trabajo»;
 *   · `/api/team` deja de marcar `tieneHorario` (va `null`) y devuelve
 *     `horarioPropio: false`, con lo que los avisos de la ficha de cliente y de
 *     la bandeja de formularios («no verá ningún hueco») no salen;
 *   · la agenda pública, si algún día se abriera, no recorta al horario de la
 *     profesional asignada: enseña la del centro (`quienPregunta.js`).
 * La IA de «proponer 3 horarios» no cambia: ya caía a la agenda del centro
 * cuando la profesional no tenía horario propio (`suggestSlots.js`).
 *
 * ── POR QUÉ UN INTERRUPTOR (PELDAÑO 3) Y NO UNA REGLA POR MÓDULOS ───────────
 * nutri_laura y aumenta tienen los mismos módulos (citas + team) y quieren lo
 * contrario: Laura NECESITA el horario de cada nutricionista, porque sus
 * pacientes reservan solos por la web y cada una ve solo los huecos de la suya
 * (07/08/2026). No hay nada en los módulos que lo distinga: es un «esto sí /
 * esto no» puro, regla #16 del CLAUDE.md, como `formacionAbierta`.
 *
 * NO es una barrera: `/mi-horario` y `/api/team/[id]/hours` siguen ahí. Es no
 * ofrecer una pantalla que a ese cliente no le dice nada. Los horarios que ya
 * hubiera guardados no se tocan; al apagar el interruptor vuelven a verse.
 *
 * ── CÓMO SE ENCIENDE ────────────────────────────────────────────────────────
 *   node scripts/horario-propio.js <slug> --quitar   (o --devolver)
 * Escribe `featureFlags.sinHorarioPropio` en la fila `citas` del tenant e
 * invalida su caché. Sin código, sin despliegue.
 */

/** La clave dentro de `tenant_modules.feature_flags` del módulo `citas`. */
export const FLAG_SIN_HORARIO_PROPIO = "sinHorarioPropio";

/** El módulo cuya fila lleva la bandera. */
export const MODULO_HORARIO_PROPIO = "citas";

/**
 * ¿El equipo de este cliente trabaja con horario propio? `flags` es el JSONB
 * `featureFlags` de la fila `citas` del tenant, o el `hasFeatureFlag(moduleKey,
 * flagKey)` del contexto. Sin bandera → SÍ: el horario propio es lo de siempre
 * y nadie lo pierde por defecto.
 */
export function conHorarioPropio(flags) {
  if (typeof flags === "function") return !flags(MODULO_HORARIO_PROPIO, FLAG_SIN_HORARIO_PROPIO);
  return flags?.[FLAG_SIN_HORARIO_PROPIO] !== true;
}

/** Los hijos del menú de Citas que un centro sin horario propio no ofrece. */
export const HIJOS_OCULTOS_SIN_HORARIO_PROPIO = ["citas-mi-horario"];
