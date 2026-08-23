// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.

/**
 * _smoke-config-pestanas.mjs — el reparto de la pantalla de Configuración.
 *
 * POR QUÉ EXISTE. La pantalla se repartió en pestañas el 23/08/2026 porque
 * eran 28 tarjetas en una columna y la clave de Anthropic acababa pegada a los
 * botones de la agenda. Al repartirla aparecen dos formas nuevas de
 * equivocarse, y las dos son silenciosas:
 *
 *   1. **Una tarjeta que se cae del mapa.** Si una queda sin pestaña, o con
 *      una que no existe, deja de pintarse: no hay error, simplemente ya no
 *      está, y nadie lo nota hasta que alguien va a cambiar algo y no lo
 *      encuentra. Aquí se comprueba que todas caen en una pestaña de verdad y
 *      que ninguna pestaña se queda vacía.
 *
 *   2. **Un aviso que miente.** El aviso «necesita el módulo X» manda a alguien
 *      a pedir algo, así que decirle que le falta un módulo QUE YA TIENE es
 *      peor que no avisar. Se fija que el aviso solo sale cuando falta de
 *      verdad, que un módulo alternativo basta (las derivaciones valen con
 *      Clínica **o** Pacientes) y que sin saber los módulos no se avisa nada.
 *
 * Y una tercera, que es la que motivó verificar los `requiere` uno a uno: las
 * dependencias NO son las que parecen. Stripe cuelga de Citas y no de
 * Facturación, y Whisper solo lo usa Clínica. Eso queda escrito abajo para que
 * cambiarlo tenga que ser a propósito.
 *
 * Uso:  node scripts/_smoke-config-pestanas.mjs
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PESTANAS,
  PESTANA_POR_DEFECTO,
  TARJETAS,
  NOMBRE_MODULO,
  avisoDePestana,
  avisoDeTarjeta,
  esPestanaValida,
  tarjetasDe,
} from "../lib/configuracion/pestanas.js";

/** Un tenant con estos módulos y ninguno más. */
const con = (...modulos) => {
  const s = new Set(modulos);
  return (k) => s.has(k);
};
const sinNada = con();
const conTodo = () => true;

test("el reparto: ninguna tarjeta se cae y ninguna pestaña se queda vacía", async (t) => {
  const claves = PESTANAS.map((p) => p.clave);

  await t.test("las seis pestañas tienen clave única y título", () => {
    assert.equal(claves.length, new Set(claves).size, "hay claves repetidas");
    for (const p of PESTANAS) {
      assert.ok(p.titulo?.trim(), `la pestaña ${p.clave} no tiene título`);
      assert.ok(p.resumen?.trim(), `la pestaña ${p.clave} no tiene resumen`);
    }
  });

  await t.test("toda tarjeta cae en una pestaña que existe", () => {
    for (const [clave, tarjeta] of Object.entries(TARJETAS)) {
      assert.ok(
        claves.includes(tarjeta.pestana),
        `la tarjeta ${clave} apunta a la pestaña "${tarjeta.pestana}", que no existe`
      );
    }
  });

  await t.test("ninguna pestaña se queda sin tarjetas", () => {
    for (const clave of claves) {
      assert.ok(tarjetasDe(clave).length > 0, `la pestaña ${clave} no tiene ni una tarjeta`);
    }
  });

  await t.test("todas las tarjetas están repartidas: la suma cuadra", () => {
    const repartidas = claves.flatMap((c) => tarjetasDe(c));
    assert.equal(repartidas.length, Object.keys(TARJETAS).length);
    assert.equal(repartidas.length, new Set(repartidas).size, "una tarjeta está en dos pestañas");
  });

  await t.test("la pestaña por defecto es una de verdad, y es la primera", () => {
    assert.ok(esPestanaValida(PESTANA_POR_DEFECTO));
    assert.equal(PESTANA_POR_DEFECTO, claves[0]);
  });

  await t.test("lo que llegue por la URL se valida: cualquier cosa rara es falsa", () => {
    assert.equal(esPestanaValida("empresa"), true);
    for (const basura of ["", null, undefined, "EMPRESA", "no-existe", 7, {}]) {
      assert.equal(esPestanaValida(basura), false, `«${String(basura)}» ha pasado por válida`);
    }
  });

  await t.test("cada `requiere` nombra módulos que sabemos traducir", () => {
    for (const [clave, tarjeta] of Object.entries(TARJETAS)) {
      if (!tarjeta.requiere) continue;
      assert.ok(Array.isArray(tarjeta.requiere) && tarjeta.requiere.length, `${clave}: requiere vacío`);
      for (const m of tarjeta.requiere) {
        assert.ok(NOMBRE_MODULO[m], `${clave} exige "${m}" y no está en NOMBRE_MODULO: el aviso saldría en inglés`);
      }
    }
  });
});

