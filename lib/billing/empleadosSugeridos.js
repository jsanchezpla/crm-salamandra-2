/**
 * empleadosSugeridos — qué empleados salen PRIMERO en el desplegable de una
 * factura cuando se sabe de qué paciente es (31/08/2026).
 *
 * El CRM ya sabe qué terapeutas llevan a cada niño (lib/clinica/terapeutas.js);
 * facturación no lo consultaba y el formulario enseñaba la plantilla entera en
 * orden alfabético. La regla es simple y por eso vive aquí con nombre: los
 * terapeutas del paciente arriba (en su orden — la referencia primero), el
 * resto detrás en su orden de siempre, y cada uno marcado para que la pantalla
 * pueda rotularlo.
 */
export function ordenarConSugeridos(employees, sugeridosIds) {
  const lista = Array.isArray(employees) ? employees : [];
  const ids = (Array.isArray(sugeridosIds) ? sugeridosIds : []).filter(Boolean);
  if (!ids.length) return lista.map((e) => ({ ...e, sugerido: false }));
  const porId = new Map(lista.map((e) => [e.id, e]));
  const arriba = ids.filter((id) => porId.has(id)).map((id) => ({ ...porId.get(id), sugerido: true }));
  const abajo = lista.filter((e) => !ids.includes(e.id)).map((e) => ({ ...e, sugerido: false }));
  return [...arriba, ...abajo];
}
