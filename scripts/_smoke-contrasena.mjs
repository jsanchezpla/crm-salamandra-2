// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-contrasena.mjs — qué contraseña se acepta cuando alguien elige la suya
 * (24/08/2026).
 *
 * Estas reglas las miran DOS sitios —el endpoint que la guarda y la pantalla que
 * la pide— y tienen que decir lo mismo, o la pantalla acepta lo que el servidor
 * rechaza. Por eso viven en `lib/auth/contrasena.js` y por eso se prueban aquí.
 *
 * La regla de la que más se olvida uno está en el máximo: bcrypt solo mira los
 * primeros 72 BYTES y tira el resto SIN DECIR NADA. Sin tope, dos contraseñas
 * larguísimas que empiecen igual abrirían la misma cuenta.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { MINIMO, MAXIMO, bytesDe, revisarContrasena } from "../lib/auth/contrasena.js";

describe("revisarContrasena: lo único que se exige es que sea larga", () => {
  it("una contraseña normal pasa", () => {
    assert.equal(revisarContrasena("el gato de mi vecina"), null);
    assert.equal(revisarContrasena("las cuatro puertas de la agenda"), null);
  });

  it("no se exigen mayúsculas, números ni símbolos", () => {
    // Todo minúsculas y sin un solo número: vale. Es deliberado — las reglas de
    // composición no hacen la contraseña más difícil de adivinar, la hacen más
    // difícil de recordar, y de ahí sale el papelito pegado al monitor.
    assert.equal(revisarContrasena("pardillo azul"), null);
  });

  it("vacía o corta, no", () => {
    assert.match(revisarContrasena(""), /Escribe la contraseña/);
    assert.match(revisarContrasena("corta"), new RegExp(`${MINIMO} caracteres`));
    // Justo en el límite: MINIMO entra, MINIMO-1 no. Se usan caracteres
    // distintos porque «aaaaaaaaaa» ahora lo rechaza otra regla.
    assert.equal(revisarContrasena("abcxyz1234".slice(0, MINIMO)), null);
    assert.match(revisarContrasena("abcxyz1234".slice(0, MINIMO - 1)), /al menos/);
  });

  it("el mínimo se cuenta en caracteres de verdad, no en unidades de JS", () => {
    // Cinco emojis son cinco caracteres para una persona y DIEZ para `.length`,
    // porque cada uno ocupa dos unidades UTF-16. Contando con `.length` colaban
    // el mínimo de diez.
    const cinco = "🐉".repeat(5);
    assert.equal(cinco.length, 10, "en unidades de JS parecen diez");
    assert.match(revisarContrasena(cinco), /al menos/);
  });

  it("los espacios NO se recortan: la contraseña es lo que se escribió", () => {
    // Si se hiciera `trim`, se guardaría una distinta de la que la persona
    // escribió y al entrar no valdría. El login tampoco los recorta.
    assert.equal(revisarContrasena("  hola que tal  "), null);
    assert.equal(bytesDe("  hola  "), 8);
  });

  it("por encima de 72 BYTES, no — es el límite real de bcrypt", () => {
    assert.equal(revisarContrasena("ab".repeat(MAXIMO / 2)), null);
    assert.match(revisarContrasena("ab".repeat(MAXIMO / 2) + "c"), /demasiado larga/);
  });

  it("se cuenta en bytes y no en letras, que es lo que mira bcrypt", () => {
    /*
     * 20 emojis: 40 en `.length` —porque cada uno son DOS unidades de JS— y 80
     * bytes. O sea que un contador de caracteres los daría por cortos (40 < 72)
     * y bcrypt se comería 8 bytes en silencio.
     *
     * El número está elegido a mano por eso mismo: con 40 emojis la prueba no
     * probaba nada, porque `.length` ya daba 80 y saltaba el límite de largo
     * antes de llegar a contar bytes. Es justo el despiste que esta prueba
     * existe para cazar.
     */
    const emojis = "🐉".repeat(20);
    assert.equal(emojis.length < MAXIMO, true, "en caracteres parece corta");
    assert.equal(bytesDe(emojis) > MAXIMO, true, "en bytes se pasa");
    assert.match(revisarContrasena(emojis), /demasiado larga/);

    // Y una con tildes que cabe justo: cada tilde ocupa dos.
    assert.equal(bytesDe("áé".repeat(18)), 72);
    assert.equal(revisarContrasena("áé".repeat(18)), null);
    assert.match(revisarContrasena("áé".repeat(18) + "í"), /demasiado larga/);
  });

  it("la misma que ya tenías no cuenta como cambiarla", () => {
    assert.match(revisarContrasena("el gato de mi vecina", "el gato de mi vecina"), /la que ya tenías/);
    assert.equal(revisarContrasena("el gato del vecino", "el gato de mi vecina"), null);
    // Sin la de ahora delante no se puede comparar, y no se inventa nada.
    assert.equal(revisarContrasena("el gato de mi vecina"), null);
  });

  /*
   * ── EL SUELO DE ADIVINABILIDAD ────────────────────────────────────────────
   * Lo señaló una revisión adversarial el mismo día de escribirlo, y era la
   * única regresión de seguridad que traía la función: antes la contraseña eran
   * 12 caracteres aleatorios y para adivinarla solo quedaba la fuerza bruta;
   * dejándola SIN suelo, lo que hay al otro lado es «nombre del centro + año».
   *
   * Y eso, contra logins que son adivinables por construcción (`nombre_aumenta`)
   * y un cerrojo que permite unos 2.880 intentos al día por cuenta desde IPs
   * distintas, se acierta. Estas dos primeras pruebas fijaban como VÁLIDAS
   * justo «salamandra24» y «abcdefghijk», que es de lo primero que probaría
   * cualquiera.
   */
  it("el mismo carácter repetido, no", () => {
    assert.match(revisarContrasena("aaaaaaaaaa"), /mismo carácter repetido/);
    assert.match(revisarContrasena(".........."), /mismo carácter repetido/);
  });

  it("las tiradas de teclas seguidas, tampoco — en los dos sentidos", () => {
    assert.match(revisarContrasena("abcdefghijk"), /teclas seguidas/);
    assert.match(revisarContrasena("qwertyuiop"), /teclas seguidas/);
    assert.match(revisarContrasena("9876543210"), /teclas seguidas/);
  });

  it("ni el nombre del centro, ni el del usuario, ni con el año detrás", () => {
    // Añadir el año no convierte el nombre del centro en una contraseña, y el
    // nombre del centro es público: está en su web.
    assert.match(revisarContrasena("aumenta2026", null, { slug: "aumenta" }), /se adivina/);
    assert.match(revisarContrasena("Aumenta-2026", null, { slug: "aumenta" }), /se adivina/);
    assert.match(
      revisarContrasena("maria_aumenta1", null, { email: "maria_aumenta@aumenta.es" }),
      /se adivina/
    );
    // Solo la parte de delante del correo: el dominio lo comparten todos, y
    // prohibirlo dejaría fuera cualquier frase que lo contenga por casualidad.
    assert.equal(revisarContrasena("el gato de mi vecina", null, { slug: "aumenta" }), null);
  });

  it("las de siempre, tampoco", () => {
    assert.match(revisarContrasena("contrasena123"), /se adivina/);
    assert.match(revisarContrasena("administrador"), /se adivina/);
  });

  it("sin saber el centro ni el correo, se comprueba lo que se pueda", () => {
    // El endpoint SIEMPRE los pasa, pero la función no puede dar por hecho que
    // están: sin ellos hace las otras tres comprobaciones y no se inventa nada.
    assert.equal(revisarContrasena("el gato de mi vecina"), null);
    assert.match(revisarContrasena("aaaaaaaaaa"), /repetido/);
  });

  it("los topes son los que son, y se exportan para que la pantalla los diga", () => {
    // La pantalla los enseña ANTES de que nadie escriba nada. Si cambian aquí,
    // cambian allí solos.
    assert.equal(MINIMO, 10);
    assert.equal(MAXIMO, 72);
  });
});
