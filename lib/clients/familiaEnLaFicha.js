/**
 * familiaEnLaFicha.js — qué se enseña de la FAMILIA dentro de la ficha del
 * paciente (18/09/2026, AV-181 de Aumenta).
 *
 * (Fichero nuevo en /lib, regla #2: la pregunta «¿qué de la familia puede ver
 * una terapeuta?» la responden hoy el serializador del paciente y mañana
 * cualquier otra pantalla que enseñe a la familia sin abrir su ficha. Es una
 * regla de qué se ve, no pintura, así que no vive en el JSX.)
 *
 * ── DE QUÉ NACE ─────────────────────────────────────────────────────────────
 * Isabel, de Aumenta: «nos resulta lioso ir a una ficha u otra en función de lo
 * que queremos buscar… que si me meto en el paciente, pueda acceder a los datos
 * del cliente con facilidad, completos». Las 13 terapeutas NO tienen Clientes en
 * su menú —es lo suyo, lo dicen ellas— así que la ficha del paciente es todo lo
 * que ven de la familia: hasta hoy, el contacto del pagador y los tutores. El
 * domicilio había que pedírselo a recepción.
 *
 * ── LA FRONTERA ─────────────────────────────────────────────────────────────
 * No es «enseñar más campos»: es decidir CUÁLES. Lo de trabajo sí —dónde vive
 * la familia y por qué vino—; el dinero no, que es la línea que ya traza
 * `quienVeElDinero.js` y aquí NO se cruza: nada fiscal (`fiscalName`,
 * `fiscalTaxId`, `fiscalAddress`…), ningún NIF, ninguna deuda. Por eso esta
 * función construye el objeto desde cero campo a campo en vez de quitar cosas
 * de la ficha entera: si mañana aparece una columna nueva de dinero en
 * `Client`, no se cuela sola.
 *
 * Las NOTAS de la ficha se quedan fuera a propósito aunque el aviso las cite:
 * son texto libre donde administración apunta de todo —acuerdos de pago,
 * impagos, avisos internos— y no hay forma de separar lo que es dinero de lo
 * que no mirándolas. Lo clínico ya tiene su sitio en la propia ficha del
 * paciente.
 *
 * El domicilio de la familia vive en `customFields.domicilio` (una línea de
 * texto), NO en `Client.address`, que es JSONB y tumbó la ficha una vez
 * (`formularioAlta.js`).
 *
 * ── LA DIRECCIÓN FISCAL CAE COMO DOMICILIO (18/09/2026, medido en producción) ─
 * Al medirlo contra Aumenta, la tarjeta salía vacía: de sus 1.107 familias con
 * paciente, solo OCHO tienen `customFields.domicilio`. Dónde está de verdad su
 * domicilio: en `fiscalAddress`, 988 de 1.107 (y `fiscalCity` en 985), porque
 * así entró en la importación de Organízate. O sea que el dato que pedían las
 * terapeutas estaba justo detrás del campo que parecía dinero.
 *
 * No lo es. Una dirección POSTAL no es «el tema económico» de la petición de
 * Raquel —«contacto, correo, los datos del contrato; el tema económico que solo
 * lo vean oficina y dirección»—: es dónde vive la familia, escrito en la casilla
 * de al lado. Así que se usa de CAÍDA, nunca por delante de lo que alguien haya
 * escrito a mano en el domicilio. Lo que sigue sin salir de aquí es lo que sí es
 * dinero y solo dinero: el NIF (`taxId`, `fiscalTaxId`) y la razón social
 * (`fiscalName`), que es con quien se factura y no dónde vive nadie.
 */

const texto = (v) => {
  const s = v == null ? "" : String(v).trim();
  return s || null;
};

/**
 * Los datos de trabajo de la familia, para la ficha del paciente.
 *
 * @param client la fila del cliente pagador, ya en JSON (con `customFields`).
 * @returns {{domicilio: string|null, codigoPostal: string|null, localidad: string|null, motivo: string|null, hayAlgo: boolean}}
 */
export function datosDeLaFamilia(client) {
  const c = client?.toJSON ? client.toJSON() : client;
  const cf = c && typeof c.customFields === "object" && c.customFields ? c.customFields : {};
  const datos = {
    // La dirección fiscal SOLO como caída: lo escrito a mano manda siempre.
    domicilio: texto(cf.domicilio) ?? texto(c?.fiscalAddress),
    codigoPostal: texto(cf.postalCode) ?? texto(c?.fiscalZip),
    localidad: texto(cf.city) ?? texto(c?.fiscalCity),
    motivo: texto(cf.motivo),
  };
  return { ...datos, hayAlgo: Object.values(datos).some(Boolean) };
}

/**
 * El domicilio en una línea, como se dicta por teléfono: «C/ Mallorca 210, 3º
 * 2ª · 28013 Madrid». Sin domicilio no se inventa una línea con solo el código
 * postal: eso no es una dirección.
 */
export function domicilioEnUnaLinea(datos) {
  if (!datos?.domicilio) return null;
  const sitio = [datos.codigoPostal, datos.localidad].filter(Boolean).join(" ");
  return sitio ? `${datos.domicilio} · ${sitio}` : datos.domicilio;
}
