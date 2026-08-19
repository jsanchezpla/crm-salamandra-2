// @prueba ligera — funciones de /lib con modelos de mentira; sin base, sin servidor, sin .env.
/**
 * _smoke-clients-contactos.mjs — los varios correos y teléfonos de una familia,
 * y cuál es el principal que se copia a la ficha (19/08/2026).
 *
 *   node scripts/_smoke-clients-contactos.mjs
 *   node --test-name-pattern="espejo" scripts/_smoke-clients-contactos.mjs
 *
 * ── DE QUÉ NACE ────────────────────────────────────────────────────────────
 *
 * Decisión de Aumenta: un cliente o tutor puede tener varios contactos, pero
 * SOLO el principal de cada tipo da acceso al portal «Mis citas» y es el que
 * usan facturación y los avisos de cita. Por eso el resto del CRM sigue leyendo
 * `clients.email` / `clients.phone`, y `lib/clients/contactMethods.js` es el
 * ÚNICO sitio que mantiene esas dos columnas sincronizadas con la tabla de
 * contactos (el «espejo»). Lo comparten el endpoint de contactos, el PUT
 * legacy de la ficha, el alta, la importación, la conversión desde captación y
 * la aceptación de solicitudes de formularios: si el espejo se tuerce, el CRM
 * escribe al correo que no es, o deja el portal apuntando a uno viejo.
 *
 * No tenía prueba. Esta fija:
 *
 *   · cómo se limpian los valores antes de guardarlos (correo a minúsculas, el
 *     teléfono solo recortado, etiqueta acotada a MAX_CONTACT_LABEL);
 *   · qué rechaza la validación, con qué frase y en qué orden;
 *   · el espejo (`syncClientMirror`): el principal manda, sin principal el
 *     primero, sin ninguno la columna a null, y todo dentro de la transacción
 *     que le pasan;
 *   · el upsert del principal (`setPrimaryContactValue`): reutiliza el que ya
 *     hay, funde en vez de duplicar cuando el valor nuevo ya existe en otra
 *     fila, no escribe si nada cambia, y siempre refleja al terminar.
 *
 * Las dos funciones que tocan modelos los reciben por parámetro, así que se
 * prueban con un `ClientContactMethod` de mentira que guarda filas en memoria
 * y apunta cada llamada, y un `client` de mentira que apunta sus `update`.
 *
 * Forma: `node:test` + `node:assert/strict`, como `_smoke-citas-dinero.mjs`.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CONTACT_KINDS,
  MAX_CONTACT_VALUE,
  MAX_CONTACT_LABEL,
  isMissingTable,
  normalizeContactValue,
  normalizeLabel,
  validateContactValue,
  serializeContactMethod,
  syncClientMirror,
  setPrimaryContactValue,
} from "../lib/clients/contactMethods.js";

/** La transacción: un testigo; lo que importa es que llegue ESTE a cada llamada. */
const TX = { nombre: "transacción de prueba" };

// ── Dobles ──────────────────────────────────────────────────────────────────

/**
 * Un `ClientContactMethod` de mentira: filas en memoria, `findOne`/`findAll`
 * filtran por igualdad con el `where`, `create` añade, y cada fila trae su
 * `update`/`destroy`. Todo queda apuntado en `llamadas`, en orden.
 */
function contactosFalsos(iniciales = []) {
  const llamadas = [];
  const filas = [];
  let seq = 0;

  const fila = (datos) => {
    const f = {
      id: datos.id ?? `m-${++seq}`,
      clientId: datos.clientId,
      kind: datos.kind,
      value: datos.value,
      label: datos.label ?? null,
      isPrimary: !!datos.isPrimary,
      async update(cambios, opts) {
        llamadas.push(["fila.update", f.id, cambios, opts]);
        Object.assign(f, cambios);
        return f;
      },
      async destroy(opts) {
        llamadas.push(["fila.destroy", f.id, opts]);
        const i = filas.indexOf(f);
        if (i >= 0) filas.splice(i, 1);
      },
    };
    return f;
  };
  for (const d of iniciales) filas.push(fila(d));

  const cumple = (f, where) => Object.entries(where ?? {}).every(([k, v]) => f[k] === v);

  const ClientContactMethod = {
    async findAll(opts) {
      llamadas.push(["findAll", opts]);
      return filas.filter((f) => cumple(f, opts?.where));
    },
    async findOne(opts) {
      llamadas.push(["findOne", opts]);
      return filas.find((f) => cumple(f, opts?.where)) ?? null;
    },
    async create(datos, opts) {
      llamadas.push(["create", datos, opts]);
      const f = fila(datos);
      filas.push(f);
      return f;
    },
  };
  return { ClientContactMethod, filas, llamadas };
}

