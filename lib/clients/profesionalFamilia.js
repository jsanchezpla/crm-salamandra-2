/**
 * lib/clients/profesionalFamilia.js — el profesional de la FAMILIA llega a los
 * TERAPEUTAS de sus pacientes.
 *
 * (Fichero nuevo en /lib, regla #2: la regla la comparten dos puertas —aceptar
 * la lista de espera y guardar el «Profesional de referencia» en la ficha de la
 * familia— y escrita dos veces habrían dicho cosas distintas tarde o temprano.)
 *
 * Lo pidió Rodrigo (31/08/2026), después de asignar a una terapeuta en la ficha
 * de la familia y encontrarse con que el paciente seguía «sin terapeuta» al
 * registrar la sesión: «cuando asigne en la ficha de la familia a un terapeuta,
 * que se asigne también en paciente. Es confuso que no esté en los dos lados
 * igual».
 *
 * ── LA REGLA, Y SU LÍMITE ──────────────────────────────────────────────────
 *
 * El profesional de la familia pasa a ser el terapeuta de referencia de los
 * pacientes de esa familia QUE NO TENGAN NINGUNO. Un espejo exacto de los dos
 * campos es imposible a propósito: una familia con dos hijos puede llevarlos
 * con dos terapeutas distintos (en Aumenta los hay con dos y tres), así que a
 * un paciente que YA tiene terapeuta no se le pisa desde fuera — eso lo decidió
 * alguien en su ficha, que sigue siendo donde se afina.
 *
 * Se escribe por `sincronizarTerapeutas` (lib/clinica/terapeutas.js): la misma
 * puerta que la ficha del paciente, con su validación contra el equipo y su
 * espejo en `patients.main_therapist_id`.
 */

import { sincronizarTerapeutas } from "../clinica/terapeutas.js";

/**
 * Pone `terapeutaId` como terapeuta de referencia de los pacientes de la
 * familia `clientId` que no tengan ninguno. Devuelve a cuántos llegó.
 *
 * Degrada en silencio donde el módulo clínico no está o el schema va a medias
 * (sin la tabla `patients`, 42P01/42703): esta regla es un extra del guardado
 * que la llama, no puede tumbarlo. Cualquier otro error SALE, que para eso la
 * llamada va dentro de la transacción de quien guarda.
 */
export async function terapeutaAPacientesDeFamilia({ ctx, clientId, terapeutaId, transaction = null }) {
  if (!clientId || !terapeutaId) return 0;
  // El modelo SIEMPRE está registrado (CLAUDE.md): la puerta es el módulo.
  const conClinica = Boolean(ctx?.hasModule?.("pacientes") || ctx?.hasModule?.("clinica"));
  const Patient = ctx?.tenantModels?.Patient;
  if (!conClinica || !Patient) return 0;

  let llegados = 0;
  try {
    // El espejo es el invariante: columna vacía = lista vacía (lib/clinica/terapeutas.js).
    const sinTerapeuta = await Patient.findAll({
      where: { clientId, mainTherapistId: null },
      ...(transaction ? { transaction } : {}),
    });
    for (const paciente of sinTerapeuta) {
      const movimiento = await sincronizarTerapeutas({
        models: ctx.tenantModels,
        sequelize: ctx.tenantSequelize,
        paciente,
        entradas: [{ id: terapeutaId }],
        transaction,
      });
      // Si el terapeuta ya no existe en el equipo, sincronizar lo descarta y
      // `despues` queda vacío: ese paciente no cuenta.
      if (movimiento.despues.length) llegados += 1;
    }
  } catch (err) {
    const code = err?.parent?.code || err?.original?.code;
    if (code !== "42P01" && code !== "42703") throw err;
  }
  return llegados;
}
