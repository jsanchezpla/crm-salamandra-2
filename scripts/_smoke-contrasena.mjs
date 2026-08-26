// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-contrasena.mjs — qué contraseña se acepta cuando alguien elige la suya
 * (24/08/2026, reescrita el 26/08/2026 al cambiar las reglas).
 *
 * Estas reglas las miran DOS sitios —el endpoint que la guarda y la pantalla que
 * la pide— y tienen que decir lo mismo, o la pantalla acepta lo que el servidor
 * rechaza. Por eso viven en `lib/auth/contrasena.js` y por eso se prueban aquí.
 *
 * Hoy son TRES: más de siete caracteres, una mayúscula y un número. Y hay una
 * cuarta que no es una política sino un límite de bcrypt: 72 BYTES. Esa es la
 * que más se olvida — bcrypt tira el resto SIN DECIR NADA, así que sin tope dos
 * contraseñas larguísimas que empiecen igual abrirían la misma cuenta.
 *
 * ── LO QUE HUBO ENTRE MEDIAS, PARA QUE NO VUELVA SIN HABLARLO ─────────────
 *
 * Del 19 al 26/08/2026 la función rechazaba además cuatro cosas: el mismo
 * carácter repetido, las tiradas de teclas seguidas, una lista de contraseñas de
 * siempre, y el nombre del centro o del usuario con o sin el año detrás. Se
 * quitaron las cuatro por decisión de producto, y ese mismo día el mínimo bajó
 * de 10 a 5 y volvió a subir a 8 con la mayúscula y el número delante.
 *
 * Aquí se fija lo que se ACEPTA ahora —`Aumenta2026` entre otras— para que si
 * alguien lo vuelve a cerrar sin hablarlo, la prueba se lo diga.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  MINIMO,
  MAXIMO,
  bytesDe,
  largoDe,
  requisitosDe,
  cumpleTodo,
  revisarContrasena,
} from "../lib/auth/contrasena.js";

