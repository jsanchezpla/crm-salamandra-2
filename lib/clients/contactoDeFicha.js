/**
 * lib/clients/contactoDeFicha.js — el correo y el teléfono con los que se puede
 * avisar a una familia, mirando también a sus tutores.
 *
 * (Fichero en `/lib`, regla #2: la regla la comparten el buscador de fichas del
 * alta de cita, el autorrelleno al elegir paciente y su prueba. Es un «si no
 * tiene X mira en Y», justo lo que el CLAUDE.md prohíbe dejar suelto por el JSX.)
 *
 * ── DE DÓNDE SALE (28/08/2026, Lau de Aumenta) ─────────────────────────────
 * Lau: «al generar una cita siempre me pide mail y teléfono … me tengo que
 * salir, buscar esa info, anotarla a lápiz y papel y luego hacer la cita».
 *
 * Parte de esas veces el dato SÍ estaba en el CRM, solo que en otro sitio: en
 * un centro de menores el correo suele estar en el padre o en la madre, no en
 * la ficha de la familia. Viven en `Client.guardians` desde el sprint del
 * 28/07/2026 (`lib/clients/guardians.js`) y ninguna pantalla de Citas los
 * miraba.
 *
 * Medido en producción ese día, sobre las 1.083 fichas de Aumenta:
 *   · 330 no tienen correo en la ficha — de esas, 65 SÍ lo tienen en un tutor.
 *   · 234 no tienen teléfono — de esas, 0 lo tienen en un tutor.
 * O sea que esto rescata 65 correos que ya eran nuestros, y ni un teléfono.
 * Las 265 fichas sin correo en ninguna parte y las 234 sin teléfono NO se
 * arreglan aquí: ese dato no existe, y hay que pedírselo a la familia.
 *
 * ⚠️ Esto NO inventa contacto ni lo copia a la ficha: solo dice con qué se
 * puede avisar hoy. Quien lo use rellena un formulario, y la persona que lo
 * mira sigue mandando.
 */

/** Primer valor no vacío de esa clave entre los tutores. `null` si ninguno. */
function deTutores(guardians, clave) {
  if (!Array.isArray(guardians)) return null;
  for (const g of guardians) {
    const v = g && typeof g === "object" ? g[clave] : null;
    const limpio = typeof v === "string" ? v.trim() : "";
    if (limpio) return limpio;
  }
  return null;
}

/** El propio campo de la ficha, ya limpio. `null` si está vacío o no es texto. */
function propio(valor) {
  const limpio = typeof valor === "string" ? valor.trim() : "";
  return limpio || null;
}

/**
 * Con qué se puede avisar a esta familia.
 *
 * Manda SIEMPRE lo que hay en la ficha; el tutor es el respaldo. Si la ficha
 * tiene correo y un tutor tiene otro distinto, gana el de la ficha: es el que
 * administración ha puesto a propósito, y el que ya usan el portal y los bonos.
 *
 * @param {object} client  fila de Client (o su JSON) con `email`, `phone` y `guardians`
 * @returns {{email: string|null, phone: string|null, emailDeTutor: boolean, phoneDeTutor: boolean}}
 */
export function contactoDeFicha(client) {
  const guardians = client?.guardians;
  const emailPropio = propio(client?.email);
  const phonePropio = propio(client?.phone);
  const emailTutor = emailPropio ? null : deTutores(guardians, "email");
  const phoneTutor = phonePropio ? null : deTutores(guardians, "phone");
  return {
    email: emailPropio ?? emailTutor ?? null,
    phone: phonePropio ?? phoneTutor ?? null,
    emailDeTutor: !emailPropio && !!emailTutor,
    phoneDeTutor: !phonePropio && !!phoneTutor,
  };
}

/**
 * La ficha lista para mandar al navegador: con el contacto ya resuelto y **sin
 * `guardians`**.
 *
 * Lo segundo no es cosmética. `guardians` lleva el DNI de los progenitores
 * (`lib/clients/guardians.js`), y un desplegable de fichas no tiene por qué
 * llevar eso dentro: se pide a la base para resolver el contacto y se deja
 * fuera de la respuesta. Lo que sale es lo mismo que salía antes —`email` y
 * `phone`— solo que ahora encontrado también en el tutor.
 *
 * @param {object} json  una fila de Client ya serializada (`toJSON()`)
 */
export function fichaConContacto(json) {
  if (!json || typeof json !== "object") return json;
  const { guardians: _fuera, ...resto } = json;
  const { email, phone, emailDeTutor, phoneDeTutor } = contactoDeFicha(json);
  return { ...resto, email, phone, contactoDeTutor: emailDeTutor || phoneDeTutor };
}

