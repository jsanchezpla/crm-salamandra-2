/**
 * lib/billing/datosFiscales.js — a quién se le emitió una factura.
 *
 * (Fichero nuevo en /lib, regla #2: la respuesta la necesitan el PDF y el libro
 * de IVA, que son los DOS documentos oficiales que salen del CRM. Si cada uno
 * decidiera por su cuenta cuándo mira la foto y cuándo el cliente vivo, el papel
 * que recibe la familia y el que se le manda a la gestoría acabarían diciendo
 * cosas distintas de la MISMA factura. Es el mismo motivo por el que existe
 * `nifCliente.js`, un peldaño más arriba.)
 *
 * ── EL PROBLEMA (26/08/2026) ───────────────────────────────────────────────
 * Una factura no guardaba ni un dato fiscal propio: el nombre, el NIF y la
 * dirección impresos se leían de la ficha del cliente CADA VEZ que se generaba
 * el documento. O sea que corregir hoy el NIF de una familia cambiaba, hacia
 * atrás y en silencio, todas sus facturas ya emitidas — y no daba ningún error:
 * los documentos seguían saliendo, solo que ya no eran los que se entregaron.
 * En Aumenta son 14.243 facturas emitidas colgando de la ficha actual.
 *
 * Desde hoy, al EMITIR se guarda una foto en `invoices.fiscal_snapshot`. La
 * ficha se puede corregir todo lo que haga falta: lo que se emitió, se emitió.
 *
 * ── QUÉ SE CONGELA, Y QUÉ NO ──────────────────────────────────────────────
 * Solo lo que identifica fiscalmente al destinatario: razón social, NIF/CIF,
 * dirección, CP, ciudad y país. El CORREO no, aunque también se imprima: no es
 * un elemento fiscal de la factura, es la forma de escribirle a esa persona hoy,
 * y duplicar un dato personal más de lo necesario no sale gratis.
 *
 * ── LAS VIEJAS NO SE RELLENAN ─────────────────────────────────────────────
 * Las 14.243 que ya existen se quedan sin foto y siguen leyendo del cliente
 * vivo, exactamente como hasta hoy. Rellenarlas con los datos de HOY sería peor
 * que no tener foto: estamparía como «lo que decía la factura de 2022» algo que
 * quizá se corrigió en 2025, y con toda la apariencia de un dato bueno. La foto
 * solo la pone quien la puede saber: la emisión.
 */

import { nifDeCliente, nombreFiscalDeCliente } from "./nifCliente.js";

/**
 * Los atributos del cliente que hay que traer de la base para poder congelarlos.
 *
 * Existe por lo mismo que `ATRIBUTOS_CLIENTE_FACTURA`: los `include` llevan
 * lista blanca, y a una lista blanca a la que se le olvida un campo no le da
 * error — devuelve `undefined` en silencio, y entonces la foto sale coja para
 * siempre, que es justo lo que no se puede arreglar después.
 */
export const ATRIBUTOS_PARA_CONGELAR = [
  "id",
  "name",
  "fiscalName",
  "taxId",
  "fiscalTaxId",
  "fiscalAddress",
  "fiscalZip",
  "fiscalCity",
  "fiscalCountry",
  // Los tutores (02/09/2026): una factura puede ir a nombre de uno de ellos.
  "guardians",
  // Y cuál de ellos por defecto (04/09/2026): el lote y «Partir» lo respetan
  // desde el 06/09/2026 (`lotesCuotas.js`).
  "fiscalGuardianId",
];

const texto = (v) => {
  const s = String(v ?? "").trim();
  return s || null;
};

/**
 * La foto que se guarda al emitir, o `null` si no hay nada que valga la pena
 * congelar.
 *
 * Devuelve SIEMPRE las seis claves, también las vacías. Una foto a la que le
 * falta la clave `cp` y otra que la tiene a `null` se leen igual hoy, pero la
 * primera no distingue «no tenía» de «se guardó mal»; con las seis puestas, lo
 * que falta consta que faltaba.
 */
export function fotoFiscalDe(client) {
  if (!client) return null;
  const nombre = nombreFiscalDeCliente(client);
  const nif = nifDeCliente(client);
  // Sin nombre ni NIF no hay identificación fiscal que congelar, y una foto
  // vacía sería peor que ninguna: taparía el respaldo al cliente vivo.
  if (!nombre && !nif) return null;
  return {
    nombre,
    nif,
    direccion: texto(client.fiscalAddress),
    cp: texto(client.fiscalZip),
    ciudad: texto(client.fiscalCity),
    pais: texto(client.fiscalCountry),
  };
}