/** Un `Client` de mentira: la ficha con sus dos columnas espejo y un `update` que apunta. */
function clienteFalso({ id = "c-1", email = null, phone = null } = {}) {
  const llamadas = [];
  const client = {
    id,
    email,
    phone,
    async update(patch, opts) {
      llamadas.push(["update", patch, opts]);
      Object.assign(client, patch);
      return client;
    },
  };
  return { client, llamadas };
}

const soloEscrituras = (llamadas) =>
  llamadas.filter(([que]) => que === "create" || que.startsWith("fila."));

// ── Lo fijo ─────────────────────────────────────────────────────────────────

describe("las constantes: dos tipos y los anchos de las columnas", () => {
  it("los tipos son correo y teléfono, ni uno más", () => {
    assert.deepEqual(CONTACT_KINDS, ["email", "phone"]);
  });
  it("el valor cabe en 255 (el mismo ancho que clients.email/phone, la columna espejo)", () => {
    assert.equal(MAX_CONTACT_VALUE, 255);
  });
  it("la etiqueta cabe en 60", () => {
    assert.equal(MAX_CONTACT_LABEL, 60);
  });
});

describe("isMissingTable: reconocer «la tabla no existe» (42P01) donde lo deja el driver", () => {
  it("lo lee de parent.code o de original.code", () => {
    assert.equal(isMissingTable({ parent: { code: "42P01" } }), true);
    assert.equal(isMissingTable({ original: { code: "42P01" } }), true);
  });
  it("otro código de error, no", () => {
    assert.equal(isMissingTable({ parent: { code: "23505" } }), false);
    assert.equal(isMissingTable({ original: { code: "25P02" } }), false);
  });
  it("un error sin driver debajo, null o undefined, no (y no revienta)", () => {
    assert.equal(isMissingTable(new Error("cualquier cosa")), false);
    assert.equal(isMissingTable(null), false);
    assert.equal(isMissingTable(undefined), false);
    assert.equal(isMissingTable({}), false);
  });
});

// ── normalizeContactValue ───────────────────────────────────────────────────

describe("normalizeContactValue: limpiar el valor antes de guardarlo", () => {
  it("un correo se recorta y pasa a minúsculas (el portal lo compara tal cual)", () => {
    assert.equal(
      normalizeContactValue("email", "  Familia.Perez@Ejemplo.COM  "),
      "familia.perez@ejemplo.com"
    );
  });
  it("un teléfono solo se recorta: los espacios y guiones de dentro se quedan", () => {
    assert.equal(normalizeContactValue("phone", "  600 12-34-56  "), "600 12-34-56");
    assert.equal(normalizeContactValue("phone", "+34 600123456"), "+34 600123456");
  });
  it("un teléfono que llega como número (una importación) se convierte a texto", () => {
    assert.equal(normalizeContactValue("phone", 600123456), "600123456");
  });
  it("vacío o solo espacios es null, no cadena vacía (la columna espejo queda a null)", () => {
    assert.equal(normalizeContactValue("email", ""), null);
    assert.equal(normalizeContactValue("email", "   "), null);
    assert.equal(normalizeContactValue("phone", "\t\n"), null);
  });
  it("null y undefined, null", () => {
    assert.equal(normalizeContactValue("email", null), null);
    assert.equal(normalizeContactValue("phone", undefined), null);
  });
  it("un tipo que no es correo se recorta pero no se pasa a minúsculas (eso es del correo)", () => {
    assert.equal(normalizeContactValue("phone", " ABC "), "ABC");
    assert.equal(normalizeContactValue("otro", " ABC "), "ABC");
  });
});

// ── normalizeLabel ──────────────────────────────────────────────────────────