/**
 * Qué campos del alta de cita se rellenan al elegir esta ficha.
 *
 * ── EL CORREO SE PEGABA A LA FICHA ANTERIOR (28/08/2026) ────────────────────
 * El autorrelleno de julio hacía `clientEmail: c.email || prev.clientEmail`. Ese
 * `|| prev` es correcto mientras se hable de la MISMA familia —no pisa lo que
 * alguien haya escrito a mano cuando la ficha está vacía—, pero al CAMBIAR de
 * familia deja de serlo: elegir a una familia con correo y cambiar después a
 * otra sin correo dejaba puesto el de la primera, y la cita de la segunda se
 * creaba y se enviaba a esa dirección.
 *
 * No es incomodidad: es mandarle a una familia la cita de otra, con el nombre
 * del hijo dentro. Y no se ve, porque el campo se queda relleno y con buena
 * pinta. Con 330 de las 1.083 fichas de Aumenta sin correo, la combinación
 * «una con correo, la siguiente sin él» es de todos los días.
 *
 * La regla, entonces:
 *   · ficha DISTINTA → el contacto se reemplaza entero, aunque venga vacío.
 *   · MISMA ficha    → manda la ficha donde tenga dato, y lo tecleado a mano
 *                      sobrevive solo en los huecos que la ficha deja vacíos.
 *
 * Lo segundo es lo de siempre (`c.email || prev`) y se conserva a propósito:
 * volver a elegir la misma ficha es releerla, y quien apunta la cita a alguien
 * cuya ficha está vacía necesita poder escribir el correo que le acaban de
 * dictar sin que se lo borre el siguiente clic.
 *
 * @param {object} prev   el formulario tal y como está ahora
 * @param {object} ficha  la ficha elegida, ya pasada por `fichaConContacto`
 */
export function datosAlElegirFicha(prev, ficha) {
  if (!ficha?.id) return {};
  const actual = prev ?? {};
  const otraFamilia = String(actual.clientId ?? "") !== String(ficha.id);
  const email = ficha.email ?? null;
  const phone = ficha.phone ?? null;
  return {
    clientId: ficha.id,
    clientName: ficha.name || actual.clientName || "",
    clientEmail: otraFamilia ? (email ?? "") : (email || actual.clientEmail || ""),
    clientPhone: otraFamilia ? (phone ?? "") : (phone || actual.clientPhone || ""),
  };
}

/**
 * ¿Hay que avisar de que a esta familia no se la puede avisar?
 *
 * Devuelve `null` cuando es localizable por los dos canales —el caso normal, y
 * un aviso que sale siempre no lo lee nadie— y si no, qué falta y cuánto duele.
 *
 * ── POR QUÉ AQUÍ Y NO DENTRO DEL CHIP (Jorge, 28/08/2026) ──────────────────
 *
 * Porque es un «si le falta X, enseña Y», y esos van en `lib/` con nombre y con
 * prueba, no sueltos por el JSX: lo pintan DOS fichas (la base y la propia de
 * `nutri_laura`) y basta con que una se quede sin actualizar para que un centro
 * deje de ver el aviso sin que nadie se entere.
 *
 * En producción, el 28/08/2026: 102 familias vivas de Aumenta sin teléfono ni
 * correo en ningún sitio, y otras 210 activas sin correo — que son las que no
 * pueden entrar al área privada ni recibir su factura.
 *
 * @param {object} client  ficha con `email`, `phone` y `guardians`
 * @returns {{grave: boolean, falta: string, explicacion: string}|null}
 */
export function avisoFaltaContacto(client) {
  if (!client) return null;
  const { email, phone } = contactoDeFicha(client);
  if (email && phone) return null;

  // Sin ninguno de los dos no hay forma de llegar a esta familia. Con uno solo
  // se la puede avisar, aunque no por todos los canales: no es lo mismo y no se
  // pinta igual.
  const grave = !email && !phone;

  if (grave) {
    return {
      grave: true,
      falta: "teléfono ni correo",
      explicacion:
        "No hay forma de avisar a esta familia: ni recordatorios de cita, ni facturas, ni acceso al área privada. Hay que pedirle un teléfono o un correo y apuntarlo aquí o en un tutor.",
    };
  }
  if (!email) {
    return {
      grave: false,
      falta: "correo",
      explicacion:
        "Sin correo no recibe la confirmación de sus citas, ni el recordatorio, ni la factura, y no puede entrar al área privada.",
    };
  }
  return {
    grave: false,
    falta: "teléfono",
    explicacion: "Sin teléfono no se la puede avisar de un cambio de última hora.",
  };
}

/** Un correo con pinta de correo: algo@algo.algo, sin espacios. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * A QUÉ CORREOS se avisa a esta familia (06/09/2026, Rodrigo: «manda el correo
 * también a los tutores cuando la ficha no tenga»).
 *
 * `contactoDeFicha` responde «con qué se puede avisar» y devuelve UN correo,
 * el primero que encuentra: vale para rellenar un formulario. Un aviso que
 * sale solo —el registro de sesión publicado, la factura— es otra cosa: si la
 * ficha no tiene correo, se manda a TODOS los tutores que lo tengan, que son
 * la familia. Medido en Aumenta el 06/09/2026: 1.090 familias con paciente,
 * 788 con correo en la ficha, 58 sin él pero con el de algún tutor.
 *
 * Manda la ficha cuando lo tiene (es el que administración puso a propósito y
 * el que usan el portal y los bonos); los tutores son el respaldo, nunca un
 * añadido. Sin correo en ninguna parte, lista vacía: quien llama dice por qué
 * no avisa, no falla en silencio.
 *
 * @param {object} client  fila de Client (o su JSON) con `email` y `guardians`
 * @returns {{ correos: string[], deTutores: boolean }}
 */
export function correosParaAvisar(client) {
  const propioLimpio = propio(client?.email);
  if (propioLimpio && EMAIL_RE.test(propioLimpio)) return { correos: [propioLimpio], deTutores: false };
  const vistos = new Set();
  const correos = [];
  for (const g of Array.isArray(client?.guardians) ? client.guardians : []) {
    const v = g && typeof g === "object" ? propio(g.email) : null;
    if (!v || !EMAIL_RE.test(v)) continue;
    const clave = v.toLowerCase();
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    correos.push(v);
  }
  return { correos, deTutores: correos.length > 0 };
}
