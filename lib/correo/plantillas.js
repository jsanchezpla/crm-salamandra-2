/**
 * lib/correo/plantillas.js — qué es una plantilla de correo válida.
 *
 * (Fichero en /lib, regla #2: lo comparten el POST y el PUT de
 * `/api/correo/plantillas` — un route.js de Next no puede exportar funciones
 * sueltas — y lo prueba `_smoke-correo-herramientas.mjs`.)
 *
 * Los topes de asunto y cuerpo son LOS MISMOS que los del envío
 * (`/api/correo/envios`): una plantilla que no cupiera en un envío sería una
 * promesa rota.
 */

export const MAX_NOMBRE_PLANTILLA = 120;
export const MAX_ASUNTO_PLANTILLA = 200;
export const MAX_CUERPO_PLANTILLA = 20000;

export function normalizarPlantilla(body) {
  const nombre = String(body?.nombre ?? "").trim();
  if (!nombre) return { error: "La plantilla necesita un nombre" };
  if (nombre.length > MAX_NOMBRE_PLANTILLA) {
    return { error: `El nombre no puede pasar de ${MAX_NOMBRE_PLANTILLA} caracteres` };
  }

  const asunto = String(body?.asunto ?? "").trim();
  if (asunto.length > MAX_ASUNTO_PLANTILLA) {
    return { error: `El asunto no puede pasar de ${MAX_ASUNTO_PLANTILLA} caracteres` };
  }

  const cuerpo = String(body?.cuerpo ?? "").trim();
  if (cuerpo.length > MAX_CUERPO_PLANTILLA) return { error: "El cuerpo es demasiado largo" };

  if (!asunto && !cuerpo) return { error: "Una plantilla vacía no guarda nada: escribe el asunto o el cuerpo" };
  return { nombre, asunto: asunto || null, cuerpo: cuerpo || null };
}