describe("normalizeLabel: la etiqueta («Madre», «Trabajo»)", () => {
  it("se recorta por los lados", () => {
    assert.equal(normalizeLabel("  Madre  "), "Madre");
  });
  it("una etiqueta larga se corta a MAX_CONTACT_LABEL caracteres", () => {
    const larga = "Teléfono del trabajo del padre, solo por las mañanas y nunca los viernes";
    assert.ok(larga.length > MAX_CONTACT_LABEL);
    const r = normalizeLabel(larga);
    assert.equal(r.length, MAX_CONTACT_LABEL);
    assert.equal(r, larga.slice(0, MAX_CONTACT_LABEL));
  });
  it("justo 60 se queda entera", () => {
    const justa = "x".repeat(MAX_CONTACT_LABEL);
    assert.equal(normalizeLabel(justa), justa);
  });
  it("vacía, solo espacios, null o undefined → null (sin etiqueta, no etiqueta vacía)", () => {
    assert.equal(normalizeLabel(""), null);
    assert.equal(normalizeLabel("   "), null);
    assert.equal(normalizeLabel(null), null);
    assert.equal(normalizeLabel(undefined), null);
  });
  it("un número se guarda como texto", () => {
    assert.equal(normalizeLabel(2), "2");
  });
});

// ── validateContactValue ────────────────────────────────────────────────────

describe("validateContactValue: qué se rechaza y con qué frase (null = vale)", () => {
  it("un correo bien formado y un teléfono cualquiera, valen", () => {
    assert.equal(validateContactValue("email", "familia.perez@ejemplo.com"), null);
    assert.equal(validateContactValue("phone", "600 12-34-56"), null);
    assert.equal(validateContactValue("phone", "+34 600123456"), null);
  });
  it("un tipo que no existe se rechaza, y la frase dice cuál llegó", () => {
    assert.equal(validateContactValue("fax", "123"), 'Tipo de contacto inválido: "fax"');
    assert.equal(validateContactValue(undefined, "123"), 'Tipo de contacto inválido: "undefined"');
  });
  it("vacío (null, undefined o «») se rechaza", () => {
    assert.equal(validateContactValue("email", null), "El valor no puede estar vacío");
    assert.equal(validateContactValue("phone", undefined), "El valor no puede estar vacío");
    assert.equal(validateContactValue("phone", ""), "El valor no puede estar vacío");
  });
  it("más de MAX_CONTACT_VALUE caracteres se rechaza; justo 255 pasa", () => {
    const justo = "a".repeat(250) + "@x.es";
    assert.equal(justo.length, 255);
    assert.equal(validateContactValue("email", justo), null);
    assert.equal(validateContactValue("phone", "6".repeat(255)), null);
    assert.equal(
      validateContactValue("email", "a".repeat(251) + "@x.es"),
      `El valor supera ${MAX_CONTACT_VALUE} caracteres`
    );
    assert.equal(validateContactValue("phone", "6".repeat(256)), "El valor supera 255 caracteres");
  });
  it("un correo sin arroba, sin punto tras la arroba o con espacios es «Email inválido»", () => {
    assert.equal(validateContactValue("email", "familia.perez"), "Email inválido");
    assert.equal(validateContactValue("email", "familia@perez"), "Email inválido");
    assert.equal(validateContactValue("email", "familia perez@ejemplo.com"), "Email inválido");
    assert.equal(validateContactValue("email", "@ejemplo.com"), "Email inválido");
    assert.equal(validateContactValue("email", "familia@"), "Email inválido");
  });
  it("la forma del correo no mira mayúsculas: normalizar es cosa de normalizeContactValue", () => {
    assert.equal(validateContactValue("email", "Familia@Ejemplo.COM"), null);
  });
  it("el orden de los avisos: tipo, vacío, largo y por último la forma del correo", () => {
    // Un tipo malo con valor vacío: gana el tipo.
    assert.equal(validateContactValue("fax", ""), 'Tipo de contacto inválido: "fax"');
    // Un correo larguísimo y además mal formado: gana el largo.
    assert.equal(
      validateContactValue("email", "a".repeat(300)),
      `El valor supera ${MAX_CONTACT_VALUE} caracteres`
    );
  });
  it("normalizar y luego validar: el camino real del endpoint", () => {
    const v = normalizeContactValue("email", "  Familia.Perez@Ejemplo.COM ");
    assert.equal(validateContactValue("email", v), null);
    assert.equal(v, "familia.perez@ejemplo.com");
    const vacio = normalizeContactValue("email", "   ");
    assert.equal(validateContactValue("email", vacio), "El valor no puede estar vacío");
  });
});

// ── serializeContactMethod ──────────────────────────────────────────────────

