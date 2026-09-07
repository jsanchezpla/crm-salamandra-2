/**
 * lib/billing/razonSocial.js — a nombre de quién se factura a una familia
 * (04/09/2026, Rodrigo).
 *
 * El encargo: «en la razón social que se ponga un desplegable con los tutores,
 * y que en la creación de facturas puedas elegir la razón social a la que
 * enviar cada factura. Que se ponga por defecto la seleccionada en el cliente
 * pero que se pueda cambiar en el desplegable».
 *
 * ── LO QUE YA HABÍA, Y LO QUE FALTABA ──────────────────────────────────────
 * Desde el 02/09/2026 una factura puede ir a nombre de un tutor de la familia
 * (`invoices.guardian_id` → la entrada de `clients.guardians`;
 * `lib/billing/datosFiscales.js` decide qué se imprime y qué se congela). Pero
 * eso solo se podía elegir en UN sitio: el reparto entre varios pagadores. En
 * el formulario normal de factura no existía, y la ficha solo tenía la razón
 * social como texto libre, que hay que reescribir a mano y que no lleva el DNI
 * detrás — y sin DNI la factura no se puede emitir a ese nombre.
 *
 * Faltaban entonces dos cosas y las dos son esta pieza:
 *
 *   1. **La familia elige su razón social por defecto**, guardada como QUIÉN
 *      (`clients.fiscal_guardian_id`) y no como texto. Un id sigue a la persona:
 *      si mañana se corrige el apellido o se rellena el DNI en la ficha de
 *      tutores, la factura sale bien sola. Un nombre copiado se queda viejo en
 *      silencio, que es el fallo que ya costó la foto fiscal de las facturas.
 *   2. **Cada factura puede desviarse** de ese defecto sin tocar la ficha:
 *      padres separados que se turnan, un mes que paga la abuela. Es el mismo
 *      `guardianId` que ya entiende el POST de facturas.
 *
 * ── LO QUE FALTABA TODAVÍA: QUE NO HAYA QUE ELEGIRLO (08/09/2026, Rodrigo) ──
 * «Tiene que ser el nombre del tutor principal y su DNI hasta que se
 * especifique lo contrario; cuando la factura es partida, los DNIs y nombres
 * de ambos».
 *
 * El desplegable existía desde el 04/09 y NADIE lo había tocado: 0 de las 1.094
 * familias de Aumenta tenían tutor de facturación elegido. Mientras tanto la
 * factura salía a nombre de la ficha, y 216 fichas se llaman exactamente igual
 * que su paciente — o sea que 894 facturas se emitieron a nombre de un menor.
 * Pedir que alguien entre una a una en 1.094 fichas no era un arreglo.
 *
 * Así que el defecto ya no es «la ficha»: es EL TUTOR PRINCIPAL, y se calcula.
 * Calculado y no copiado a la columna, por lo mismo que se guarda un id y no un
 * nombre: rellenar hoy el DNI de una madre en «Padres y tutores» arregla sus
 * facturas siguientes sin que nadie tenga que acordarse de volver aquí.
 *
 * Se factura a nombre de la ficha SOLO si sigue siendo lo correcto: cuando la
 * familia no tiene ningún tutor con nombre y DNI, o cuando alguien ha escrito a
 * mano la razón social o el NIF de facturación de la ficha — eso ES «lo
 * contrario» y manda, que es como se factura a una empresa o a una fundación.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const texto = (v) => {
  const s = String(v ?? "").trim();
  return s || null;
};

/** El valor que representa «a nombre de la ficha», no de un tutor. */
export const LA_FICHA = "";

/**
 * Cómo se llama la ficha a efectos de factura: su razón social escrita, y si
 * no la hay, su nombre. (Es `nombreFiscalDeCliente`, repetido aquí a
 * propósito NO: se importa, para que no puedan divergir.)
 */
import { nifDeCliente, nombreFiscalDeCliente } from "./nifCliente.js";
import { GUARDIAN_RELATIONSHIP_LABEL } from "../clients/guardians.js";

