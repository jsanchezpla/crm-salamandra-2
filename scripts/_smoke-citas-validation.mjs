// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-citas-validation.mjs — lo que entra por el widget de reservas y por los
 * tipos de cita pasa por un solo filtro (19/08/2026).
 *
 *   node scripts/_smoke-citas-validation.mjs
 *   node --test-name-pattern="slugify" scripts/_smoke-citas-validation.mjs
 *
 * ── DE QUÉ NACE ────────────────────────────────────────────────────────────
 *
 * `lib/citas/validation.js` es la primera criba de tres cosas que llegan de
 * fuera: lo que una familia teclea en el widget público de reservas
 * (`/api/public/c/[slug]/book`), lo que dirección guarda en /citas/tipos
 * (nombre, slug, color, modalidades) y los tramos de /citas/disponibilidad.
 * Lo importan 18 endpoints y ninguna prueba lo miraba: la única red era leer
 * el código.
 *
 * Cada función pequeña tiene una consecuencia grande si se tuerce: un correo
 * mal normalizado es una familia que no recibe su confirmación ni encuentra
 * sus citas en el portal; un slug mal hecho es una URL pública rota; una hora
 * que pasa sin mirar es un tramo de agenda que no existe. Esta prueba fija lo
 * que DEVUELVE cada función —qué recorta, a qué longitud, qué cuenta como
 * válido— con entradas como las que llegan de verdad, para que el día que
 * alguien la «mejore» se vea en rojo qué cambió.
 *
 * Lo que aquí se comprueba son resultados, nunca el texto del código: si mañana
 * `slugify` se escribe de otra manera pero sigue dando `sesion-inicial`, esta
 * prueba no se entera, y así tiene que ser.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  VALID_MODALITIES,
  VALID_STATUS,
  normalizeString,
  normalizeEmail,
  isValidEmail,
  slugify,
  isValidSlug,
  isValidHexColor,
  normalizeModalities,
  validateModalityFields,
  timeToMinutes,
  normalizeTime,
} from "../lib/citas/validation.js";

describe("VALID_MODALITIES / VALID_STATUS: las listas que el módulo reconoce", () => {
  it("tres modalidades, y con estos nombres: presencial, phone, online", () => {
    assert.deepEqual(VALID_MODALITIES, ["presencial", "phone", "online"]);
  });
  it("cuatro estados de cita: confirmed, completed, cancelled, no_show", () => {
    assert.deepEqual(VALID_STATUS, ["confirmed", "completed", "cancelled", "no_show"]);
  });
});

describe("normalizeString: recorta, y el vacío es null", () => {
  it("quita los espacios de los dos lados y deja el texto", () => {
    assert.equal(normalizeString("  Sesión inicial  "), "Sesión inicial");
    assert.equal(normalizeString("\tCalle Mayor 3\n"), "Calle Mayor 3");
  });
  it("vacío, solo espacios, null y undefined → null (el endpoint dice «obligatorio»)", () => {
    assert.equal(normalizeString(""), null);
    assert.equal(normalizeString("   "), null);
    assert.equal(normalizeString(null), null);
    assert.equal(normalizeString(undefined), null);
  });
  it("un número del body llega como texto: 42 → «42»", () => {
    assert.equal(normalizeString(42), "42");
  });
});

describe("normalizeEmail: el correo se guarda recortado y en minúsculas", () => {
  it("«  Ana@Example.COM  » → ana@example.com (así el portal encuentra sus citas la teclee como la teclee)", () => {
    assert.equal(normalizeEmail("  Ana@Example.COM  "), "ana@example.com");
  });
  it("ya limpio, se queda igual", () => {
    assert.equal(normalizeEmail("familia@example.com"), "familia@example.com");
  });
  it("vacío, solo espacios, null y undefined → null", () => {
    assert.equal(normalizeEmail(""), null);
    assert.equal(normalizeEmail("   "), null);
    assert.equal(normalizeEmail(null), null);
    assert.equal(normalizeEmail(undefined), null);
  });
  it("no arregla nada por dentro: un espacio en medio se queda, y lo rechaza isValidEmail después", () => {
    const raro = normalizeEmail("ana @example.com");
    assert.equal(raro, "ana @example.com");
    assert.equal(isValidEmail(raro), false);
  });
});

