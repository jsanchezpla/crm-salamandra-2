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
 * Sin tutor elegido —ni en la ficha ni en la factura— todo sigue como estaba:
 * se factura a nombre de la ficha, con su `fiscalName` o su nombre.
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
import { nombreFiscalDeCliente } from "./nifCliente.js";
import { GUARDIAN_RELATIONSHIP_LABEL } from "../clients/guardians.js";

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
 * @returns {Array<{value: string, label: string, sinDni: boolean}>}
 */
export function opcionesDeRazonSocial(client) {
  const ficha = {
    value: LA_FICHA,
    label: nombreFiscalDeCliente(client) ?? "La ficha del cliente",
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
 * La razón social por defecto de una familia: el tutor guardado en la ficha,
 * o `LA_FICHA`.
 *
 * Falla hacia LA FICHA cuando el tutor guardado ya no está (se borró de la
 * pestaña de tutores): mejor facturar a nombre de la familia —que es correcto—
 * que a nombre de un id que no existe.
 */
export function razonSocialPorDefecto(client) {
  const id = String(client?.fiscalGuardianId ?? client?.fiscal_guardian_id ?? "").trim().toLowerCase();
  if (!UUID_RE.test(id)) return LA_FICHA;
  const existe = (Array.isArray(client?.guardians) ? client.guardians : []).some(
    (g) => g && String(g.id ?? "").toLowerCase() === id
  );
  return existe ? id : LA_FICHA;
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
 * los cobros igual (una fila de cobro por parte, del mismo mes y cuota); sin
 * reparto manda `fiscalGuardianId` (una sola factura a nombre de uno) o la
 * ficha. Cada tutor del reparto necesita su DNI para poder emitir.
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
