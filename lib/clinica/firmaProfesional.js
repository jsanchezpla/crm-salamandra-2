/**
 * lib/clinica/firmaProfesional.js — cómo se identifica quien firma el informe.
 *
 * (Fichero nuevo en /lib, regla #2: es una función pura de tres líneas de
 * lógica y cuatro casos, y los cuatro casos son el motivo. Lo comparten la
 * portada, el bloque de firma y su prueba.)
 *
 * ── EL FALLO QUE SE EVITA ──────────────────────────────────────────────────
 * La línea de firma es «Nombre · Titulación · Nº Col. 28/1234», y en producción
 * NINGUNA de las 18 personas del equipo de Aumenta tiene hoy titulación ni
 * número de colegiada (comprobado el 28/08/2026: son columnas recién creadas).
 * Escrito a lo bruto con plantillas, eso imprime «Marta Ruiz · · » debajo de
 * una firma, en el documento que la familia lleva al colegio.
 *
 * Así que se junta solo lo que hay. Sin titulación y sin número, la línea es el
 * nombre a secas, que es exactamente lo correcto.
 *
 * ── LA TITULACIÓN SON VARIAS LÍNEAS (29/08/2026) ───────────────────────────
 * Aumenta mandó las suyas y ninguna es una sola: «Logopeda», y debajo el máster,
 * el postgrado y el experto — hasta seis líneas en una persona. Así que
 * `qualification` guarda UN TÍTULO POR LÍNEA y estas funciones las reparten: la
 * primera línea acompaña al nº de colegiada (que es como se lee, «Logopeda ·
 * Nº Col. 28/0256») y las demás van debajo, una por renglón.
 *
 * La PORTADA sigue usando una sola línea a propósito: ahí la firma es una
 * referencia, no la acreditación entera.
 *
 * ── POR QUÉ NO VALE `position` ─────────────────────────────────────────────
 * `TeamMember.position` ya existe y dice «Logopeda» o «Psicóloga», pero es el
 * PUESTO en el centro y se pinta en media docena de desplegables. La titulación
 * («Graduada en Logopedia, Col. nº 28/1234») es otra cosa: es lo que acredita a
 * quien firma. Se usan las dos, en este orden, y ninguna sustituye a la otra.
 */

const texto = (v) => (v == null ? "" : String(v).trim());

/**
 * ¿Este centro emite informes que alguien firma?
 *
 * Los campos «Nº de colegiación» y «Titulación» de la ficha de equipo existen
 * por UNA razón: salen impresos bajo la firma de un informe clínico. En un
 * centro que no hace informes clínicos —una academia online, una agencia de
 * management, una empresa de servicios— no significan nada, y la ayuda que
 * llevan debajo («salen impresos en los informes clínicos que firma esta
 * persona») sería sencillamente falsa.
 *
 * Vive aquí, en `lib/`, con nombre y con prueba, porque es uno de los «tres
 * peros» de CLAUDE.md: cada «si tiene X no enseñes Y» es un `if` con nombre, no
 * una condición suelta en medio del JSX.
 *
 * @param tieneModulo  función `(clave) => boolean`, o una lista de claves.
 */
export function pideAcreditacionProfesional(tieneModulo) {
  const tiene =
    typeof tieneModulo === "function"
      ? tieneModulo
      : (k) => (Array.isArray(tieneModulo) ? tieneModulo.includes(k) : false);
  return Boolean(tiene("clinica") || tiene("pacientes"));
}

/**
 * La línea que identifica a quien firma, con lo que haya:
 *
 *   completo   → «Marta Ruiz Delgado · Graduada en Logopedia · Nº Col. 28/1234»
 *   sin nº     → «Marta Ruiz Delgado · Graduada en Logopedia»
 *   sin título → «Marta Ruiz Delgado · Nº Col. 28/1234»
 *   pelado     → «Marta Ruiz Delgado»
 *   ni nombre  → «» (y entonces el generador no pinta la línea)
 */
export function lineaDeFirma({ nombre, titulacion, puesto, colegiado } = {}) {
  const quien = texto(nombre);
  if (!quien) return "";
  // La titulación manda sobre el puesto: acredita, no describe. Si no hay
  // titulación se usa el puesto, que es lo que el centro tiene rellenado hoy.
  // De la titulación, solo su PRIMERA línea: en una línea sola no caben seis.
  const cargo = titulos(titulacion)[0] || texto(puesto);
  const numero = texto(colegiado);
  return [quien, cargo, numero ? `Nº Col. ${numero}` : ""].filter(Boolean).join(" · ");
}

/**
 * La titulación, partida en títulos. Un título por línea, sin vacías: es como
 * lo escribe el centro en la ficha de equipo y como se lee en el documento.
 */
export function titulos(titulacion) {
  return texto(titulacion)
    .split(/\r?\n/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Las dos líneas del bloque de firma: el nombre arriba y su acreditación
 * debajo, en letra pequeña. Devuelve `{ nombre, acreditacion }`, cualquiera de
 * las dos puede venir vacía.
 *
 * Es la misma información que `lineaDeFirma` pero partida, porque el bloque de
 * firma al pie del documento la pinta en dos alturas y la portada en una sola.
 */
export function bloqueDeFirma({ nombre, titulacion, puesto, colegiado } = {}) {
  const quien = texto(nombre);
  const lista = titulos(titulacion);
  // La primera línea acompaña al número; el resto va debajo, una por renglón.
  const cargo = lista[0] || texto(puesto);
  const numero = texto(colegiado);
  return {
    nombre: quien,
    acreditacion: [cargo, numero ? `Nº Col. ${numero}` : ""].filter(Boolean).join(" · "),
    // Los demás títulos. Vacío mientras el centro escriba una sola línea, que es
    // como estaba todo antes del 29/08/2026.
    titulos: lista.slice(1),
  };
}