describe("serializeContactMethod: la forma estable que consume la pantalla", () => {
  const filaModelo = () => ({
    id: "m-1",
    clientId: "c-1",
    kind: "email",
    value: "familia@ejemplo.com",
    label: "Madre",
    isPrimary: true,
    createdAt: "2026-08-19T10:00:00.000Z",
    updatedAt: "2026-08-19T10:00:00.000Z",
  });

  it("devuelve seis campos y nada más (las fechas se quedan fuera)", () => {
    assert.deepEqual(serializeContactMethod(filaModelo()), {
      id: "m-1",
      clientId: "c-1",
      kind: "email",
      value: "familia@ejemplo.com",
      label: "Madre",
      isPrimary: true,
    });
  });
  it("si la fila trae toJSON (una instancia del modelo), serializa lo que toJSON devuelve", () => {
    const instancia = { toJSON: () => filaModelo(), otraCosa: "no sale" };
    assert.deepEqual(serializeContactMethod(instancia), {
      id: "m-1",
      clientId: "c-1",
      kind: "email",
      value: "familia@ejemplo.com",
      label: "Madre",
      isPrimary: true,
    });
  });
  it("sin etiqueta, label es null; sin isPrimary, false (booleano, no undefined)", () => {
    const sin = filaModelo();
    delete sin.label;
    delete sin.isPrimary;
    const s = serializeContactMethod(sin);
    assert.equal(s.label, null);
    assert.equal(s.isPrimary, false);
  });
  it("isPrimary sale siempre como booleano aunque llegue raro", () => {
    assert.equal(serializeContactMethod({ ...filaModelo(), isPrimary: 1 }).isPrimary, true);
    assert.equal(serializeContactMethod({ ...filaModelo(), isPrimary: 0 }).isPrimary, false);
    assert.equal(serializeContactMethod({ ...filaModelo(), isPrimary: null }).isPrimary, false);
  });
  it("no toca la fila que le dan: devuelve otro objeto", () => {
    const original = filaModelo();
    const s = serializeContactMethod(original);
    assert.notEqual(s, original);
    assert.equal("createdAt" in original, true);
    assert.equal(original.label, "Madre");
  });
});

// ── syncClientMirror ────────────────────────────────────────────────────────

