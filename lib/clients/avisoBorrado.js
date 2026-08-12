/**
 * lib/clients/avisoBorrado.js — lo que se le dice a alguien antes de borrar una
 * ficha, según lo que ese cliente tenga contratado.
 *
 * (Fichero nuevo en /lib, regla #2: lo comparten el listado de clientes y la
 * ficha. Hoy dicen la misma frase escrita dos veces, y en la ficha de
 * nutri_laura no se dice nada; con tres copias, la próxima corrección se
 * quedaría en dos.)
 *
 * ── QUÉ ARREGLA ─────────────────────────────────────────────────────────────
 * El aviso prometía «se borrarán también sus documentos y las citas que todavía
 * no han ocurrido» a TODO el mundo. En un cliente sin agenda —retorika,
 * spain_enzymes— esa frase no es falsa: está VACÍA. Habla de cancelar citas a
 * quien no tiene ni una.
 *
 * Lo que de verdad se lleva por delante está en `borrarRastro.js`; aquí solo se
 * cuenta. Las citas PASADAS no se tocan nunca, y eso se dice siempre que haya
 * agenda: es la parte que tranquiliza a quien duda si va a perder su historial.
 *
 * ── EL ERROR CAE DEL LADO INOCUO ────────────────────────────────────────────
 * `conCitas` y `conDocumentos` vienen por defecto a `true`. Si quien llama no
 * sabe qué módulos hay —porque `/api/auth/me` falló, o porque el componente se
 * montó sin pasarlos— se avisa DE MÁS. Avisar de que se cancelan citas donde no
 * hay ninguna sobra; no avisar donde sí las hay es dejar que alguien borre la
 * agenda de una familia creyendo que solo borra una ficha.
 *
 * @param {object} opciones
 * @param {string} [opciones.singular]      «cliente» o «paciente», según el
 *                                          vocabulario del tenant.
 * @param {boolean} [opciones.conCitas]
 * @param {boolean} [opciones.conDocumentos]
 * @param {boolean} [opciones.esteCliente]  true → «este cliente» (la ficha);
 *                                          false → «este paciente» (el listado).
 * @returns {string} el texto completo para el `confirm()`.
 */
export function textoAvisoBorrado({
  singular = "cliente",
  conCitas = true,
  conDocumentos = true,
  esteCliente = false,
} = {}) {
  const cabecera = esteCliente
    ? `¿Eliminar este ${singular} y todas sus interacciones?`
    : `¿Eliminar este ${singular}?`;

  const frase = fraseArrastre({ conCitas, conDocumentos });
  return [cabecera, ...(frase ? [frase] : []), "No se puede deshacer."].join("\n\n");
}

/**
 * Solo la frase del medio: qué se lleva por delante, sin la pregunta ni el «no
 * se puede deshacer». La ficha de nutri_laura no usa un `confirm()` sino un
 * cuadro rojo con su propia pregunta, y necesita esta parte suelta.
 *
 * Devuelve cadena vacía cuando no hay nada que arrastrar — y entonces no se
 * pinta nada, en vez de una frase que no dice nada.
 */
export function fraseArrastre({ conCitas = true, conDocumentos = true } = {}) {
  const arrastra = [];
  if (conDocumentos) arrastra.push("sus documentos");
  if (conCitas) arrastra.push("las citas que todavía no han ocurrido");
  if (!arrastra.length) return "";

  let frase = `Se borrarán también ${arrastra.join(" y ")}.`;
  // Solo tiene sentido decirlo si hay agenda de la que hablar.
  if (conCitas) frase += " Las citas pasadas se conservan como constancia del trabajo hecho.";
  return frase;
}

/**
 * `fraseArrastre` decidida por la lista de módulos de `/api/auth/me`.
 *
 * ⚠️ OJO CON LO QUE ES ESA LISTA: `/api/auth/me` devuelve el CRUCE de los
 * módulos del centro con el acceso de esa persona, no los del centro. Y el
 * borrado no pregunta por el usuario: `borrarRastro.js` cancela las citas
 * futuras las vea quien las vea. O sea que alguien que tuviera `clients` y NO
 * `citas` en un centro CON agenda borraría citas sin que se le avisara.
 *
 * Comprobado contra producción el 12/08/2026: **no hay ni una persona así** en
 * los diez clientes. Quien puede borrar fichas es admin, y los admin llevan
 * comodín. Si algún día aparece, la respuesta no es tocar esto: es que la
 * pantalla reciba los módulos del TENANT, que es lo que describe el borrado.
 */
export function fraseArrastreSegunModulos(modulos) {
  const sabemos = Array.isArray(modulos);
  return fraseArrastre({
    conCitas: sabemos ? modulos.includes("citas") : true,
    conDocumentos: sabemos ? modulos.includes("documents") : true,
  });
}

/**
 * El atajo para las pantallas: recibe la lista de módulos tal cual la devuelve
 * `/api/auth/me` y decide.
 *
 * Un `modulos` que no sea un array significa «todavía no lo sé», y entonces se
 * avisa de todo — ver arriba por qué el defecto va en esa dirección.
 */
export function avisoBorradoSegunModulos(modulos, opciones = {}) {
  const sabemos = Array.isArray(modulos);
  return textoAvisoBorrado({
    ...opciones,
    conCitas: sabemos ? modulos.includes("citas") : true,
    conDocumentos: sabemos ? modulos.includes("documents") : true,
  });
}