/** Dos documentos son el mismo aunque uno lleve puntos, guiones o minúsculas. */
const mismoNif = (a, b) => {
  const limpio = (v) => String(v ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  return !!limpio(a) && limpio(a) === limpio(b);
};

/**
 * EL TUTOR PRINCIPAL de una familia: a cuyo nombre y DNI se factura mientras
 * nadie diga lo contrario. Devuelve la entrada de `guardians`, o null.
 *
 * Solo entran los tutores que se pueden facturar —con nombre y con DNI—, y de
 * ellos manda, por este orden:
 *
 *   1. **El titular de la ficha**, si es uno de los tutores: su DNI es el que
 *      ya lleva la ficha (`taxId`). Es la regla que evita el estropicio: en
 *      Aumenta, 365 familias tienen a la madre como titular y al padre el
 *      primero de la lista de tutores; coger «el primero» a secas le habría
 *      cambiado de progenitor la factura a 365 familias que hoy están bien.
 *      Con esta regla se les corrige el NOMBRE (que era el del niño) sin
 *      tocarles el NIF.
 *   2. **El primero de la lista**, que es el orden en que el centro los tecleó
 *      o los trajo de Organízate. Es lo que queda cuando el DNI de la ficha no
 *      es de ninguno de ellos —o no hay ninguno—, que es justo el caso del
 *      niño con ficha a su nombre.
 */
export function tutorPrincipalDe(client) {
  const facturables = (Array.isArray(client?.guardians) ? client.guardians : []).filter(
    (g) => g && typeof g === "object" && UUID_RE.test(String(g.id ?? "")) && texto(g.name) && texto(g.dni)
  );
  if (!facturables.length) return null;
  const nif = nifDeCliente(client);
  return facturables.find((g) => mismoNif(g.dni, nif)) ?? facturables[0];
}

/**
 * El tutor principal, pero solo si la familia no ha dicho ya lo contrario por
 * escrito. `null` = se factura a nombre de la ficha.
 *
 * Una razón social o un NIF de facturación escritos a mano son una decisión
 * tomada —una empresa, una fundación, el abuelo que paga— y ganan al cálculo:
 * si no, el día del despliegue se les cambiaría el destinatario sin avisar.
 */
export function razonSocialAutomatica(client) {
  if (texto(client?.fiscalName) || texto(client?.fiscalTaxId ?? client?.fiscal_tax_id)) return null;
  return tutorPrincipalDe(client);
}

/**
 * Las opciones del desplegable de razón social de una familia: la ficha
 * primero y luego cada tutor, con su parentesco para distinguir a dos personas
 * del mismo apellido.
 *
 * Un tutor SIN DNI sale igual, marcado: esconderlo dejaría a quien factura sin
 * entender por qué falta alguien, y el freno de verdad ya está en la emisión
 * (`faltaParaEmitirATutor`). Aquí se avisa; allí se para.
 *
 * ⚠️ Lo que devuelve es lo que puede VIAJAR AL NAVEGADOR: nombre, parentesco y
 * si le falta DNI — nunca el DNI ni el teléfono. Es la misma razón por la que
 * `ATRIBUTOS_CLIENTE_FACTURA` deja `guardians` fuera (revisión del 02/09/2026):
 * las pantallas de dinero no necesitan los datos personales de los tutores para
 * elegir un nombre.
 *
 * @param {object} client  la ficha, con `guardians`.
 * @returns {Array<{value: string, label: string, sinDni: boolean, automatico?: boolean}>}
 */
export function opcionesDeRazonSocial(client) {
  // La primera opción ya no es siempre «la ficha»: desde el 08/09/2026 es
  // AUTOMÁTICO, y automático casi siempre quiere decir el tutor principal. La
  // etiqueta se monta aquí, entera, para que la ficha y el formulario de
  // factura no acaben llamando de dos maneras distintas a lo mismo.
  const automatico = razonSocialAutomatica(client);
  const ficha = {
    value: LA_FICHA,
    label: automatico
      ? `Automático · ${texto(automatico.name)} (tutor principal)`
      : `${nombreFiscalDeCliente(client) ?? "La ficha del cliente"} (la ficha)`,
    automatico: !!automatico,
    sinDni: false,
  };
  const tutores = (Array.isArray(client?.guardians) ? client.guardians : [])
    .filter((g) => g && typeof g === "object" && texto(g.name) && UUID_RE.test(String(g.id ?? "")))
    .map((g) => ({
      value: String(g.id).toLowerCase(),
      label: `${texto(g.name)}${GUARDIAN_RELATIONSHIP_LABEL[g.relationship] ? ` · ${GUARDIAN_RELATIONSHIP_LABEL[g.relationship]}` : ""}${texto(g.dni) ? "" : "  ⚠ sin DNI"}`,
      sinDni: !texto(g.dni),
    }));
  return [ficha, ...tutores];
}

/**
 * La razón social ELEGIDA a mano en la ficha: el tutor guardado, o `LA_FICHA`
 * si no hay ninguno. Es lo que enseña —y lo que guarda— el desplegable de la
 * ficha, y por eso NO calcula nada: abrir y guardar «Datos de facturación» no
 * puede dejar clavado un tutor que nadie eligió.
 *
 * Falla hacia LA FICHA cuando el tutor guardado ya no está (se borró de la
 * pestaña de tutores): mejor facturar a nombre de la familia —que es correcto—
 * que a nombre de un id que no existe.
 */
export function razonSocialGuardada(client) {
  const id = String(client?.fiscalGuardianId ?? client?.fiscal_guardian_id ?? "").trim().toLowerCase();
  if (!UUID_RE.test(id)) return LA_FICHA;
  const existe = (Array.isArray(client?.guardians) ? client.guardians : []).some(
    (g) => g && String(g.id ?? "").toLowerCase() === id
  );
  return existe ? id : LA_FICHA;
}

/**
 * A nombre de quién sale una factura NUEVA de esta familia si nadie la cambia:
 * el tutor elegido a mano, y si no hay ninguno el tutor principal (08/09/2026).
 * `LA_FICHA` cuando ninguno de los dos existe.
 *
 * Lo usan el formulario de factura —que lo deja preseleccionado y editable— y
 * «Facturar el mes». Las facturas ya emitidas no lo miran nunca: llevan su
 * propia foto fiscal (`lib/billing/datosFiscales.js`).
 */
export function razonSocialPorDefecto(client) {
  const elegida = razonSocialGuardada(client);
  if (elegida !== LA_FICHA) return elegida;
  return razonSocialAutomatica(client)?.id ?? LA_FICHA;
}

/**
 * Qué se escribiría en la factura con esa elección. Lo usa la pantalla para
 * poder decirlo sin esperar a emitir.
 */
export function nombreDeRazonSocial(client, guardianId) {
  const id = String(guardianId ?? "").trim().toLowerCase();
  if (!UUID_RE.test(id)) return nombreFiscalDeCliente(client);
  const tutor = (Array.isArray(client?.guardians) ? client.guardians : []).find(
    (g) => g && String(g.id ?? "").toLowerCase() === id
  );
  return texto(tutor?.name) ?? nombreFiscalDeCliente(client);
}

/**
 * Lo que acepta la ficha al guardar su razón social por defecto: un id de
 * tutor de ESA ficha, o null. Un id que no está entre sus tutores no se
 * guarda — dejaría la ficha apuntando a nadie.
 */
export function limpiarRazonSocialPorDefecto(valor, guardians) {
  const id = String(valor ?? "").trim().toLowerCase();
  if (!UUID_RE.test(id)) return null;
  const existe = (Array.isArray(guardians) ? guardians : []).some(
    (g) => g && String(g.id ?? "").toLowerCase() === id
  );
  return existe ? id : null;
}

/*
 * ── REPARTO ENTRE TUTORES (06/09/2026, Rodrigo: «padres juntos pero cada uno
 *    con su factura») ─────────────────────────────────────────────────────
 * La ficha guarda `fiscalSplit`: [{ guardianId, pct }] que suma 100. Con
 * reparto, «Facturar el mes» emite UNA FACTURA POR TUTOR con su parte y parte
 * los cobros igual (una fila de cobro por parte, del mismo mes y cuota), cada
 * una con el nombre y el DNI de SU tutor. Sin reparto sale una sola factura,
 * a nombre de `razonSocialPorDefecto`: el tutor elegido, el principal, o la
 * ficha. Cada tutor del reparto necesita su DNI para poder emitir.
 *
 * El reparto NO se pone solo: es la excepción, y la elige la familia en su
 * ficha (08/09/2026, Rodrigo: el tutor principal «hasta que se especifique lo
 * contrario; cuando la factura es partida, los DNIs y nombres de ambos»).
 */

/** Lo que acepta la ficha al guardar su reparto: dos o más tutores DE ESA ficha, con porcentajes que suman 100; si no, null. */
export function limpiarRepartoEntreTutores(valor, guardians) {
  if (!Array.isArray(valor) || valor.length < 2) return null;
  const ids = new Set(
    (Array.isArray(guardians) ? guardians : [])
      .filter((g) => g && UUID_RE.test(String(g.id ?? "")))
      .map((g) => String(g.id).toLowerCase())
  );
  const filas = [];
  const vistos = new Set();
  for (const v of valor) {
    const id = String(v?.guardianId ?? "").trim().toLowerCase();
    const pct = Math.round(Number(v?.pct) * 100) / 100;
    if (!ids.has(id) || vistos.has(id) || !(pct > 0)) return null;
    vistos.add(id);
    filas.push({ guardianId: id, pct });
  }
  const suma = Math.round(filas.reduce((s, f) => s + f.pct, 0) * 100) / 100;
  if (Math.abs(suma - 100) > 0.01) return null;
  return filas;
}

/** El reparto vigente de una ficha (saneado contra sus tutores de hoy), o null. */
export function repartoEntreTutores(client) {
  return limpiarRepartoEntreTutores(client?.fiscalSplit ?? client?.fiscal_split, client?.guardians);
}

/**
 * Un importe partido por el reparto, en céntimos exactos: cada parte redondea
 * hacia abajo y el último tutor se queda con lo que sobra, así la suma es el
 * importe al céntimo (37,50 € al 50/50 → 18,75 + 18,75; 0,03 € → 0,01 + 0,02).
 */
export function partirImporteEntreTutores(importe, reparto) {
  const total = Math.round(Number(importe) * 100);
  let acumulado = 0;
  return reparto.map((r, i) => {
    const cent = i === reparto.length - 1 ? total - acumulado : Math.floor((total * r.pct) / 100);
    acumulado += cent;
    return { guardianId: r.guardianId, pct: r.pct, importe: cent / 100 };
  });
}
