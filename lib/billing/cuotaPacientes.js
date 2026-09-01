/**
 * lib/billing/cuotaPacientes.js — DE QUIÉN es una cuota cuando la cuota no lo
 * dice (01/09/2026, Rodrigo: «en cuotas, que el filtro salga también por
 * paciente, no solo por cliente»).
 *
 * ── EL PROBLEMA, MEDIDO ─────────────────────────────────────────────────────
 * La pantalla de Cuotas ya buscaba por el nombre del paciente… del campo
 * `patientId` de la cuota. En producción, el 01/09/2026, de las **274 cuotas
 * activas de Aumenta solo 15 tienen paciente**: las otras 259 nacieron del
 * volcado del Organízate, donde la cuota es de la FAMILIA y sumaba lo de los
 * hermanos (`scripts/sembrar-cuotas-desde-aprendidas.js` lo dejó escrito: «sin
 * paciente, repartirla por paciente sería inventarse el reparto»).
 *
 * Resultado: buscar «Hugo» no encontraba nada en 259 de 274 filas y la columna
 * «Paciente» era una raya. El buscador parecía roto y en realidad estaba
 * mirando un campo vacío.
 *
 * ── LA REGLA ────────────────────────────────────────────────────────────────
 * Una cuota SIN paciente es de todos los pacientes de su familia. No hace falta
 * inventarse ningún reparto para decir eso: la cuota de los Castro cubre a Hugo
 * porque Hugo es de los Castro. Así que:
 *
 *   · con paciente → ese paciente, y se dice tal cual;
 *   · sin paciente → los de la familia, y se dice que es de la familia entera.
 *
 * El servidor cuelga de cada cuota los pacientes de su familia
 * (`app/api/billing/cuotas/route.js`); aquí vive lo que se hace con ellos, que
 * es puro y se puede probar sin base de datos.
 */

/** El nombre de un paciente, venga como venga. */
function nombreDePaciente(p) {
  if (!p) return "";
  return [p.firstName, p.lastName].filter(Boolean).join(" ").trim();
}

/**
 * Los pacientes que cubre esta cuota, con su origen:
 *   { nombres: string[], deLaFamilia: boolean }
 *
 * `deLaFamilia` es lo que separa «esta cuota es de Hugo» de «esta cuota es de
 * la familia, y en la familia está Hugo». Sin esa distinción, la pantalla
 * estaría afirmando un reparto que nadie ha hecho.
 */
export function pacientesDeCuota(cuota) {
  const suyo = nombreDePaciente(cuota?.patient);
  if (suyo) return { nombres: [suyo], deLaFamilia: false };
  const familia = Array.isArray(cuota?.familiaPacientes) ? cuota.familiaPacientes : [];
  return { nombres: familia.map(nombreDePaciente).filter(Boolean), deLaFamilia: true };
}

/**
 * Lo que se pinta en la columna «Paciente».
 *
 * Con más de tres hermanos se corta y se dice cuántos quedan: la columna no
 * puede crecer sin límite, pero callar que hay más sería el mismo fallo que
 * arregla este fichero.
 */
export function rotuloPacienteDeCuota(cuota, { maximo = 3 } = {}) {
  const { nombres, deLaFamilia } = pacientesDeCuota(cuota);
  if (!nombres.length) return "—";
  if (!deLaFamilia) return nombres[0];
  const visibles = nombres.slice(0, maximo);
  const resto = nombres.length - visibles.length;
  return `${visibles.join(", ")}${resto > 0 ? ` +${resto}` : ""} (toda la familia)`;
}

/**
 * El texto contra el que busca la pantalla: quién paga y a quién cubre, todo
 * en minúsculas. Se busca por TROZOS, así que escribir un apellido o el nombre
 * del niño encuentra la cuota de su familia.
 */
export function textoBuscableDeCuota(cuota) {
  const partes = [
    cuota?.client?.fiscalName,
    cuota?.client?.name,
    ...pacientesDeCuota(cuota).nombres,
  ];
  return partes.filter(Boolean).join(" ").toLowerCase();
}

/** ¿Casa esta cuota con lo tecleado? Vacío = casan todas. */
export function cuotaCasaCon(cuota, texto) {
  const t = typeof texto === "string" ? texto.trim().toLowerCase() : "";
  if (!t) return true;
  return textoBuscableDeCuota(cuota).includes(t);
}