describe("isValidEmail: la forma mínima usuario@dominio.algo", () => {
  it("acepta los correos corrientes: con punto, con más, con guion, con subdominio", () => {
    for (const correo of [
      "ana@example.com",
      "ana.garcia@example.com",
      "ana+citas@example.com",
      "ana-garcia@mi-centro.es",
      "ana@correo.mi-centro.es",
      "a@b.c",
    ]) {
      assert.equal(isValidEmail(correo), true, `${correo} tendría que valer`);
    }
  });
  it("rechaza sin arroba, con dos arrobas, sin punto en el dominio, con espacios, terminado en punto", () => {
    for (const malo of [
      "ana.example.com",
      "ana@@example.com",
      "ana@localhost",
      "ana @example.com",
      "ana@exam ple.com",
      "ana@example.",
      "@example.com",
      "ana@",
    ]) {
      assert.equal(isValidEmail(malo), false, `${malo} no tendría que valer`);
    }
  });
  it("null, undefined, número y vacío no son correos (y no revientan)", () => {
    assert.equal(isValidEmail(null), false);
    assert.equal(isValidEmail(undefined), false);
    assert.equal(isValidEmail(123), false);
    assert.equal(isValidEmail(""), false);
  });
  it("no exige ASCII: un acento en el nombre no tumba la reserva", () => {
    assert.equal(isValidEmail("josé@example.com"), true);
  });
  it("el par que usan los endpoints: normalizeEmail + isValidEmail deja pasar lo tecleado con mayúsculas y espacios alrededor", () => {
    const tecleado = "  Familia.Perez@Gmail.COM ";
    const limpio = normalizeEmail(tecleado);
    assert.equal(limpio, "familia.perez@gmail.com");
    assert.equal(isValidEmail(limpio), true);
  });
});

describe("slugify: del nombre de un tipo de cita a su URL pública", () => {
  it("minúsculas, sin acentos y con guiones: «Sesión Inicial» → sesion-inicial", () => {
    assert.equal(slugify("Sesión Inicial"), "sesion-inicial");
  });
  it("la eñe pierde la virgulilla y los símbolos se vuelven guion: «Año Nuevo & Cía» → ano-nuevo-cia", () => {
    assert.equal(slugify("Año Nuevo & Cía"), "ano-nuevo-cia");
  });
  it("acentos de todo tipo: «Valoración Psicopedagógica (niños)» → valoracion-psicopedagogica-ninos", () => {
    assert.equal(slugify("Valoración Psicopedagógica (niños)"), "valoracion-psicopedagogica-ninos");
  });
  it("una tira de símbolos o espacios es UN guion, y no queda guion al principio ni al final", () => {
    assert.equal(slugify("  --Hola--  mundo--  "), "hola-mundo");
    assert.equal(slugify("Primera   visita"), "primera-visita");
    assert.equal(slugify("¿Consulta online?"), "consulta-online");
  });
  it("los números se quedan: «Bono 10 sesiones» → bono-10-sesiones", () => {
    assert.equal(slugify("Bono 10 sesiones"), "bono-10-sesiones");
  });
  it("se corta a 64 caracteres", () => {
    assert.equal(slugify("a".repeat(70)).length, 64);
    assert.equal(slugify("a".repeat(64)).length, 64);
    assert.equal(slugify("a".repeat(10)).length, 10);
  });
  it("el corte nunca deja el guion colgando: 63 letras y otra palabra no acaban en «-»", () => {
    const cortado = slugify(`${"a".repeat(63)} b`);
    assert.equal(cortado, "a".repeat(63));
    assert.equal(cortado.length, 63);
    assert.equal(isValidSlug(cortado), true);
  });
  it("lo mismo con un nombre largo de verdad: se corta por donde caiga y sigue siendo un slug válido", () => {
    for (const nombre of [
      "Valoración psicopedagógica completa con informe y devolución a la familia",
      `${"palabra ".repeat(12)}final`,
      `${"a".repeat(62)} bc`,
      `${"a".repeat(64)} b`,
      `${"a".repeat(65)} b`,
    ]) {
      const s = slugify(nombre);
      assert.ok(s.length <= 64, `«${s}» pasa de 64`);
      assert.equal(isValidSlug(s), true, `slugify(«${nombre}») = «${s}»`);
    }
  });
  it("los símbolos de cabeza no gastan sitio: se quitan antes del corte", () => {
    assert.equal(slugify(`--${"a".repeat(70)}`).length, 64);
  });
  it("sin nada que rescatar devuelve «» (el endpoint responde «No se pudo generar slug»)", () => {
    assert.equal(slugify(""), "");
    assert.equal(slugify("   "), "");
    assert.equal(slugify("---"), "");
    assert.equal(slugify("😀"), "");
    assert.equal(slugify("¿¡?!"), "");
  });
  it("null y undefined son «», no la palabra «null»: los llamadores pasan por normalizeString, pero esto no depende de ellos", () => {
    assert.equal(slugify(null), "");
    assert.equal(slugify(undefined), "");
  });
  it("un número del body llega como texto: 2026 → «2026»", () => {
    assert.equal(slugify(2026), "2026");
  });
  it("lo que produce con un nombre corriente pasa isValidSlug (es el slug que se guarda sin más)", () => {
    for (const nombre of [
      "Sesión Inicial",
      "Año Nuevo & Cía",
      "Bono 10 sesiones",
      "Primera   visita",
      "Seguimiento nutricional (online)",
    ]) {
      assert.equal(
        isValidSlug(slugify(nombre)),
        true,
        `slugify(«${nombre}») = «${slugify(nombre)}»`
      );
    }
  });
});

