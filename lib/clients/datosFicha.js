/**
 * datosFicha — puente entre lo que pide el contrato y lo que hay en la ficha
 * (sprint tunutrilaura, 04/08/2026).
 *
 * (Fichero nuevo en /lib, regla #2: `contratoFirma.js` valida lo que llega del
 * formulario y `formularioAlta.js` dice qué se pregunta en el mostrador.
 * Ninguno sabe DÓNDE vive cada dato dentro del cliente, que es lo que hace
 * falta aquí; y lo comparten tres endpoints —los datos del portal, la firma y
 * el consentimiento parental—.)
 *
 * ── EL PROBLEMA QUE RESUELVE ────────────────────────────────────────────────
 * El contrato se construyó pidiendo sus ocho datos DENTRO de la pantalla de
 * firma. Eso tenía dos consecuencias malas:
 *   1. Los datos se quedaban en la firma y la ficha seguía con los mismos
 *      huecos: la paciente escribía su DNI y Laura no lo veía en el CRM.
 *   2. La fecha de nacimiento —lo que decide si hace falta el consentimiento
 *      del tutor— solo se sabía a MITAD de firmar, así que el consentimiento
 *      parental aparecía cuando ya había empezado.
 * Ahora los datos se piden ANTES, se guardan en la ficha, y el contrato los lee
 * de ahí.
 *
 * ── DÓNDE VIVE CADA DATO ────────────────────────────────────────────────────
 * Lo declara la PLANTILLA, campo a campo, en su propiedad `ficha`:
 *   "cliente.name" · "cliente.taxId" · "cliente.birthDate" · "cliente.email"
 *   "cliente.phone" · "cliente.customFields.<clave>"
 *   "tutor.<clave>"  → entrada de `Client.guardians` (el consentimiento parental)
 *   ausente o null   → no se guarda en la ficha (la localidad y la fecha de la
 *                      firma son del acto de firmar, no de la persona)
 *
 * Se declara en la plantilla y no en una tabla aquí porque el mismo campo
 * `nombre` es la PACIENTE en el contrato y su TUTOR en el consentimiento
 * parental: no hay una correspondencia global entre clave y destino.
 *
 * ── REGLA DE ORO: SOLO SE RELLENAN HUECOS ───────────────────────────────────
 * Nunca se pisa un valor que ya tenga la ficha (decisión de Rodrigo, 04/08).
 * La ficha la mantiene el centro y puede haber corregido a mano un teléfono mal
 * dictado; que la paciente lo sobrescriba desde el portal desharía ese trabajo
 * sin que nadie se entere. Por eso el portal ni siquiera PREGUNTA lo que ya
 * está: solo enseña los huecos.
 */

import { edadDesde } from "./formularioAlta.js";

const texto = (v) => (v == null ? "" : String(v).trim());

/**
 * ¿Este campo es obligatorio PARA ESTA PERSONA?
 *
 * Un campo puede declarar `requiredDesdeEdad: N` y entonces solo se exige a
 * partir de esa edad. Nace del DNI (04/08/2026, Rodrigo): **los menores de 14
 * años no tienen DNI obligatorio** en España, así que exigírselo dejaba a esas
 * familias sin poder terminar de firmar. El campo se sigue enseñando —muchos lo
 * tienen— pero deja de bloquear.
 *
 * Sin fecha de nacimiento se EXIGE, por el mismo criterio que `esMenor()` trata
 * como mayor a quien no sabemos: es el lado que no rompe nada. Y a quien le
 * falten las dos cosas se le pide primero la fecha, que es un campo previo.
 *
 * Vive aquí y no en `contratoFirma.js` para no montar un ciclo de imports:
 * aquel ya lee de este.
 */
export function campoEsObligatorio(campo, fechaNacimiento) {
  if (!campo?.required) return false;
  if (campo.requiredDesdeEdad == null) return true;
  const edad = edadDesde(fechaNacimiento);
  return edad == null || edad >= campo.requiredDesdeEdad;
}

/** Prefijos de destino admitidos. Cualquier otra cosa se ignora. */
const CLIENTE = "cliente.";
const TUTOR = "tutor.";

/** Analiza `campo.ficha` → `{ ambito, clave, custom }`, o null si no aplica. */
export function destinoDe(campo) {
  const destino = texto(campo?.ficha);
  if (!destino) return null;

  if (destino.startsWith(TUTOR)) {
    const clave = destino.slice(TUTOR.length);
    return clave ? { ambito: "tutor", clave, custom: false } : null;
  }
  if (!destino.startsWith(CLIENTE)) return null;

  const resto = destino.slice(CLIENTE.length);
  if (resto.startsWith("customFields.")) {
    const clave = resto.slice("customFields.".length);
    return clave ? { ambito: "cliente", clave, custom: true } : null;
  }
  return resto ? { ambito: "cliente", clave: resto, custom: false } : null;
}

/** Lee de la ficha el valor de un campo. Devuelve "" si no lo tiene. */
export function leerDeFicha(client, campo) {
  const d = destinoDe(campo);
  if (!d || d.ambito !== "cliente" || !client) return "";

  const bruto = d.custom ? client.customFields?.[d.clave] : client[d.clave];
  // DATEONLY vuelve de Sequelize como "YYYY-MM-DD", pero si alguien lo guardó
  // como Date hay que recortarlo o el input date lo rechaza.
  if (campo.type === "date" && bruto) return String(bruto).slice(0, 10);
  return texto(bruto);
}

