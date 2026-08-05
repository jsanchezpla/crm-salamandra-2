/**
 * _smoke-datos-antes-de-firmar.mjs — qué se exige en la pantalla de datos
 * (05/08/2026). Lógica pura, sin base de datos:
 *
 *   node scripts/_smoke-datos-antes-de-firmar.mjs
 *
 * EL BUG QUE FIJA. La pantalla «Completa tus datos» exigía TODOS los campos, y
 * colaba mientras solo pedía la fecha de nacimiento. Al juntar ahí el DNI y el
 * domicilio —para quitar una pantalla del recorrido— se convertía en una
 * trampa: los MENORES DE 14 no tienen DNI obligatorio, así que una paciente de
 * 12 se quedaba con el botón apagado pidiéndole un documento que no tiene, sin
 * poder firmar ni pedir cita. Es la misma familia de fallo que ya habían
 * sufrido antes al pedir el DNI en la reserva.
 *
 * Lo que se fija aquí es que la obligatoriedad se calcule con la fecha que se
 * ESTÁ ESCRIBIENDO, no solo con la que ya está guardada — y que pantalla y
 * servidor hagan la misma cuenta.
 */

import { campoEsObligatorio } from "../lib/clients/datosFicha.js";
import { validarDatos } from "../lib/clients/contratoFirma.js";

let fallos = 0;
function check(etiqueta, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  process.stdout.write(`${ok ? "✓" : "✗"} ${etiqueta}\n`);
  if (!ok) process.stdout.write(`    esperado ${JSON.stringify(esperado)}, salió ${JSON.stringify(real)}\n`);
}

const DNI = { key: "dni", label: "DNI / NIE", type: "dni", ficha: "cliente.taxId", required: true, requiredDesdeEdad: 14 };
const FECHA = { key: "fechaNacimiento", label: "Fecha de nacimiento", type: "date", ficha: "cliente.birthDate", required: true };
const DOMICILIO = { key: "domicilio", label: "Domicilio", type: "text", ficha: "cliente.customFields.domicilio", required: true };

// Fechas relativas a hoy para que la prueba no caduque con los años.
const haceAnios = (n) => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - n);
  return d.toISOString().slice(0, 10);
};
const MENOR = haceAnios(12);
const MAYOR = haceAnios(30);

process.stdout.write("\n▶ El DNI depende de la edad\n");
check("una adulta SÍ tiene que darlo", campoEsObligatorio(DNI, MAYOR), true);
check("una menor de 14 NO", campoEsObligatorio(DNI, MENOR), false);
check("justo con 14 recién cumplidos, sí", campoEsObligatorio(DNI, haceAnios(14)), true);
check("sin fecha se exige (es el lado que no deja pasar de más)", campoEsObligatorio(DNI, null), true);

process.stdout.write("\n▶ El domicilio no depende de la edad: lo da todo el mundo\n");
check("menor", campoEsObligatorio(DOMICILIO, MENOR), true);
check("adulta", campoEsObligatorio(DOMICILIO, MAYOR), true);

process.stdout.write("\n▶ El servidor usa la fecha que ACABA de escribir, no la guardada\n");
const plantilla = { fields: [FECHA, DNI, DOMICILIO] };

const menorSinDni = validarDatos(plantilla, { fechaNacimiento: MENOR, domicilio: "Calle Falsa 123" }, null);
check("menor sin DNI y sin ficha previa → pasa", !menorSinDni.error, true);
check("y no se inventa un DNI", menorSinDni.datos?.dni, undefined);

const adultaSinDni = validarDatos(plantilla, { fechaNacimiento: MAYOR, domicilio: "Calle Falsa 123" }, null);
check("adulta sin DNI → se le pide", typeof adultaSinDni.error === "string", true);

process.stdout.write("\n▶ Y si la fecha ya estaba en la ficha, también vale\n");
const conFicha = validarDatos({ fields: [DNI, DOMICILIO] }, { domicilio: "Calle Falsa 123" }, { birthDate: MENOR });
check("menor cuya fecha ya constaba → pasa sin DNI", !conFicha.error, true);

process.stdout.write("\n▶ El domicilio no se lo salta nadie\n");
const sinDomicilio = validarDatos(plantilla, { fechaNacimiento: MENOR }, null);
check("falta el domicilio → se corta", typeof sinDomicilio.error === "string", true);

process.stdout.write(
  fallos === 0 ? "\n✓ Todo correcto\n\n" : `\n✗ ${fallos} comprobación(es) fallida(s)\n\n`
);
process.exit(fallos === 0 ? 0 : 1);