test("el aviso: solo cuando falta de verdad", async (t) => {
  await t.test("con todos los módulos, ninguna tarjeta avisa", () => {
    for (const clave of Object.keys(TARJETAS)) {
      assert.equal(avisoDeTarjeta(clave, conTodo), null, `${clave} avisa teniéndolo todo`);
    }
  });

  await t.test("sin ningún módulo, avisan todas menos las universales y las que se esconden", () => {
    for (const [clave, tarjeta] of Object.entries(TARJETAS)) {
      const aviso = avisoDeTarjeta(clave, sinNada);
      if (tarjeta.requiere && !tarjeta.seEsconde) assert.ok(aviso, `${clave} debería avisar y no avisa`);
      else assert.equal(aviso, null, `${clave} no debe avisar nunca`);
    }
  });

  await t.test("una tarjeta que se esconde sola NUNCA se anota", () => {
    // Lo cazó la primera captura del reparto: `CompanyDescriptionSection` y
    // `DerivacionesCard` devuelven null cuando su endpoint responde 403, así
    // que el aviso salía flotando solo, sin nada debajo.
    for (const clave of ["descripcionEmpresa", "derivaciones", "fiscal"]) {
      assert.equal(TARJETAS[clave].seEsconde, true, `${clave} debería estar marcada como que se esconde`);
      assert.equal(avisoDeTarjeta(clave, sinNada), null, `${clave} ha dejado un aviso huérfano`);
    }
  });

  await t.test("el aviso dice el nombre en cristiano, no el moduleKey", () => {
    const aviso = avisoDeTarjeta("cloudflare", sinNada);
    assert.match(aviso, /Analíticas/);
    assert.doesNotMatch(aviso, /analytics/);
  });

  await t.test("y deja claro que se puede rellenar igual (regla #14)", () => {
    // Si el aviso sonara a prohibición, alguien dejaría de pegar su clave hasta
    // contratar el módulo — y la Configuración es universal a propósito.
    assert.match(avisoDeTarjeta("stripe", sinNada), /puedes dejarlo puesto igual/i);
  });

  await t.test("las derivaciones declaran los dos módulos, aunque hoy no lleguen a anotarse", () => {
    // Su endpoint acepta `clinica` O `pacientes`, y así queda escrito. No sale
    // aviso porque la tarjeta se esconde sola (403 → null), pero la declaración
    // es lo que hay que respetar el día que deje de esconderse.
    assert.deepEqual(TARJETAS.derivaciones.requiere, ["clinica", "pacientes"]);
    for (const t of [con("clinica"), con("pacientes"), con("citas"), sinNada]) {
      assert.equal(avisoDeTarjeta("derivaciones", t), null);
    }
  });

  await t.test("sin saber los módulos NO se avisa: un aviso falso es peor que ninguno", () => {
    // Pasa si la consulta de módulos falla: la página degrada a «no sé».
    for (const nada of [undefined, null, "todos", 1]) {
      assert.equal(avisoDeTarjeta("stripe", nada), null, `con tieneModulo=${String(nada)} ha avisado`);
    }
  });

  await t.test("una tarjeta que no existe no revienta ni inventa aviso", () => {
    assert.equal(avisoDeTarjeta("no_existe", sinNada), null);
    assert.equal(avisoDeTarjeta(undefined, sinNada), null);
  });
});

test("el aviso de pestaña: una vez arriba en vez de cinco veces dentro", async (t) => {
  await t.test("«Agenda» entera cuelga de Citas: un solo aviso", () => {
    const aviso = avisoDePestana("agenda", sinNada);
    assert.ok(aviso, "sin Citas, Agenda debería avisar una vez");
    assert.match(aviso, /Citas/);
    // Y que de verdad lo pedían todas, no que se haya colado una universal.
    for (const c of tarjetasDe("agenda")) assert.deepEqual(TARJETAS[c].requiere, ["citas"]);
  });

  await t.test("con el módulo puesto, ni aviso de pestaña ni de tarjeta", () => {
    assert.equal(avisoDePestana("agenda", con("citas")), null);
    assert.equal(avisoDePestana("portal", con("citas")), null);
  });

  await t.test("si dentro hay mezcla, NO se resume arriba: cada tarjeta se explica sola", () => {
    // «Reserva online» es casi toda de Citas, pero la puerta de admisión pide
    // Formularios: resumirla arriba se comería justo el caso raro.
    assert.equal(avisoDePestana("reservas", sinNada), null);
    assert.ok(avisoDeTarjeta("puertaAdmision", sinNada));
  });

  await t.test("una pestaña con alguna tarjeta universal nunca se resume entera", () => {
    // Conexiones lleva Anthropic y WhatsApp, que valen siempre.
    assert.equal(avisoDePestana("conexiones", sinNada), null);
    // Módulos lleva los permisos de IA, universales.
    assert.equal(avisoDePestana("modulos", sinNada), null);
  });

  await t.test("sin saber los módulos tampoco se resume", () => {
    assert.equal(avisoDePestana("agenda", null), null);
  });
});

