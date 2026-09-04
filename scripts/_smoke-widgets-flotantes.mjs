// @prueba ligera — lee ficheros del repo; sin base, sin servidor, sin .env.
/**
 * _smoke-widgets-flotantes.mjs — dónde viven la campana y el Salamandrobot, y
 * por qué sus desplegables se esconden tras un panel.
 *
 *   node scripts/_smoke-widgets-flotantes.mjs
 *
 * ── DE QUÉ FALLOS REALES NACE ──────────────────────────────────────────────
 *
 * 1. Del 02/08 al 03/09/2026 los dos estuvieron ocultos para TODO EL MUNDO en
 *    TODAS las pantallas, y nadie lo vio porque simplemente no estaban. La
 *    regla de `app/globals.css` que los esconde mientras hay un panel abierto
 *    detectaba también el fondo del menú móvil, que está siempre en el DOM y
 *    cerrado solo se apaga con `opacity-0`.
 * 2. Y el motivo por el que aquel commit los había movido seguía ahí:
 *    flotando abajo a la derecha se ponen delante de los botones de los
 *    paneles. Rodrigo, 04/09/2026: «se ubican a veces delante de botones, así
 *    que lo que vamos a hacer va a ser ponerlos debajo del nombre de usuario
 *    de cada persona junto a los iconitos de ayuda, la llave inglesa, la
 *    configuración y salir. Y así quedan estéticos y no molestan».
 *
 * Así que hoy los BOTONES viven en el pie del menú y solo sus DESPLEGABLES
 * flotan, por un portal a <body>. Es texto (clases de Tailwind y una regla
 * CSS), así que se fija con regex sobre el código, que es para lo que
 * CLAUDE.md las reserva: si alguien los devuelve a la esquina, quita el
 * `:not(.opacity-0)` de la regla o el `opacity-0` del fondo del menú, esto lo
 * dice antes de que vuelvan a molestar o a desaparecer.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const leer = (ruta) => readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");
const css = leer("app/globals.css");
const sidebar = leer("components/layout/Sidebar.jsx");
const shell = leer("components/layout/DashboardShell.jsx");
const campana = leer("components/layout/NotificationBell.jsx");
const bot = leer("components/assistant/Salamandrobot.jsx");

test("la regla que esconde los desplegables tras un panel ignora los fondos apagados con opacity-0", () => {
  const inicio = css.indexOf("body:has(");
  const fin = css.indexOf("}", inicio);
  assert.ok(inicio > -1 && fin > inicio, "la regla .crm-flotante sigue en globals.css");
  const bloque = css.slice(inicio, fin);
  assert.match(bloque, /display:\s*none/);
  const selectores = bloque.slice(0, bloque.indexOf("{")).split(",").map((s) => s.trim());
  assert.equal(selectores.length, 3, "un selector por capa: z-40, z-50 y z-[…]");
  for (const sel of selectores) {
    // Cuelga del BODY y no de .dashboard-shell: los desplegables se van fuera
    // de esa shell por un portal, y desde dentro `:has()` no los alcanzaría.
    assert.ok(sel.startsWith("body:has(.fixed.inset-0"), sel);
    assert.ok(sel.includes(":not(.opacity-0)"), `sin :not(.opacity-0) el fondo apagado del menú móvil los esconde siempre: ${sel}`);
    assert.ok(sel.endsWith(".crm-flotante"), sel);
  }
  assert.ok(selectores.some((s) => s.includes(".z-40:not")), "el fondo z-40 de los paneles laterales (regla 13)");
  assert.ok(selectores.some((s) => s.includes(".z-50:not")), "el panel z-50 y los modales");
  assert.ok(selectores.some((s) => s.includes('[class*="z-["]:not')), "los z-[60..90] puntuales");
});

test("los desplegables suben lo que la barra del navegador tape (100vh frente a 100dvh, AV-0035)", () => {
  // Misma causa que `.alto-ventana`: donde 100vh mide más que el hueco visible,
  // lo anclado abajo cae detrás de la barra. Se sube la diferencia, que en un
  // navegador normal es 0. Si alguien quita esto, Blanca vuelve a ver medio panel.
  const inicio = css.indexOf(".crm-flotante.fixed");
  assert.ok(inicio > -1, "la regla .crm-flotante.fixed sigue en globals.css");
  const bloque = css.slice(inicio, css.indexOf("}", inicio));
  assert.match(bloque, /transform:\s*translateY\(calc\(100dvh - 100vh\)\)/, "sube exactamente lo que tapa la barra");
  const antes = css.slice(Math.max(0, inicio - 60), inicio);
  assert.match(antes, /@supports \(height: 100dvh\)/, "solo donde el navegador entiende dvh; si no, calc daría error y la regla entera se descartaría igual");
});

test("el fondo del menú móvil sigue siempre en el DOM y cerrado se apaga con opacity-0", () => {
  assert.match(sidebar, /lg:hidden fixed inset-0 [^`]*z-40/, "el fondo del menú móvil es fixed inset-0 z-40");
  assert.match(sidebar, /mobileOpen \? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"/, "cerrado lleva opacity-0, que es lo que lee la regla");
});

test("la campana y el Salamandrobot son dos iconos del pie del menú, no dos botones flotantes", () => {
  // Ya NO se montan en la shell: si vuelven ahí, vuelven a flotar sobre el
  // contenido y a taparle el Guardar a los 69 paneles del CRM.
  assert.doesNotMatch(shell, /<NotificationBell/, "la campana ya no se monta en DashboardShell");
  assert.doesNotMatch(shell, /<Salamandrobot/, "el Salamandrobot ya no se monta en DashboardShell");

  assert.match(sidebar, /<NotificationBell alAbrir=\{onClose\} \/>/, "la campana se monta en el menú, y abrirla cierra el cajón del móvil");
  assert.match(sidebar, /<Salamandrobot alAbrir=\{onClose\} \/>/, "el Salamandrobot igual");

  // En la MISMA fila que ayuda · soporte · configuración · salir, y delante,
  // para no mover de sitio a los cuatro de siempre.
  const fila = sidebar.slice(sidebar.indexOf('<div className="flex items-center justify-end gap-1 mt-1.5">'));
  const orden = ["<NotificationBell", "<Salamandrobot", 'href="/ayuda"', 'href="/soporte"', 'href="/configuracion"', "handleLogout"];
  let desde = 0;
  for (const trozo of orden) {
    const donde = fila.indexOf(trozo, desde);
    assert.ok(donde > -1, `${trozo} sigue en la fila de iconos del pie`);
    desde = donde;
  }
});

test("sus botones no llevan posición fija y sus desplegables salen por un portal a <body>", () => {
  for (const [nombre, fuente] of [["la campana", campana], ["el Salamandrobot", bot]]) {
    assert.doesNotMatch(fuente, /crm-flotante fixed[^"]*right-4/, `${nombre} ya no se ancla a la esquina`);
    assert.match(fuente, /import \{ createPortal \} from "react-dom"/, `${nombre} manda su panel a <body>`);
    assert.match(fuente, /createPortal\(/, `${nombre} usa el portal`);
    assert.match(fuente, /document\.body\s*\)/, `${nombre} lo cuelga del body y no de la shell`);
    // El panel sigue siendo `crm-flotante`, que es lo que lee la regla de arriba.
    assert.match(fuente, /className="crm-flotante fixed z-30 bottom-3 left-3 right-3 sm:right-auto/, `el panel de ${nombre} se ancla abajo a la izquierda`);
    assert.match(fuente, /lg:left-\[232px\]/, `en escritorio el panel de ${nombre} sale al lado del menú (220 px + 12)`);
    assert.match(fuente, /alAbrir\?\.\(\)/, `${nombre} cierra el cajón del móvil al abrirse, o su propio fondo z-40 lo escondería`);
  }
});