describe("syncClientMirror: el espejo principal → clients.email / clients.phone", () => {
  it("sin modelo registrado, no sincroniza (false) y no toca la ficha", async () => {
    const { client, llamadas } = clienteFalso({ email: "viejo@ejemplo.com" });
    const r = await syncClientMirror({ client, ClientContactMethod: null, transaction: TX });
    assert.equal(r, false);
    assert.deepEqual(llamadas, []);
    assert.equal(client.email, "viejo@ejemplo.com");
  });

  it("lee los contactos del cliente, principal primero y luego por antigüedad, dentro de la transacción", async () => {
    const { ClientContactMethod, llamadas } = contactosFalsos();
    const { client } = clienteFalso({ id: "c-7" });
    await syncClientMirror({ client, ClientContactMethod, transaction: TX });
    const [que, opts] = llamadas[0];
    assert.equal(que, "findAll");
    assert.deepEqual(opts.where, { clientId: "c-7" });
    assert.deepEqual(opts.order, [
      ["isPrimary", "DESC"],
      ["createdAt", "ASC"],
    ]);
    assert.equal(opts.transaction, TX);
  });

  it("el principal de cada tipo va a su columna, y la ficha se guarda en la misma transacción", async () => {
    const { ClientContactMethod } = contactosFalsos([
      { clientId: "c-1", kind: "email", value: "madre@ejemplo.com", isPrimary: true },
      { clientId: "c-1", kind: "email", value: "padre@ejemplo.com", isPrimary: false },
      { clientId: "c-1", kind: "phone", value: "600111222", isPrimary: true },
      { clientId: "c-1", kind: "phone", value: "600333444", isPrimary: false },
    ]);
    const { client, llamadas } = clienteFalso();
    const r = await syncClientMirror({ client, ClientContactMethod, transaction: TX });
    assert.equal(r, true);
    assert.deepEqual(llamadas, [
      ["update", { email: "madre@ejemplo.com", phone: "600111222" }, { transaction: TX }],
    ]);
    assert.equal(client.email, "madre@ejemplo.com");
    assert.equal(client.phone, "600111222");
  });

  it("el principal manda aunque no venga el primero en la lista", async () => {
    const { ClientContactMethod } = contactosFalsos([
      { clientId: "c-1", kind: "email", value: "padre@ejemplo.com", isPrimary: false },
      { clientId: "c-1", kind: "email", value: "madre@ejemplo.com", isPrimary: true },
    ]);
    const { client } = clienteFalso();
    await syncClientMirror({ client, ClientContactMethod, transaction: TX });
    assert.equal(client.email, "madre@ejemplo.com");
  });

  it("sin principal de un tipo pero con contactos, el primero de la lista (la base los da por antigüedad)", async () => {
    const { ClientContactMethod } = contactosFalsos([
      { clientId: "c-1", kind: "phone", value: "600111222", isPrimary: false },
      { clientId: "c-1", kind: "phone", value: "600333444", isPrimary: false },
    ]);
    const { client } = clienteFalso();
    await syncClientMirror({ client, ClientContactMethod, transaction: TX });
    assert.equal(client.phone, "600111222");
  });

  it("sin ningún contacto de un tipo, la columna se pone a null: la tabla de contactos manda sobre la ficha", async () => {
    const { ClientContactMethod } = contactosFalsos([
      { clientId: "c-1", kind: "email", value: "madre@ejemplo.com", isPrimary: true },
    ]);
    const { client, llamadas } = clienteFalso({ email: "viejo@ejemplo.com", phone: "699999999" });
    await syncClientMirror({ client, ClientContactMethod, transaction: TX });
    assert.deepEqual(llamadas[0][1], { email: "madre@ejemplo.com", phone: null });
    assert.equal(client.phone, null);
  });

  it("con la lista vacía, las dos columnas a null (y aun así sincronizó: true)", async () => {
    const { ClientContactMethod } = contactosFalsos();
    const { client, llamadas } = clienteFalso({ email: "viejo@ejemplo.com", phone: "699999999" });
    const r = await syncClientMirror({ client, ClientContactMethod, transaction: TX });
    assert.equal(r, true);
    assert.deepEqual(llamadas, [["update", { email: null, phone: null }, { transaction: TX }]]);
  });

  it("solo mira los contactos de ESE cliente", async () => {
    const { ClientContactMethod } = contactosFalsos([
      { clientId: "c-otro", kind: "email", value: "ajeno@ejemplo.com", isPrimary: true },
      { clientId: "c-1", kind: "email", value: "mio@ejemplo.com", isPrimary: true },
    ]);
    const { client } = clienteFalso({ id: "c-1" });
    await syncClientMirror({ client, ClientContactMethod, transaction: TX });
    assert.equal(client.email, "mio@ejemplo.com");
  });

  it("no escribe en las filas de contactos: solo las lee", async () => {
    const { ClientContactMethod, llamadas, filas } = contactosFalsos([
      { clientId: "c-1", kind: "email", value: "madre@ejemplo.com", isPrimary: true },
    ]);
    const { client } = clienteFalso();
    await syncClientMirror({ client, ClientContactMethod, transaction: TX });
    assert.deepEqual(soloEscrituras(llamadas), []);
    assert.equal(filas.length, 1);
    assert.equal(filas[0].value, "madre@ejemplo.com");
  });

  it("si la lectura revienta (p. ej. la tabla no existe), el error SALE: el rollback es del endpoint", async () => {
    const err = Object.assign(new Error("relation does not exist"), { parent: { code: "42P01" } });
    const ClientContactMethod = {
      async findAll() {
        throw err;
      },
    };
    const { client, llamadas } = clienteFalso({ email: "viejo@ejemplo.com" });
    await assert.rejects(syncClientMirror({ client, ClientContactMethod, transaction: TX }), err);
    assert.deepEqual(llamadas, []);
    assert.equal(client.email, "viejo@ejemplo.com");
  });
});

// ── setPrimaryContactValue ──────────────────────────────────────────────────