/**
 * Lo que se imprime: la foto si la factura la tiene, y si no el cliente vivo.
 *
 * `congelado` dice de dónde salió. No lo usa ninguna pantalla todavía; está
 * para que las pruebas puedan distinguir los dos caminos sin adivinarlo por el
 * contenido, y para el día que alguien quiera enseñarlo.
 */
export function datosFiscalesDe(invoice, client) {
  const foto = invoice?.fiscalSnapshot ?? invoice?.fiscal_snapshot ?? null;
  const util =
    foto && typeof foto === "object" && !Array.isArray(foto) && (foto.nombre || foto.nif);
  if (util) {
    return {
      nombre: texto(foto.nombre),
      nif: texto(foto.nif),
      direccion: texto(foto.direccion),
      cp: texto(foto.cp),
      ciudad: texto(foto.ciudad),
      pais: texto(foto.pais),
      congelado: true,
    };
  }
  // A nombre de un tutor y todavía sin foto (un borrador, 02/09/2026): el
  // tutor vivo. Si ya no está en la ficha, la familia — mejor un nombre que
  // existe que uno vacío; emitir lo frena `faltaParaEmitirATutor`.
  const tutor = tutorDe(client, invoice?.guardianId ?? invoice?.guardian_id);
  if (tutor) return { ...fotoFiscalDeTutor(tutor, client), congelado: false };
  return {
    nombre: nombreFiscalDeCliente(client),
    nif: nifDeCliente(client),
    direccion: texto(client?.fiscalAddress),
    cp: texto(client?.fiscalZip),
    ciudad: texto(client?.fiscalCity),
    pais: texto(client?.fiscalCountry),
    congelado: false,
  };
}

/* ═══ A nombre de un TUTOR de la familia (02/09/2026, decisión de Rodrigo) ═══
 *
 * Con padres separados —o con una empresa que paga una parte— cada uno quiere
 * SU factura a su nombre. Hasta hoy un pagador tenía que ser una ficha de
 * cliente; ahora una factura puede ir a nombre de un tutor de la familia:
 * `invoices.guardian_id` apunta a la entrada de `clients.guardians`, el
 * pagador sigue siendo la familia (`client_id`) y a quién se le emite lo
 * deciden estas funciones: nombre y DNI del tutor, con la dirección fiscal de
 * la familia (los tutores no tienen dirección propia en la ficha).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** El tutor de la ficha con ese id, o null. */
export function tutorDe(client, guardianId) {
  const id = String(guardianId ?? "").trim().toLowerCase();
  if (!UUID_RE.test(id)) return null;
  const lista = Array.isArray(client?.guardians) ? client.guardians : [];
  return lista.find((g) => g && String(g.id ?? "").toLowerCase() === id) ?? null;
}

/** La foto que se congela al emitir a nombre de un tutor, o null sin tutor. */
export function fotoFiscalDeTutor(tutor, client) {
  if (!tutor) return null;
  return {
    nombre: texto(tutor.name),
    nif: texto(tutor.dni),
    direccion: texto(client?.fiscalAddress),
    cp: texto(client?.fiscalZip),
    ciudad: texto(client?.fiscalCity),
    pais: texto(client?.fiscalCountry),
  };
}

/**
 * A nombre de quién va la factura, si no es de la ficha entera: la foto si ya
 * se emitió, el tutor vivo si es un borrador. `null` = a nombre de la ficha.
 */
export function aNombreDe(invoice, client) {
  const guardianId = invoice?.guardianId ?? invoice?.guardian_id ?? null;
  if (!guardianId) return null;
  const foto = invoice?.fiscalSnapshot ?? invoice?.fiscal_snapshot ?? null;
  if (foto && typeof foto === "object" && !Array.isArray(foto) && texto(foto.nombre)) return texto(foto.nombre);
  return texto(tutorDe(client, guardianId)?.name);
}

/**
 * Lo que impide emitir a nombre de un tutor, en las palabras de quien emite;
 * `null` = se puede (o la factura no va a nombre de ningún tutor).
 */
export function faltaParaEmitirATutor(invoice, client) {
  const guardianId = invoice?.guardianId ?? invoice?.guardian_id ?? null;
  if (!guardianId) return null;
  const tutor = tutorDe(client, guardianId);
  if (!tutor) return "El tutor a cuyo nombre iba esta factura ya no está en la ficha de la familia";
  if (!texto(tutor.name)) return "El tutor no tiene nombre en la ficha de la familia";
  if (!texto(tutor.dni)) return `${texto(tutor.name)} no tiene DNI en la ficha de la familia (Clientes → Padres y tutores)`;
  return null;
}
