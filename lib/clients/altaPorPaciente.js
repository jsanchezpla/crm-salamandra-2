/**
 * lib/clients/altaPorPaciente.js — el interruptor «el alta empieza por el
 * paciente» del módulo Pacientes (07/09/2026, AV-0051 de Aumenta por Rodrigo).
 *
 * ── QUÉ RESUELVE ────────────────────────────────────────────────────────────
 * Olga (Aumenta): «hemos intentado crear una ficha de cliente (padres) y
 * paciente; una vez creado el cliente no lo vincula con el paciente. Para
 * nosotros lo ideal sería lo contrario: comenzar creando la ficha de paciente
 * y que se vincule con los clientes (padres)». En producción el paciente SÍ
 * estaba enlazado; lo que había pasado es que el alta empieza por la familia
 * («Nombre *», que es el titular), y en un centro donde todo gira alrededor
 * del niño el nombre que se teclea primero es el del niño: la ficha de la
 * familia salió con el nombre del hijo, sin madre por ningún lado, y el
 * paciente enseñaba «Contacto (pagador)» = él mismo.
 *
 * Con el interruptor ENCENDIDO (`featureFlags.altaPorPaciente` de `pacientes`):
 *   · el alta de Clientes pide PRIMERO al paciente (nombre, apellidos,
 *     nacimiento, centro, curso, motivo) y después a la familia: «Padre, madre
 *     o tutor que abre la ficha» (nombre, parentesco, DNI, teléfono, correo,
 *     domicilio) y el otro progenitor;
 *   · el título dice «Nuevo paciente y su familia» y el botón «Crear
 *     paciente»; sin paciente con nombre y apellidos no se crea nada;
 *   · el enlace «Dar de alta desde Clientes» de Pacientes abre ese alta.
 * Lo que se guarda es EXACTAMENTE lo mismo (familia + paciente en una
 * transacción, `POST /api/clients`): cambia el orden de las preguntas, no el
 * dato.
 *
 * ── POR QUÉ UN INTERRUPTOR (PELDAÑO 3) Y NO EL BASE ─────────────────────────
 * Rodrigo (07/09/2026): «hazlo solo para Aumenta, no universal». Un centro
 * donde el cliente y el paciente pueden ser la misma persona (una adulta que
 * viene a consulta) empieza por la persona y marca «el paciente es el propio
 * cliente»; poner al paciente delante ahí sería preguntar dos veces por la
 * misma. Es un «esto sí / esto no» del módulo `pacientes`, como
 * `sinHorarioPropio` en Citas.
 *
 * ── CÓMO SE ENCIENDE ────────────────────────────────────────────────────────
 *   node scripts/alta-por-paciente.js <slug> --poner   (o --quitar)
 * Escribe `featureFlags.altaPorPaciente` en la fila `pacientes` del tenant e
 * invalida su caché. Sin código, sin despliegue.
 */

/** La clave dentro de `tenant_modules.feature_flags` del módulo `pacientes`. */
export const FLAG_ALTA_POR_PACIENTE = "altaPorPaciente";

/** El módulo cuya fila lleva la bandera. */
export const MODULO_ALTA_POR_PACIENTE = "pacientes";

/**
 * ¿En este centro el alta empieza por el paciente? `flags` es el JSONB
 * `featureFlags` de la fila `pacientes` del tenant, o el `hasFeatureFlag(
 * moduleKey, flagKey)` del contexto. Sin bandera → NO: el alta de siempre
 * empieza por la familia.
 */
export function altaEmpiezaPorElPaciente(flags) {
  if (typeof flags === "function") return !!flags(MODULO_ALTA_POR_PACIENTE, FLAG_ALTA_POR_PACIENTE);
  return flags?.[FLAG_ALTA_POR_PACIENTE] === true;
}

/**
 * Los textos del alta según por dónde empieza. Se declaran aquí y la pantalla
 * los LEE (regla #16, peldaño 2): un `if (aumenta)` suelto por el JSX es lo
 * que la escalera prohíbe.
 */
export function textosDelAlta({ porPaciente = false, singular = "cliente" } = {}) {
  if (!porPaciente) {
    return {
      titulo: `Nuevo ${singular}`,
      boton: `Crear ${singular}`,
      cabeceraFamilia: null,
      sinNombreTitular: "El nombre es obligatorio",
      sinPaciente: null,
    };
  }
  return {
    titulo: "Nuevo paciente y su familia",
    boton: "Crear paciente",
    cabeceraFamilia: {
      titulo: "Su familia (quien paga)",
      ayuda: "Primero quien abre la ficha —normalmente la madre o el padre—, con su teléfono y su correo; después el otro progenitor.",
    },
    sinNombreTitular: "Falta el nombre del padre, madre o tutor que abre la ficha",
    sinPaciente: "Falta el nombre y los apellidos del paciente",
  };
}

/** ¿Hay al menos un paciente con nombre y apellidos tecleados? */
export function hayPacienteConNombre(pacientes) {
  return (Array.isArray(pacientes) ? pacientes : []).some(
    (p) => String(p?.firstName ?? "").trim() && String(p?.lastName ?? "").trim()
  );
}
