// @prueba ligera — lee ficheros del repo; sin base, sin servidor, sin .env.
/**
 * _smoke-widgets-flotantes.mjs — la campana y el Salamandrobot se ven, abajo a
 * la derecha, y solo se esconden mientras hay un panel abierto (03/09/2026).
 *
 *   node scripts/_smoke-widgets-flotantes.mjs
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 *
 * Del 02/08 al 03/09/2026 la campana de notificaciones y el Salamandrobot
 * estuvieron ocultos para TODO EL MUNDO en TODAS las pantallas, y nadie lo vio
 * porque simplemente no estaban. La regla de `app/globals.css` que los esconde
 * mientras hay un panel abierto —`.dashboard-shell:has(.fixed.inset-0.z-40)
 * .crm-flotante { display: none }`— detectaba también el fondo del menú móvil
 * (`Sidebar.jsx`), que está siempre en el DOM y cerrado solo se apaga con
 * `opacity-0`. Rodrigo (03/09/2026): «la campana debería salir abajo a la
 * derecha; creo que está oculta ahora mismo para todo el mundo; igual que el
 * Salamandrobot; los dos se esconden siempre que se abre un modal o una vista
 * lateral».
 *
 * Es texto (clases de Tailwind y una regla CSS), así que se fija con regex
 * sobre el código, que es para lo que CLAUDE.md las reserva: si alguien quita
 * el `:not(.opacity-0)` de la regla, el `opacity-0` del fondo del menú o vuelve
 * a subir los widgets arriba, esto lo dice antes de que desaparezcan otra vez.
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

test("la regla que esconde los widgets tras un panel ignora los fondos apagados con opacity-0", () => {
  const inicio = css.indexOf(".dashboard-shell:has(");
  const fin = css.indexOf("}", inicio);
  assert.ok(inicio > -1 && fin > inicio, "la regla .crm-flotante sigue en globals.css");
  const bloque = css.slice(inicio, fin);
  assert.match(bloque, /display:\s*none/);
  const selectores = bloque.slice(0, bloque.indexOf("{")).split(",").map((s) => s.trim());
  assert.equal(selectores.length, 3, "un selector por capa: z-40, z-50 y z-[…]");
  for (const sel of selectores) {
    assert.ok(sel.startsWith(".dashboard-shell:has(.fixed.inset-0"), sel);
    assert.ok(sel.includes(":not(.opacity-0)"), `sin :not(.opacity-0) el fondo apagado del menú móvil esconde los widgets siempre: ${sel}`);
    assert.ok(sel.endsWith(".crm-flotante"), sel);
  }
  assert.ok(selectores.some((s) => s.includes(".z-40:not")), "el fondo z-40 de los paneles laterales (regla 13)");
  assert.ok(selectores.some((s) => s.includes(".z-50:not")), "el panel z-50 y los modales");
  assert.ok(selectores.some((s) => s.includes('[class*="z-["]:not')), "los z-[60..90] puntuales");
});

test("el fondo del menú móvil sigue siempre en el DOM y cerrado se apaga con opacity-0", () => {
  assert.match(sidebar, /lg:hidden fixed inset-0 [^`]*z-40/, "el fondo del menú móvil es fixed inset-0 z-40");
  assert.match(sidebar, /mobileOpen \? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"/, "cerrado lleva opacity-0, que es lo que lee la regla");
});

test("la campana y el Salamandrobot se montan para todo el mundo, abajo a la derecha", () => {
  assert.match(shell, /<NotificationBell \/>/, "la campana se monta en DashboardShell");
  assert.match(shell, /<Salamandrobot \/>/, "el Salamandrobot se monta en DashboardShell");

  assert.match(campana, /className="crm-flotante fixed z-30 bottom-\[1\.375rem\] right-\[5\.25rem\]"/, "la campana va abajo, a la izquierda del bot");
  assert.doesNotMatch(campana, /crm-flotante fixed z-30 top-/, "la campana ya no va arriba");
  assert.match(campana, /bottom-\[4\.25rem\] sm:bottom-full sm:mb-2/, "su desplegable se abre hacia arriba");

  assert.match(bot, /className="crm-flotante fixed bottom-4 right-4 z-30 flex flex-col items-end/, "el Salamandrobot va abajo a la derecha, con el chat encima del botón");
  assert.doesNotMatch(bot, /flex-col-reverse/, "flex-col-reverse era para tenerlo arriba");
});
