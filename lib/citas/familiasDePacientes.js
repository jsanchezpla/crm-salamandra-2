/**
 * lib/citas/familiasDePacientes.js — cuando se busca por el nombre del hijo,
 * quién es la familia que hay que enseñar.
 *
 * (Fichero en /lib, regla #2: la regla la comparten el endpoint del buscador y
 * su prueba, y es la parte que se puede equivocar sin que se note — un paciente
 * suelto, dos hermanos en la misma familia, un apellido vacío.)
 *
 * ── DE DÓNDE SALE (28/08/2026, Lau de Aumenta) ─────────────────────────────
 * En «Nueva cita manual» la primera caja se llama «Cliente (la familia)» y
 * buscaba SOLO entre fichas de cliente. Pero quien viene a la sesión es el
 * hijo, y recepción teclea su nombre: escribir «thiago» —un paciente dado de
 * alta— respondía «Nadie con ese nombre».
 *
 * Medido en producción ese día: de los 1.174 pacientes de Aumenta, **934 no se
 * podían encontrar por su nombre** porque su familia no se apellida como ellos.
 * El 80%. Y como la caja tiene salida a mano a propósito, quien no encontraba a
 * alguien escribía el nombre y creaba la cita SUELTA de su ficha — justo el
 * fallo que ese buscador vino a arreglar en julio, entrando por otra puerta.
 *
 * Aquí no se decide QUÉ pacientes coinciden (eso es una consulta, y la hace el
 * endpoint con `filtroPorNombre`): aquí se decide qué se hace con ellos una vez
 * encontrados.
 */

/** «Thiago» + «Santos Ejome» → «Thiago Santos Ejome». Sin apellido, solo nombre. */
export function nombreDePaciente(paciente) {
  const nombre = String(paciente?.firstName ?? paciente?.first_name ?? "").trim();
  const apellidos = String(paciente?.lastName ?? paciente?.last_name ?? "").trim();
  return [nombre, apellidos].filter(Boolean).join(" ");
}

/**
 * Agrupa los pacientes encontrados por la familia a la que pertenecen.
 *
 * Un paciente SIN familia (`clientId` nulo) no arrastra a nadie y se descarta:
 * el buscador ofrece fichas de cliente, y sin ficha no hay nada que ofrecer.
 * Los hermanos caen juntos en la misma entrada, que es lo que hace falta para
 * poder decir «esta familia sale por Thiago» y no elegir al azar.
 *
 * @param {Array} pacientes  filas de Patient (o sus JSON)
 * @returns {Map<string, Array<{id: string, nombre: string}>>}
 */
export function agruparPorFamilia(pacientes) {
  const mapa = new Map();
  for (const p of Array.isArray(pacientes) ? pacientes : []) {
    const familia = p?.clientId ?? p?.client_id;
    if (!familia) continue;
    const nombre = nombreDePaciente(p);
    if (!nombre) continue;
    const lista = mapa.get(familia) ?? [];
    // Sin repetir: la misma consulta no debería traer dos veces al mismo, pero
    // un id duplicado pintaría el nombre dos veces en el desplegable.
    if (!lista.some((x) => x.id === p.id)) lista.push({ id: p.id, nombre });
    mapa.set(familia, lista);
  }
  return mapa;
}

/**
 * Cuelga de cada ficha de cliente los pacientes por los que ha salido.
 *
 * Las fichas que salieron por su PROPIO nombre se quedan con `pacientes: []`:
 * no hay nada que explicar ahí, y el desplegable no debe pintar una línea vacía
 * debajo. Se devuelven objetos nuevos, sin tocar los de entrada.
 *
 * @param {Array} clientes  filas de Client ya serializadas
 * @param {Map} porFamilia  lo que devuelve `agruparPorFamilia`
 */
export function conPacientes(clientes, porFamilia) {
  const mapa = porFamilia instanceof Map ? porFamilia : new Map();
  return (Array.isArray(clientes) ? clientes : []).map((c) => ({
    ...c,
    pacientes: mapa.get(c?.id) ?? [],
  }));
}

/**
 * Los ids de familia a los que hay que ir a buscar, en orden estable.
 * Vacío si no hay ninguno — quien llama debe entonces NO añadir la condición,
 * porque un `IN ()` vacío no devuelve nada y se cargaría la búsqueda por nombre.
 */
export function idsDeFamilia(porFamilia) {
  const mapa = porFamilia instanceof Map ? porFamilia : new Map();
  return [...mapa.keys()];
}