describe("setPrimaryContactValue: el campo único de la ficha edita el PRINCIPAL", () => {
  it("sin modelo registrado, escribe directo en la columna de la ficha y devuelve false", async () => {
    const { client, llamadas } = clienteFalso();
    const r = await setPrimaryContactValue({
      client,
      ClientContactMethod: null,
      kind: "email",
      value: "madre@ejemplo.com",
      transaction: TX,
    });
    assert.equal(r, false);
    assert.deepEqual(llamadas, [["update", { email: "madre@ejemplo.com" }, { transaction: TX }]]);

    const otro = clienteFalso();
    await setPrimaryContactValue({
      client: otro.client,
      ClientContactMethod: undefined,
      kind: "phone",
      value: "600111222",
      transaction: TX,
    });
    assert.deepEqual(otro.llamadas, [["update", { phone: "600111222" }, { transaction: TX }]]);
  });

  it("sin principal ni nada parecido, crea uno marcado principal y lo refleja en la ficha", async () => {
    const { ClientContactMethod, filas, llamadas } = contactosFalsos();
    const { client } = clienteFalso({ id: "c-1" });
    const r = await setPrimaryContactValue({
      client,
      ClientContactMethod,
      kind: "email",
      value: "madre@ejemplo.com",
      transaction: TX,
    });
    assert.equal(r, true);
    assert.deepEqual(soloEscrituras(llamadas), [
      [
        "create",
        {
          clientId: "c-1",
          kind: "email",
          value: "madre@ejemplo.com",
          label: null,
          isPrimary: true,
        },
        { transaction: TX },
      ],
    ]);
    assert.equal(filas.length, 1);
    assert.equal(client.email, "madre@ejemplo.com");
  });

  it("antes de crear busca el principal y luego un contacto con ese mismo valor, los dos por cliente y tipo", async () => {
    const { ClientContactMethod, llamadas } = contactosFalsos();
    const { client } = clienteFalso({ id: "c-1" });
    await setPrimaryContactValue({
      client,
      ClientContactMethod,
      kind: "phone",
      value: "600111222",
      transaction: TX,
    });
    const busquedas = llamadas.filter(([que]) => que === "findOne").map(([, opts]) => opts);
    assert.deepEqual(busquedas, [
      { where: { clientId: "c-1", kind: "phone", isPrimary: true }, transaction: TX },
      { where: { clientId: "c-1", kind: "phone", value: "600111222" }, transaction: TX },
    ]);
  });

  it("la etiqueta que venga se guarda en el contacto creado", async () => {
    const { ClientContactMethod, filas } = contactosFalsos();
    const { client } = clienteFalso({ id: "c-1" });
    await setPrimaryContactValue({
      client,
      ClientContactMethod,
      kind: "phone",
      value: "600111222",
      label: "Madre",
      transaction: TX,
    });
    assert.equal(filas[0].label, "Madre");
    assert.equal(filas[0].isPrimary, true);
  });

  it("sin principal pero con un secundario con ese valor, lo asciende en vez de duplicar", async () => {
    const { ClientContactMethod, filas, llamadas } = contactosFalsos([
      { id: "m-sec", clientId: "c-1", kind: "email", value: "madre@ejemplo.com", isPrimary: false },
    ]);
    const { client } = clienteFalso({ id: "c-1" });
    await setPrimaryContactValue({
      client,
      ClientContactMethod,
      kind: "email",
      value: "madre@ejemplo.com",
      transaction: TX,
    });
    assert.deepEqual(soloEscrituras(llamadas), [
      ["fila.update", "m-sec", { isPrimary: true }, { transaction: TX }],
    ]);
    assert.equal(filas.length, 1);
    assert.equal(filas[0].isPrimary, true);
    assert.equal(client.email, "madre@ejemplo.com");
  });

  it("con el principal ya en ese valor y sin etiqueta, no escribe nada en los contactos (pero refleja)", async () => {
    const { ClientContactMethod, llamadas } = contactosFalsos([
      { id: "m-pri", clientId: "c-1", kind: "email", value: "madre@ejemplo.com", isPrimary: true },
    ]);
    const { client, llamadas: delCliente } = clienteFalso({ id: "c-1", email: null });
    const r = await setPrimaryContactValue({
      client,
      ClientContactMethod,
      kind: "email",
      value: "madre@ejemplo.com",
      transaction: TX,
    });
    assert.equal(r, true);
    assert.deepEqual(soloEscrituras(llamadas), []);
    // Solo UNA búsqueda: la del principal. No hace falta buscar duplicados.
    assert.equal(llamadas.filter(([que]) => que === "findOne").length, 1);
    // Y aun así refleja: la ficha queda alineada con la tabla.
    assert.deepEqual(delCliente, [
      ["update", { email: "madre@ejemplo.com", phone: null }, { transaction: TX }],
    ]);
  });

  it("con el principal en ese valor y la MISMA etiqueta, tampoco escribe", async () => {
    const { ClientContactMethod, llamadas } = contactosFalsos([
      {
        id: "m-pri",
        clientId: "c-1",
        kind: "email",
        value: "madre@ejemplo.com",
        label: "Madre",
        isPrimary: true,
      },
    ]);
    const { client } = clienteFalso({ id: "c-1" });
    await setPrimaryContactValue({
      client,
      ClientContactMethod,
      kind: "email",
      value: "madre@ejemplo.com",
      label: "Madre",
      transaction: TX,
    });
    assert.deepEqual(soloEscrituras(llamadas), []);
  });

  it("con el principal en ese valor y otra etiqueta, solo cambia la etiqueta", async () => {
    const { ClientContactMethod, filas, llamadas } = contactosFalsos([
      {
        id: "m-pri",
        clientId: "c-1",
        kind: "email",
        value: "madre@ejemplo.com",
        label: "Casa",
        isPrimary: true,
      },
    ]);
    const { client } = clienteFalso({ id: "c-1" });
    await setPrimaryContactValue({
      client,
      ClientContactMethod,
      kind: "email",
      value: "madre@ejemplo.com",
      label: "Madre",
      transaction: TX,
    });
    assert.deepEqual(soloEscrituras(llamadas), [
      ["fila.update", "m-pri", { label: "Madre" }, { transaction: TX }],
    ]);
    assert.equal(filas[0].label, "Madre");
    assert.equal(filas[0].value, "madre@ejemplo.com");
  });

  it("con principal de OTRO valor y sin nadie con el nuevo, cambia el valor del principal (misma fila)", async () => {
    const { ClientContactMethod, filas, llamadas } = contactosFalsos([
      { id: "m-pri", clientId: "c-1", kind: "email", value: "vieja@ejemplo.com", isPrimary: true },
    ]);
    const { client } = clienteFalso({ id: "c-1", email: "vieja@ejemplo.com" });
    await setPrimaryContactValue({
      client,
      ClientContactMethod,
      kind: "email",
      value: "nueva@ejemplo.com",
      transaction: TX,
    });
    assert.deepEqual(soloEscrituras(llamadas), [
      ["fila.update", "m-pri", { value: "nueva@ejemplo.com" }, { transaction: TX }],
    ]);
    assert.equal(filas.length, 1);
    assert.equal(filas[0].id, "m-pri");
    assert.equal(client.email, "nueva@ejemplo.com");
  });

  it("y si además viene etiqueta, va en el mismo update", async () => {
    const { ClientContactMethod, llamadas } = contactosFalsos([
      { id: "m-pri", clientId: "c-1", kind: "phone", value: "600111222", isPrimary: true },
    ]);
    const { client } = clienteFalso({ id: "c-1" });
    await setPrimaryContactValue({
      client,
      ClientContactMethod,
      kind: "phone",
      value: "600333444",
      label: "Padre",
      transaction: TX,
    });
    assert.deepEqual(soloEscrituras(llamadas), [
      ["fila.update", "m-pri", { value: "600333444", label: "Padre" }, { transaction: TX }],
    ]);
  });

  it("con principal de OTRO valor y un secundario que YA tiene el nuevo: funde (borra el principal viejo, asciende el secundario)", async () => {
    const { ClientContactMethod, filas, llamadas } = contactosFalsos([
      { id: "m-pri", clientId: "c-1", kind: "email", value: "madre@ejemplo.com", isPrimary: true },
      { id: "m-sec", clientId: "c-1", kind: "email", value: "padre@ejemplo.com", isPrimary: false },
    ]);
    const { client } = clienteFalso({ id: "c-1", email: "madre@ejemplo.com" });
    await setPrimaryContactValue({
      client,
      ClientContactMethod,
      kind: "email",
      value: "padre@ejemplo.com",
      transaction: TX,
    });
    assert.deepEqual(soloEscrituras(llamadas), [
      ["fila.destroy", "m-pri", { transaction: TX }],
      ["fila.update", "m-sec", { isPrimary: true }, { transaction: TX }],
    ]);
    // No quedan dos filas con el mismo valor, y la única que queda es principal.
    assert.deepEqual(
      filas.map((f) => [f.id, f.value, f.isPrimary]),
      [["m-sec", "padre@ejemplo.com", true]]
    );
    assert.equal(client.email, "padre@ejemplo.com");
  });

  it("al fundir, la etiqueta que venga se pone en el que asciende", async () => {
    const { ClientContactMethod, filas } = contactosFalsos([
      { id: "m-pri", clientId: "c-1", kind: "email", value: "madre@ejemplo.com", isPrimary: true },
      {
        id: "m-sec",
        clientId: "c-1",
        kind: "email",
        value: "padre@ejemplo.com",
        label: "Padre",
        isPrimary: false,
      },
    ]);
    const { client } = clienteFalso({ id: "c-1" });
    await setPrimaryContactValue({
      client,
      ClientContactMethod,
      kind: "email",
      value: "padre@ejemplo.com",
      label: "Tutor",
      transaction: TX,
    });
    assert.equal(filas.length, 1);
    assert.equal(filas[0].label, "Tutor");
    assert.equal(filas[0].isPrimary, true);
  });

  it("los correos y los teléfonos no se mezclan: cambiar el teléfono principal no toca los correos", async () => {
    const { ClientContactMethod, filas } = contactosFalsos([
      {
        id: "m-email",
        clientId: "c-1",
        kind: "email",
        value: "madre@ejemplo.com",
        isPrimary: true,
      },
      { id: "m-tel", clientId: "c-1", kind: "phone", value: "600111222", isPrimary: true },
    ]);
    const { client } = clienteFalso({ id: "c-1" });
    await setPrimaryContactValue({
      client,
      ClientContactMethod,
      kind: "phone",
      value: "600333444",
      transaction: TX,
    });
    assert.deepEqual(
      filas.map((f) => [f.id, f.kind, f.value, f.isPrimary]),
      [
        ["m-email", "email", "madre@ejemplo.com", true],
        ["m-tel", "phone", "600333444", true],
      ]
    );
    // Y el espejo vuelve a escribir LAS DOS columnas, cada una con su principal.
    assert.equal(client.email, "madre@ejemplo.com");
    assert.equal(client.phone, "600333444");
  });

  it("ni el valor de otro cliente ni su principal cuentan", async () => {
    const { ClientContactMethod, filas } = contactosFalsos([
      {
        id: "m-ajeno",
        clientId: "c-otro",
        kind: "email",
        value: "madre@ejemplo.com",
        isPrimary: true,
      },
    ]);
    const { client } = clienteFalso({ id: "c-1" });
    await setPrimaryContactValue({
      client,
      ClientContactMethod,
      kind: "email",
      value: "madre@ejemplo.com",
      transaction: TX,
    });
    // Se crea uno propio: el del otro cliente sigue intacto.
    assert.equal(filas.length, 2);
    assert.equal(filas.find((f) => f.id === "m-ajeno").isPrimary, true);
    assert.equal(filas.find((f) => f.clientId === "c-1").isPrimary, true);
  });

  it("todas las lecturas y escrituras llevan la transacción que le pasan, tal cual", async () => {
    const { ClientContactMethod, llamadas } = contactosFalsos([
      { id: "m-pri", clientId: "c-1", kind: "email", value: "madre@ejemplo.com", isPrimary: true },
      { id: "m-sec", clientId: "c-1", kind: "email", value: "padre@ejemplo.com", isPrimary: false },
    ]);
    const { client, llamadas: delCliente } = clienteFalso({ id: "c-1" });
    await setPrimaryContactValue({
      client,
      ClientContactMethod,
      kind: "email",
      value: "padre@ejemplo.com",
      transaction: TX,
    });
    assert.ok(llamadas.length >= 4, "busca, borra, asciende y relee");
    for (const llamada of llamadas) {
      const opts = llamada[llamada.length - 1];
      assert.equal(opts.transaction, TX, `${llamada[0]} sin la transacción`);
    }
    for (const [, , opts] of delCliente) assert.equal(opts.transaction, TX);
  });

  it("si la tabla no existe, el error SALE (para que el endpoint haga rollback y degrade fuera)", async () => {
    const err = Object.assign(new Error("relation does not exist"), { parent: { code: "42P01" } });
    const ClientContactMethod = {
      async findOne() {
        throw err;
      },
    };
    const { client, llamadas } = clienteFalso({ id: "c-1", email: "vieja@ejemplo.com" });
    await assert.rejects(
      setPrimaryContactValue({
        client,
        ClientContactMethod,
        kind: "email",
        value: "nueva@ejemplo.com",
        transaction: TX,
      }),
      err
    );
    assert.deepEqual(llamadas, []);
    assert.equal(client.email, "vieja@ejemplo.com");
  });
});