describe("isValidSlug: solo a-z, 0-9 y guiones simples por en medio", () => {
  it("acepta: sesion-inicial, primera-visita-2, a, 123", () => {
    for (const bueno of ["sesion-inicial", "primera-visita-2", "a", "123", "bono-10-sesiones"]) {
      assert.equal(isValidSlug(bueno), true, bueno);
    }
  });
  it("rechaza mayúsculas, espacios, acentos, guion bajo, guion al principio o al final, doble guion", () => {
    for (const malo of [
      "Sesion-Inicial",
      "sesion inicial",
      "sesión-inicial",
      "sesion_inicial",
      "-sesion",
      "sesion-",
      "sesion--inicial",
      "",
    ]) {
      assert.equal(isValidSlug(malo), false, `«${malo}» no tendría que valer`);
    }
  });
  it("solo cadenas: null, undefined y número → false", () => {
    assert.equal(isValidSlug(null), false);
    assert.equal(isValidSlug(undefined), false);
    assert.equal(isValidSlug(123), false);
  });
});

describe("isValidHexColor: #rrggbb de seis cifras, y «sin color» vale", () => {
  it("acepta seis cifras en mayúsculas o minúsculas: #FF1F96 (el rosa de Aumenta), #3f6e5b, #0F0F0F", () => {
    assert.equal(isValidHexColor("#FF1F96"), true);
    assert.equal(isValidHexColor("#3f6e5b"), true);
    assert.equal(isValidHexColor("#0F0F0F"), true);
  });
  it("rechaza tres cifras (#fff): el formato es #rrggbb, como dice el error del endpoint", () => {
    assert.equal(isValidHexColor("#fff"), false);
    assert.equal(isValidHexColor("#FFF"), false);
  });
  it("rechaza ocho cifras, sin almohadilla, letras fuera de a-f, espacios alrededor", () => {
    assert.equal(isValidHexColor("#FF1F96AA"), false);
    assert.equal(isValidHexColor("FF1F96"), false);
    assert.equal(isValidHexColor("#GGGGGG"), false);
    assert.equal(isValidHexColor(" #FF1F96"), false);
    assert.equal(isValidHexColor("#FF1F96 "), false);
  });
  it("null y undefined valen: significan «sin color, hereda el de arriba» (blockColor vacío del equipo)", () => {
    assert.equal(isValidHexColor(null), true);
    assert.equal(isValidHexColor(undefined), true);
  });
  it("la cadena vacía no es un color: para decir «ninguno» se manda null (normalizeString / limpiaColorBloqueo lo hacen antes)", () => {
    assert.equal(isValidHexColor(""), false);
  });
});

describe("normalizeModalities: la lista de modalidades limpia, o null si no sirve", () => {
  it("recorta, pasa a minúsculas y quita repetidas conservando el orden", () => {
    assert.deepEqual(normalizeModalities(["Presencial", " online ", "presencial"]), [
      "presencial",
      "online",
    ]);
  });
  it("las tres válidas, en el orden en que llegan", () => {
    assert.deepEqual(normalizeModalities(["online", "phone", "presencial"]), [
      "online",
      "phone",
      "presencial",
    ]);
  });
  it("una sola desconocida tumba la lista entera → null (no se guarda a medias)", () => {
    assert.equal(normalizeModalities(["presencial", "zoom"]), null);
    assert.equal(normalizeModalities(["telefono"]), null);
  });
  it("lista vacía, algo que no es lista, null, o con un elemento que no es texto → null", () => {
    assert.equal(normalizeModalities([]), null);
    assert.equal(normalizeModalities("online"), null);
    assert.equal(normalizeModalities(null), null);
    assert.equal(normalizeModalities(undefined), null);
    assert.equal(normalizeModalities(["online", 3]), null);
  });
});

