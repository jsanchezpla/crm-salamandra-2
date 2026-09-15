/**
 * lib/layout/ordenDelMenu.js — en qué orden salen las áreas del menú (15/09/2026).
 *
 * (Fichero nuevo en /lib, regla #2: es una regla de producto con su prueba
 * —`scripts/_smoke-orden-menu.mjs`— y no un `if` suelto dentro del JSX del
 * menú, que tiene mil líneas y nadie lee entero.)
 *
 * ── DE QUÉ PETICIÓN NACE ───────────────────────────────────────────────────
 * AV-0132 de Aumenta (Isabel): «cambiar el menú principal del CRM para tener en
 * primer lugar Pacientes, Citas... Es mucho más práctico que seguir viendo como
 * primeras opciones clientes, captación». El menú abría por Comercial en todos
 * los centros, y en un centro clínico lo de cada día (pacientes, agenda,
 * facturación) quedaba debajo de la captación.
 *
 * ── LA REGLA, POR MÓDULOS ──────────────────────────────────────────────────
 * Un centro con `clinica` o `pacientes` abre por Salud y Tareas (Citas y
 * Calendario viven ahí), luego Gestión, y Comercial después. Se decide por
 * módulos y no por slug para que un centro clínico nuevo salga bien de fábrica.
 *
 * ⚠️ `nutricion` NO entra, a diferencia de `perfilDeAlta`: en una consulta de
 * nutrición los pacientes son las fichas de CLIENTES (`vocabulario.js`), que
 * viven en Comercial; subir Salud le bajaría justo «Pacientes». Y nutri_laura no
 * se cambia sin su permiso.
 */

export const ORDEN_CLINICO = ["", "Salud", "Tareas", "Gestión", "Comercial", "Educación", "Operaciones"];

/** `tieneModulo` es un Set.has (cliente) o `hasModule` (servidor). */
export function esMenuClinico(tieneModulo) {
  return !!tieneModulo("clinica") || !!tieneModulo("pacientes");
}

/**
 * Devuelve las secciones en su orden. No filtra ni copia ítems: solo reordena.
 * Una sección que no esté en la lista conserva su sitio relativo al final.
 */
export function ordenarSecciones(secciones, tieneModulo) {
  if (!esMenuClinico(tieneModulo)) return secciones;
  const pos = (s) => {
    const i = ORDEN_CLINICO.indexOf(s.label ?? "");
    return i === -1 ? ORDEN_CLINICO.length : i;
  };
  return secciones
    .map((s, i) => ({ s, i }))
    .sort((a, b) => pos(a.s) - pos(b.s) || a.i - b.i)
    .map(({ s }) => s);
}
