/**
 * lib/clinica/envioRegistro.js — enviar UN registro de sesión al área privada
 * de la familia (29/08/2026, Rodrigo: «queremos poder subir al área privada del
 * paciente los registros por separado, y siempre que se suba algo se tiene que
 * subir simplemente el PDF»).
 *
 * Hasta hoy un registro solo llegaba a la familia DENTRO de un informe, en el
 * anexo opcional de registros literales. Eso obliga a redactar un informe para
 * compartir una sesión suelta, y a mandar todas las del periodo o ninguna.
 *
 * Las dos reglas del encargo, aquí, en funciones con nombre y con prueba:
 *
 *   1. **Lo que se sube es el PDF y NADA más.** `documentoDeRegistro` arma la
 *      fila de `documents` y no hay otra: un `application/pdf` con
 *      `client_visible`, colgado del paciente y de su pagador. Ni el registro
 *      en crudo, ni sus adjuntos de preparación, ni el audio. Y el PDF lo
 *      genera `sessionPdf.js`, que YA deja fuera la preparación, las notas
 *      internas y la transcripción.
 *   2. **Sin pagador no se envía.** El portal de la familia filtra por cliente
 *      (`lib/citas/portalDocumentos.js`), así que un documento colgado de un
 *      paciente huérfano no lo vería nadie: se quedaría publicado en ninguna
 *      parte. Se dice por qué, no se falla en silencio — la misma regla que
 *      «Enviar al paciente» del informe.
 *
 * Vive en `/lib` (regla 2) porque la ruta que envía y la prueba que fija qué se
 * sube tienen que mirar el MISMO objeto: si esto se escribe dentro del handler,
 * la única forma de probarlo es levantar el servidor, y entonces no se prueba.
 */

/** `documents.source` de un registro enviado. Lo mira la ficha del paciente. */
export const SOURCE_REGISTRO = "sesion";

/**
 * Por qué NO se puede enviar este registro, o `null` si se puede.
 * @param clientId  el pagador resuelto (de la sesión o del paciente)
 */
export function motivoParaNoEnviar({ clientId } = {}) {
  if (!clientId) {
    return "Este paciente no tiene cliente pagador enlazado, así que el registro no puede llegar a su área privada. Enlázalo en la ficha y vuelve a intentarlo.";
  }
  return null;
}

/**
 * La fila de `documents` que se crea al enviar. Un objeto y punto: quien llama
 * le pasa lo que solo sabe él (el id, la ruta en disco, el tamaño) y lo demás
 * sale de aquí, para que «qué se sube» sea una sola respuesta y comprobable.
 */
export function documentoDeRegistro({
  documentId,
  fileName,
  storagePath,
  fileSize,
  patientId,
  clientId,
  ownerUserId = null,
} = {}) {
  return {
    id: documentId,
    folderId: null,
    visibility: "shared",
    ownerUserId,
    fileName,
    storagePath,
    fileSize,
    // Solo el PDF. Si algún día se quisiera mandar otra cosa, sería otro
    // encargo y otra decisión, no un tipo MIME distinto colado por aquí.
    mimeType: "application/pdf",
    clientId,
    patientId,
    source: SOURCE_REGISTRO,
    // Es justo lo que se le entrega a la familia: sin esto no lo ve.
    clientVisible: true,
  };
}