describe("validateModalityFields: qué hace falta según la modalidad (mensaje de error o null)", () => {
  const sinNada = { location: null, phoneNumber: null, meetUrl: null };
  it("presencial sin dirección: el paciente necesita saber adónde ir desde que reserva", () => {
    const msg = validateModalityFields({ modalities: ["presencial"], ...sinNada });
    assert.equal(typeof msg, "string");
    assert.match(msg, /location/);
  });
  it("teléfono sin número: obligatorio", () => {
    const msg = validateModalityFields({ modalities: ["phone"], ...sinNada });
    assert.equal(typeof msg, "string");
    assert.match(msg, /phoneNumber/);
  });
  it("online sin enlace: null — meetUrl NO es obligatorio (los enlaces de mentira de nutri_laura)", () => {
    assert.equal(validateModalityFields({ modalities: ["online"], ...sinNada }), null);
  });
  it("con lo que pide cada modalidad, null", () => {
    assert.equal(
      validateModalityFields({
        modalities: ["presencial", "phone", "online"],
        location: "Calle Mayor 3",
        phoneNumber: "600000000",
        meetUrl: null,
      }),
      null
    );
  });
  it("devuelve el PRIMER fallo: presencial+phone sin nada habla de location; con dirección, de phoneNumber", () => {
    assert.match(
      validateModalityFields({ modalities: ["presencial", "phone"], ...sinNada }),
      /location/
    );
    assert.match(
      validateModalityFields({
        modalities: ["presencial", "phone"],
        ...sinNada,
        location: "Calle Mayor 3",
      }),
      /phoneNumber/
    );
  });
});

describe("timeToMinutes: HH:MM (o HH:MM:SS) a minutos desde medianoche", () => {
  it("«09:05» → 545, «00:00» → 0, «23:59» → 1439", () => {
    assert.equal(timeToMinutes("09:05"), 545);
    assert.equal(timeToMinutes("00:00"), 0);
    assert.equal(timeToMinutes("23:59"), 1439);
  });
  it("sin ceros a la izquierda también: «9:5» → 545", () => {
    assert.equal(timeToMinutes("9:5"), 545);
  });
  it("con segundos, los ignora: «10:30:15» → 630", () => {
    assert.equal(timeToMinutes("10:30:15"), 630);
  });
  it("fuera de rango → null: «24:00», «10:60», «-1:00», «10:-5»", () => {
    assert.equal(timeToMinutes("24:00"), null);
    assert.equal(timeToMinutes("10:60"), null);
    assert.equal(timeToMinutes("-1:00"), null);
    assert.equal(timeToMinutes("10:-5"), null);
  });
  it("sin las dos partes, vacío, null, letras → null", () => {
    assert.equal(timeToMinutes("10"), null);
    assert.equal(timeToMinutes(""), null);
    assert.equal(timeToMinutes(null), null);
    assert.equal(timeToMinutes(undefined), null);
    assert.equal(timeToMinutes("ab:cd"), null);
    assert.equal(timeToMinutes(":30"), null);
    assert.equal(timeToMinutes("10:"), null);
  });
  it("sirve para comparar tramos: el fin tiene que ser mayor que el inicio", () => {
    assert.ok(timeToMinutes("10:00") < timeToMinutes("10:30"));
    assert.ok(timeToMinutes("09:00:00") < timeToMinutes("14:00:00"));
  });
});

describe("normalizeTime: lo que se guarda es siempre HH:MM:SS", () => {
  it("«9:5» → «09:05:00» y «09:05» → «09:05:00»: pone los ceros que faltan", () => {
    assert.equal(normalizeTime("9:5"), "09:05:00");
    assert.equal(normalizeTime("09:05"), "09:05:00");
  });
  it("los segundos se descartan (los tramos van a minuto): «10:30:15» → «10:30:00»", () => {
    assert.equal(normalizeTime("10:30:15"), "10:30:00");
  });
  it("sin las dos partes, vacío, null, letras → null", () => {
    assert.equal(normalizeTime("10"), null);
    assert.equal(normalizeTime(""), null);
    assert.equal(normalizeTime(null), null);
    assert.equal(normalizeTime(undefined), null);
    assert.equal(normalizeTime("ab:cd"), null);
    assert.equal(normalizeTime(":30"), null);
    assert.equal(normalizeTime("10:"), null);
  });
  it("ida y vuelta: lo normalizado vuelve a leerse con timeToMinutes", () => {
    assert.equal(timeToMinutes(normalizeTime("9:5")), 545);
    assert.equal(timeToMinutes(normalizeTime("17:45")), 1065);
    assert.equal(normalizeTime(normalizeTime("9:5")), "09:05:00");
  });
  it("fuera de rango → null, igual que timeToMinutes (19/08/2026: «24:00» se guardaba como «24:00:00»)", () => {
    assert.equal(normalizeTime("24:00"), null);
    assert.equal(normalizeTime("10:60"), null);
    assert.equal(normalizeTime("99:99"), null);
    assert.equal(normalizeTime("-1:00"), null);
    assert.equal(normalizeTime("23:59"), "23:59:00");
    assert.equal(normalizeTime("00:00"), "00:00:00");
  });
  it("las dos funciones dicen lo mismo de la misma cadena: si una la rechaza, la otra también", () => {
    for (const s of ["24:00", "10:60", "9:5", "23:59", "ab:cd", "10", "", null]) {
      assert.equal(
        normalizeTime(s) === null,
        timeToMinutes(s) === null,
        `discrepan en ${JSON.stringify(s)}`
      );
    }
  });
});