describe("revisarContrasena: tres reglas y el tope de bcrypt", () => {
  it("una contraseña normal pasa", () => {
    assert.equal(revisarContrasena("El gato de mi vecina 1"), null);
    assert.equal(revisarContrasena("Martes3lluvia"), null);
  });

  it("vacía dice que la escribas, no lo que le falta", () => {
    assert.match(revisarContrasena(""), /Escribe la contraseña/);
  });

  it("sin mayúscula, no", () => {
    assert.match(revisarContrasena("el gato de mi vecina 1"), /mayúscula/);
  });

  it("sin número, no", () => {
    assert.match(revisarContrasena("El gato de mi vecina"), /número/);
  });

  it("corta, no — y el límite es MINIMO justo", () => {
    assert.match(revisarContrasena("Abc123"), new RegExp(`${MINIMO - 1} caracteres`));
    // MINIMO entra, MINIMO-1 no. La base lleva mayúscula y número para que lo
    // único que decida sea el largo.
    const base = "Abc12345678";
    assert.equal(revisarContrasena(base.slice(0, MINIMO)), null);
    assert.match(revisarContrasena(base.slice(0, MINIMO - 1)), /caracteres/);
  });

  it("se dicen TODOS los requisitos que faltan de una vez", () => {
    // Si se dijeran de uno en uno haría falta fallar tres veces para enterarse
    // de las tres reglas.
    const fallo = revisarContrasena("abc");
    assert.match(fallo, /caracteres/);
    assert.match(fallo, /mayúscula/);
    assert.match(fallo, /número/);
  });

  it("la mayúscula y el número cuentan también con tildes y eñes", () => {
    // \p{Lu} y no [A-Z]: «Ñ» y «Á» son mayúsculas y alguien las va a usar.
    assert.equal(revisarContrasena("Ñandu2024"), null);
    assert.equal(revisarContrasena("Árbol1234"), null);
  });

  it("el mínimo se cuenta en caracteres de verdad, no en unidades de JS", () => {
    // Cinco emojis son cinco caracteres para una persona y DIEZ para `.length`,
    // porque cada uno ocupa dos unidades UTF-16. Contando con `.length` colaban
    // el mínimo.
    const cinco = "🐉".repeat(5);
    assert.equal(cinco.length, 10, "en unidades de JS parecen diez");
    assert.equal(largoDe(cinco), 5, "pero son cinco");
    assert.match(revisarContrasena(`A1${cinco}`), /caracteres/);
  });

  it("los espacios NO se recortan: la contraseña es lo que se escribió", () => {
    // Si se hiciera `trim`, se guardaría una distinta de la que la persona
    // escribió y al entrar no valdría. El login tampoco los recorta.
    assert.equal(revisarContrasena("  Hola que tal 1  "), null);
    assert.equal(bytesDe("  hola  "), 8);
  });

  it("por encima de 72 BYTES, no — es el límite real de bcrypt", () => {
    assert.equal(revisarContrasena("A1" + "ab".repeat(MAXIMO / 2 - 1)), null);
    assert.match(revisarContrasena("A1" + "ab".repeat(MAXIMO / 2)), /demasiado larga/);
  });

  it("el tope se mira ANTES que los requisitos", () => {
    // Una larguísima en minúsculas incumple las dos cosas; el aviso que importa
    // es el del tope, porque es el que bcrypt se comería en silencio.
    assert.match(revisarContrasena("a".repeat(MAXIMO + 10)), /demasiado larga/);
  });

  it("se cuenta en bytes y no en letras, que es lo que mira bcrypt", () => {
    /*
     * 20 emojis: 40 en `.length` —porque cada uno son DOS unidades de JS— y 80
     * bytes. O sea que un contador de caracteres los daría por cortos (40 < 72)
     * y bcrypt se comería 8 bytes en silencio.
     */
    const emojis = "🐉".repeat(20);
    assert.equal(emojis.length < MAXIMO, true, "en caracteres parece corta");
    assert.equal(bytesDe(emojis) > MAXIMO, true, "en bytes se pasa");
    assert.match(revisarContrasena(emojis), /demasiado larga/);

    // Y una con tildes que cabe justo: cada tilde ocupa dos.
    assert.equal(bytesDe("Á1" + "áé".repeat(17)), 71);
    assert.equal(revisarContrasena("Á1" + "áé".repeat(17)), null);
    assert.match(revisarContrasena("Á1" + "áé".repeat(18)), /demasiado larga/);
  });

  it("la misma que ya tenías no cuenta como cambiarla", () => {
    assert.match(revisarContrasena("Gato vecina 1", "Gato vecina 1"), /la que ya tenías/);
    assert.equal(revisarContrasena("Gato vecino 2", "Gato vecina 1"), null);
    // Sin la de ahora delante no se puede comparar, y no se inventa nada.
    assert.equal(revisarContrasena("Gato vecina 1"), null);
  });

  it("lo que ANTES se rechazaba, ahora pasa si cumple las tres", () => {
    // El mismo carácter, teclas seguidas y las de cualquier lista de las más
    // usadas: se aceptan a propósito desde el 26/08/2026.
    assert.equal(revisarContrasena("Aaaaaaa1"), null);
    assert.equal(revisarContrasena("Abcdefg1"), null);
    assert.equal(revisarContrasena("Qwertyui1"), null);
    assert.equal(revisarContrasena("Password1"), null);
  });

  it("el nombre del centro y el del usuario también pasan, y se dice a propósito", () => {
    /*
     * ⚠️ Esto es lo que más pesa de lo que se quitó, y por eso tiene su propia
     * prueba: los logins de un cliente son adivinables por construcción
     * (`nombre_aumenta`), así que «Aumenta2026» es literalmente el primer
     * intento de cualquiera que sepa a qué centro está atacando —y el nombre del
     * centro es público, está en su web—.
     *
     * Se acepta porque se decidió aceptarlo, no porque nadie lo mirara.
     */
    assert.equal(revisarContrasena("Aumenta2026", null, { slug: "aumenta" }), null);
    assert.equal(revisarContrasena("Maria2026aumenta", null, { email: "maria_aumenta@aumenta.es" }), null);
  });

  it("email y slug se siguen aceptando y no cambian nada", () => {
    // Tres sitios los pasan. Que sobren no puede hacer que la función falle.
    const con = revisarContrasena("El gato gris 1", null, { email: "x@y.es", slug: "aumenta" });
    const sin = revisarContrasena("El gato gris 1");
    assert.equal(con, sin);
    assert.equal(con, null);
  });
});

describe("requisitosDe: lo que la pantalla pinta es lo que el servidor exige", () => {
  it("con el campo vacío, los tres sin cumplir", () => {
    const r = requisitosDe("");
    assert.equal(r.length, 3);
    assert.deepEqual(r.map((x) => x.cumple), [false, false, false]);
    assert.deepEqual(r.map((x) => x.id), ["largo", "mayuscula", "numero"]);
  });

  it("se van marcando de uno en uno", () => {
    const cumplidos = (t) => requisitosDe(t).filter((x) => x.cumple).map((x) => x.id);
    assert.deepEqual(cumplidos("abcdefgh"), ["largo"]);
    assert.deepEqual(cumplidos("Abcdefgh"), ["largo", "mayuscula"]);
    assert.deepEqual(cumplidos("Abcdefg1"), ["largo", "mayuscula", "numero"]);
  });

  it("cumpleTodo dice lo mismo que revisarContrasena", () => {
    // Es la invariante que impide que el botón se encienda con algo que el
    // servidor va a rechazar, y al revés.
    for (const t of ["", "abc", "abcdefgh", "Abcdefgh", "Abcdefg1", "El gato gris 1", "Ñandu2024"]) {
      assert.equal(
        cumpleTodo(t),
        revisarContrasena(t) === null,
        `«${t}»: la pantalla y el servidor no dicen lo mismo`
      );
    }
  });

  it("el texto de cada requisito lleva el número de verdad", () => {
    // Si MINIMO cambia, la frase cambia sola: no hay un «8» escrito a mano.
    assert.match(requisitosDe("")[0].texto, new RegExp(`${MINIMO - 1}`));
  });

  it("los topes son los que son, y se exportan para que la pantalla los diga", () => {
    assert.equal(MINIMO, 8);
    assert.equal(MAXIMO, 72);
  });
});