test("la pantalla monta lo que el mapa declara, y nada más", async (t) => {
  // Esto SÍ es una regex sobre el código fuente, y es de las que valen la pena:
  // el reparto en pestañas (23/08/2026) se hizo moviendo 27 bloques de sitio, y
  // la forma de equivocarse ahí es perder uno o dejarlo duplicado. No hay
  // pantalla en blanco ni error: la tarjeta simplemente ya no está.
  const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
  const fuente = readFileSync(join(RAIZ, "modules/config/ConfigModule.jsx"), "utf8");
  const montadas = [...fuente.matchAll(/enZona\(\s*"([A-Za-z]+)"/g)].map((m) => m[1]);

  await t.test("cada tarjeta del mapa se monta EXACTAMENTE una vez", () => {
    for (const clave of Object.keys(TARJETAS)) {
      const veces = montadas.filter((m) => m === clave).length;
      assert.equal(veces, 1, `la tarjeta ${clave} se monta ${veces} veces (debería ser 1)`);
    }
  });

  await t.test("y no se monta ninguna que el mapa no conozca", () => {
    for (const m of montadas) {
      assert.ok(TARJETAS[m], `la pantalla monta "${m}", que no está en TARJETAS: no tendría pestaña`);
    }
  });

  await t.test("las seis zonas están escritas en el componente", () => {
    for (const p of PESTANAS) {
      assert.ok(
        fuente.includes(`pestana === "${p.clave}"`),
        `la zona ${p.clave} existe en el mapa pero no se pinta en ConfigModule`
      );
    }
  });
});

test("las dependencias que NO son las que parecen", async (t) => {
  // Las cuatro se verificaron contra quien LEE la credencial. Si alguien las
  // cambia por intuición, esto se pone rojo y le manda a mirar el consumidor.

  await t.test("Stripe cuelga de CITAS, no de Facturación", () => {
    // docs/modules/pagos.md: «sin moduleKey propio: cuelga de citas … No es
    // billing: no reutiliza Payment ni genera factura».
    assert.deepEqual(TARJETAS.stripe.requiere, ["citas"]);
    assert.ok(avisoDeTarjeta("stripe", con("billing")), "con Facturación a secas, cobrar online no funciona: tiene que avisar");
    assert.equal(avisoDeTarjeta("stripe", con("citas")), null);
  });

  await t.test("Whisper (OpenAI) solo lo usa Clínica", () => {
    // Único consumidor: app/api/clinica/sessions/transcribe.
    assert.deepEqual(TARJETAS.openai.requiere, ["clinica"]);
    assert.equal(avisoDeTarjeta("openai", con("clinica")), null);
    assert.ok(avisoDeTarjeta("openai", con("nutricion", "citas", "billing")));
  });

  await t.test("Anthropic y WhatsApp son universales y no avisan nunca", () => {
    // Anthropic lo leen ocho endpoints de seis módulos; WhatsApp no es un
    // módulo sino una integración universal (regla #14).
    assert.equal(TARJETAS.anthropic.requiere, null);
    assert.equal(TARJETAS.whatsapp.requiere, null);
    assert.equal(avisoDeTarjeta("anthropic", sinNada), null);
    assert.equal(avisoDeTarjeta("whatsapp", sinNada), null);
  });

  await t.test("la puerta de admisión depende de FORMULARIOS, no de Citas", () => {
    // lib/citas/puertaFormulario.js: exigir el formulario antes de reservar
    // solo tiene efecto si hay bandeja donde caiga.
    assert.deepEqual(TARJETAS.puertaAdmision.requiere, ["formularios"]);
    assert.ok(avisoDeTarjeta("puertaAdmision", con("citas")), "con Citas a secas no tiene efecto: tiene que avisar");
    assert.equal(avisoDeTarjeta("puertaAdmision", con("formularios")), null);
  });
});
