/**
 * lib/buzon/buscarAvisos.js — el buscador de la lista de `/ayuda`
 * (11/09/2026, AV-0118 de Aumenta, Olga: «dentro de las incidencias que te
 * enviamos podríamos poner un buscador»).
 *
 * Desde que la lista enseña lo de todo el equipo (02/09/2026) un centro grande
 * pasa de cien avisos, y a partir de ahí nadie encuentra nada bajando por la
 * lista.
 *
 * ── SE FILTRA EN EL NAVEGADOR, NO EN EL SERVIDOR ────────────────────────────
 * `/api/ayuda` ya manda la lista del equipo entera (con su hilo), y la pantalla
 * CUENTA de esa misma lista las respuestas sin leer para apagar el punto del
 * menú (`EVENTO_SIN_VER`). Si el buscador pidiera al servidor una lista
 * recortada, ese recuento saldría de una lista incompleta y el punto se
 * apagaría en cuanto alguien escribiera una letra. Así que la lista completa
 * se queda como está y esto solo decide QUÉ FILAS SE PINTAN.
 *
 * ── LA MISMA REGLA QUE EL RESTO DE BUSCADORES DEL CRM ───────────────────────
 * `coincidePorNombre` de `lib/utils/busqueda.js`: todas las palabras, cada una
 * en cualquier campo, sin tildes ni mayúsculas (10/09/2026, Rodrigo: «ni un
 * solo buscador del CRM debería obligar a poner tildes»). Ese fichero no
 * importa nada, y este tampoco: los dos tienen que poder correr en el
 * navegador y en `scripts/_smoke-ayuda-buscador.mjs` sin levantar nada.
 */

import { coincidePorNombre } from "../utils/busqueda.js";

/** El filtro de estado «sin filtro». */
export const TODOS = "todos";

/**
 * Por dónde se busca en un aviso YA serializado para el cliente
 * (`serializarAviso(..., { para: "cliente" })`): la referencia, el asunto, lo
 * que cuenta y quién lo escribió. La referencia va dos veces —«AV-0123» y
 * «AV0123»— porque por teléfono se dice sin guion, y quien la teclea así
 * tampoco tiene por qué quedarse sin nada.
 *
 * No entra el hilo: se busca lo que el equipo nos MANDÓ, que es lo que pidió
 * Olga. Meter nuestras respuestas haría que una fila casara sin que se viera
 * por qué.
 */
export function camposBuscables(aviso) {
  if (!aviso) return [];
  const ref = String(aviso.ref ?? "");
  return [ref, ref.replace("-", ""), aviso.asunto, aviso.cuerpo, aviso.usuarioNombre];
}

/** ¿Este aviso casa con lo escrito? Sin texto, casa siempre. */
export function coincideAviso(aviso, texto) {
  return coincidePorNombre(texto, camposBuscables(aviso));
}

/**
 * La lista que se pinta: el texto Y el estado a la vez, para que «Nuevo» +
 * «factura» no se pisen (fue el fallo del buscador de la bandeja del
 * back-office, que asignaba el `or` del `where` dos veces y el segundo se
 * llevaba al primero en silencio). El estado que llega ya está en el
 * vocabulario de hoy: lo traduce `serializarAviso`.
 *
 * Devuelve una lista NUEVA: la original es la que cuenta el punto del menú.
 */
export function filtrarAvisos(avisos, { texto = "", estado = TODOS } = {}) {
  if (!Array.isArray(avisos)) return [];
  const casaEstado = !estado || estado === TODOS ? () => true : (a) => a?.estado === estado;
  return avisos.filter((a) => casaEstado(a) && coincideAviso(a, texto));
}
