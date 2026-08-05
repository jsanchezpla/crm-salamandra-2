/**
 * _smoke-puerta-identidad.mjs — sin cuenta no se reserva (05/08/2026).
 * Lógica pura, sin base de datos:
 *
 *   node scripts/_smoke-puerta-identidad.mjs
 *
 * Esta puerta nació porque la que había era MENTIRA: el widget enseñaba un
 * cartel de «inicia sesión» que se saltaba escribiendo `?wpa=1` en la URL, y el
 * servidor no comprobaba nada — un POST a /book creaba la cita sin sesión de
 * ninguna clase. Lo que se fija aquí es que el interruptor signifique algo y
 * que siga apagado por defecto, porque encenderlo en un centro sin área privada
 * lo deja sin poder dar una sola cita.
 */

import { exigeIdentidad, urlDeAcceso, mensajeSinIdentidad } from "../lib/citas/puertaIdentidad.js";

let fallos = 0;
function check(etiqueta, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  process.stdout.write(`${ok ? "✓" : "✗"} ${etiqueta}\n`);
  if (!ok) process.stdout.write(`    esperado ${JSON.stringify(esperado)}, salió ${JSON.stringify(real)}\n`);
}

process.stdout.write("\n▶ APAGADA por defecto\n");
check("tenant recién creado", exigeIdentidad({}), false);
check("sin settings", exigeIdentidad(null), false);
check("citas configuradas pero sin la puerta", exigeIdentidad({ settings: { citas: {} } }), false);
check(
  "el interruptor viejo del widget en false no la enciende",
  exigeIdentidad({ settings: { widget: { auth: { required: false } } } }),
  false
);

process.stdout.write("\n▶ Se enciende por cualquiera de los dos interruptores\n");
check("el nuevo", exigeIdentidad({ settings: { citas: { identidadObligatoria: true } } }), true);
check(
  "y el viejo del widget, que antes no servía de nada",
  exigeIdentidad({ settings: { widget: { auth: { required: true } } } }),
  true
);

process.stdout.write("\n▶ A dónde se le manda a iniciar sesión\n");
check(
  "la URL de acceso del widget manda",
  urlDeAcceso({ settings: { widget: { auth: { loginUrl: "https://x.com/login/" } }, citas: { portalUrl: "https://x.com/citas/" } } }),
  "https://x.com/login/"
);
check(
  "si no hay, sirve la del área privada",
  urlDeAcceso({ settings: { citas: { portalUrl: "https://x.com/citas/" } } }),
  "https://x.com/citas/"
);
check("y si no hay ninguna, null", urlDeAcceso({}), null);

process.stdout.write("\n▶ El aviso dice qué hacer, no qué ha fallado\n");
const conUrl = mensajeSinIdentidad({ name: "tunutrilaura", settings: { citas: { portalUrl: "https://tunutrilaura.com/citas/" } } });
check("lleva la dirección donde iniciar sesión", conUrl.includes("https://tunutrilaura.com/citas/"), true);
check("y el nombre del centro", conUrl.includes("tunutrilaura"), true);
check("sin URL configurada sigue siendo una frase útil", mensajeSinIdentidad({}).length > 30, true);
check(
  "nunca dice si un correo existe o no",
  /existe|registrad|no encontrad/i.test(mensajeSinIdentidad({ name: "x" })),
  false
);

process.stdout.write(
  fallos === 0 ? "\n✓ Todo correcto\n\n" : `\n✗ ${fallos} comprobación(es) fallida(s)\n\n`
);
process.exit(fallos === 0 ? 0 : 1);