/**
 * Qué le falta a esta ficha de lo que pide la plantilla.
 *
 * Solo mira los campos con destino `cliente.*`: los de la firma (localidad,
 * fecha) no son datos de la persona, y los del tutor pertenecen al
 * consentimiento parental, que se rellena en su propio documento.
 *
 * Los NO obligatorios no cuentan como hueco, y «obligatorio» puede depender de
 * la EDAD: el DNI solo se exige a partir de los 14 (`requiredDesdeEdad`), que
 * es cuando existe el deber de tenerlo. Ver `campoEsObligatorio`.
 */
export function camposQueFaltan(campos, client) {
  const fechaNacimiento = texto(client?.birthDate).slice(0, 10) || null;
  return (campos ?? []).filter((campo) => {
    const d = destinoDe(campo);
    if (!d || d.ambito !== "cliente") return false;
    if (!campoEsObligatorio(campo, fechaNacimiento)) return false;
    return !leerDeFicha(client, campo);
  });
}

/**
 * Reparte los huecos entre los que hay que tapar ANTES de firmar y los que
 * pueden esperar a después (04/08/2026, Rodrigo).
 *
 * Casi todo puede esperar: pedir el domicilio y los datos de facturación a
 * alguien que todavía no ha decidido nada es un peaje en la puerta. Lo que NO
 * puede esperar es la fecha de nacimiento, porque decide si hace falta el
 * consentimiento del tutor y sin ella ese documento aparecería a mitad de
 * firmar. La plantilla marca esos campos con `previo: true`.
 */
export function separarPorMomento(campos) {
  const previos = [];
  const posteriores = [];
  for (const campo of campos ?? []) (campo?.previo ? previos : posteriores).push(campo);
  return { previos, posteriores };
}

/** Los datos de la ficha con los que se rellena el contrato, por clave. */
export function datosDeFicha(campos, client) {
  const out = {};
  for (const campo of campos ?? []) {
    const valor = leerDeFicha(client, campo);
    if (valor) out[campo.key] = valor;
  }
  return out;
}

/**
 * Construye el `update` para la ficha a partir de lo que se ha declarado.
 *
 * SOLO rellena huecos: si la ficha ya tiene algo en ese sitio, se respeta y el
 * valor declarado no llega a escribirse. Devuelve `null` si no hay nada que
 * tocar, para no lanzar un UPDATE que no cambia nada.
 */
export function actualizacionDeFicha(campos, client, datos) {
  const columnas = {};
  const custom = { ...(client?.customFields ?? {}) };
  let hayColumnas = false;
  let hayCustom = false;

  for (const campo of campos ?? []) {
    const d = destinoDe(campo);
    if (!d || d.ambito !== "cliente") continue;

    const nuevo = texto(datos?.[campo.key]);
    if (!nuevo) continue;
    if (leerDeFicha(client, campo)) continue; // ya tiene valor: no se pisa

    if (d.custom) {
      custom[d.clave] = nuevo;
      hayCustom = true;
    } else {
      columnas[d.clave] = nuevo;
      hayColumnas = true;
    }
  }

  if (!hayColumnas && !hayCustom) return null;
  return hayCustom ? { ...columnas, customFields: custom } : columnas;
}

/**
 * Entrada de `Client.guardians` con los datos del tutor declarados en el
 * consentimiento parental.
 *
 * Devuelve `null` si no hay nombre (sin nombre no es un tutor) o si YA existe
 * un tutor con ese mismo DNI: firmar dos veces —o que firmen los dos
 * progenitores— no puede llenar la ficha de duplicados.
 */
export function tutorDeclarado(campos, client, datos, nuevoId) {
  const tutor = {};
  for (const campo of campos ?? []) {
    const d = destinoDe(campo);
    if (!d || d.ambito !== "tutor") continue;
    const valor = texto(datos?.[campo.key]);
    if (valor) tutor[d.clave] = valor;
  }
  if (!tutor.name) return null;

  const existentes = Array.isArray(client?.guardians) ? client.guardians : [];
  const mismoDni = tutor.dni
    ? existentes.some((g) => texto(g?.dni).toUpperCase() === tutor.dni.toUpperCase())
    : existentes.some((g) => texto(g?.name).toLowerCase() === tutor.name.toLowerCase());
  if (mismoDni) return null;

  return {
    id: nuevoId,
    name: tutor.name,
    // `guardians` guarda la relación en minúscula y acotada (ver guardians.js);
    // la plantilla la pregunta en bonito («Madre»), así que se traduce.
    relationship: relacionNormalizada(tutor.relationship),
    dni: tutor.dni ?? null,
    phone: tutor.phone ?? null,
    email: tutor.email ?? null,
    domicilio: tutor.domicilio ?? null,
    /**
     * `signer: false` AUNQUE acabe de firmar, y esto no es un descuido.
     *
     * `effectiveSigners()` devuelve los tutores marcados como firmantes y, solo
     * si no hay ninguno, al titular de la ficha. Las firmas que se acaban de
     * guardar están a nombre del TITULAR. Si este tutor entrara como firmante,
     * la lista de quién debe firmar pasaría de [titular] a [tutor], ninguna de
     * las firmas existentes casaría, y el portal se quedaría pidiéndole
     * eternamente que firme lo que acaba de firmar.
     *
     * Aquí se guarda como DATO —quién es el responsable legal de la menor, que
     * es lo que la nutricionista necesita ver en la ficha—, no como una
     * obligación pendiente. Si algún día el centro quiere exigirle firma, lo
     * marca a mano desde la ficha.
     */
    signer: false,
  };
}

const RELACIONES = { padre: "padre", madre: "madre", "tutor/a legal": "tutor", tutor: "tutor" };

function relacionNormalizada(valor) {
  return RELACIONES[texto(valor).toLowerCase()] ?? "tutor";
}
