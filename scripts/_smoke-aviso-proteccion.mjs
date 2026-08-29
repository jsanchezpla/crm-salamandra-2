// @prueba ligera — función pura de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-aviso-proteccion.mjs — cuál de los dos avisos legales lleva un informe
 * (29/08/2026).
 *
 *   node scripts/_smoke-aviso-proteccion.mjs
 *
 * ── QUÉ SE ESTÁ PROTEGIENDO ────────────────────────────────────────────────
 * Al pedirle a Aumenta su texto de protección de datos resultó que tienen DOS,
 * y no son intercambiables: el de un menor habla de «los datos del menor», de
 * la autorización del padre/madre/tutor, y termina diciendo que el informe debe
 * quedar «en poder de los padres/tutor legal». Imprimirle eso a un adulto —y
 * Aumenta atiende adultos: neuropsicología, estimulación cognitiva— es decirle
 * por escrito, en un documento sanitario, que su informe lo guardan sus padres.
 *
 * Lo que se fija aquí:
 *
 *   1. **Quien no tenga dos textos no nota nada.** Sin aviso de adultos se usa
 *      siempre el de siempre, que es lo que hacía el generador antes de que
 *      esta elección existiera.
 *   2. **La edad es la de la FECHA DEL INFORME, no la de hoy.** Un informe de
 *      cuando el paciente tenía 16 años, reimpreso cuando ya tiene 20, sigue
 *      siendo el informe de un menor y lleva el aviso que le tocaba. Si se
 *      mirase la edad de hoy, el mismo PDF cambiaría de texto legal con el paso
 *      del tiempo.
 *   3. **El corte son los 18 cumplidos**, y el día del cumpleaños ya cuenta.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { avisoDeProteccion } from "../lib/clinica/reportPdf.js";

const MENORES = "Aviso de menores: el informe queda en poder de los padres o tutor legal.";
const ADULTOS = "Aviso de adultos: el informe queda en su poder.";
const CENTRO = { proteccionDatos: MENORES, proteccionDatosAdultos: ADULTOS };

describe("sin segundo texto, nada cambia", () => {
  it("un centro con un solo aviso lo usa siempre, tenga el paciente la edad que tenga", () => {
    const centro = { proteccionDatos: MENORES, proteccionDatosAdultos: "" };
    assert.equal(avisoDeProteccion(centro, { nacimiento: "1980-01-01", fechaInforme: "2026-09-01" }), MENORES);
    assert.equal(avisoDeProteccion(centro, { nacimiento: "2020-01-01", fechaInforme: "2026-09-01" }), MENORES);
  });

  it("un centro sin ningún aviso no imprime nada", () => {
    assert.equal(avisoDeProteccion({}, { nacimiento: "1980-01-01", fechaInforme: "2026-09-01" }), "");
    assert.equal(avisoDeProteccion(null), "");
  });
});

describe("con los dos textos, manda la edad en la fecha del informe", () => {
  it("un niño lleva el de menores", () => {
    assert.equal(avisoDeProteccion(CENTRO, { nacimiento: "2019-11-02", fechaInforme: "2026-09-07" }), MENORES);
  });

  it("un adulto lleva el de adultos", () => {
    assert.equal(avisoDeProteccion(CENTRO, { nacimiento: "1984-12-16", fechaInforme: "2026-09-01" }), ADULTOS);
  });

  it("el día que cumple 18 ya es adulto", () => {
    assert.equal(avisoDeProteccion(CENTRO, { nacimiento: "2008-09-01", fechaInforme: "2026-09-01" }), ADULTOS);
  });

  it("el día antes de cumplir 18 todavía no", () => {
    assert.equal(avisoDeProteccion(CENTRO, { nacimiento: "2008-09-02", fechaInforme: "2026-09-01" }), MENORES);
  });

  it("un informe viejo de quien hoy ya es mayor sigue llevando el de menores", () => {
    // Nació en 2006; el informe es de 2022, cuando tenía 16. Hoy tiene 20.
    assert.equal(avisoDeProteccion(CENTRO, { nacimiento: "2006-05-10", fechaInforme: "2022-06-01" }), MENORES);
    // Y el mismo paciente, en un informe de ahora, sí es adulto.
    assert.equal(avisoDeProteccion(CENTRO, { nacimiento: "2006-05-10", fechaInforme: "2026-06-01" }), ADULTOS);
  });
});

describe("lo que falta o viene torcido cae del lado seguro", () => {
  it("sin fecha de nacimiento se usa el de siempre", () => {
    assert.equal(avisoDeProteccion(CENTRO, { fechaInforme: "2026-09-01" }), MENORES);
    assert.equal(avisoDeProteccion(CENTRO, {}), MENORES);
  });

  it("una fecha inservible no revienta ni cambia el texto", () => {
    assert.equal(avisoDeProteccion(CENTRO, { nacimiento: "no es una fecha", fechaInforme: "2026-09-01" }), MENORES);
    assert.equal(avisoDeProteccion(CENTRO, { nacimiento: "1984-12-16", fechaInforme: "tampoco" }), MENORES);
  });
});
