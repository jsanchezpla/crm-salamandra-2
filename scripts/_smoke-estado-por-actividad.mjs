// @prueba ligera
// Activo, En pausa o Baja según la actividad (lib/clients/estadoPorActividad.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  estadoPorActividad, inicioDelCurso, inicioDelCursoAnterior, elMasVivo, sube, ESTADOS_QUE_SE_REACTIVAN,
} from "../lib/clients/estadoPorActividad.js";

const hoy = new Date("2026-09-15T10:00:00Z");
const cli = { baja: "inactive", hoy };
const pac = { baja: "discharged", hoy };

test("el curso empieza el 1 de septiembre", () => {
  assert.equal(inicioDelCurso(hoy), "2026-09-01");
  assert.equal(inicioDelCursoAnterior(hoy), "2025-09-01");
  assert.equal(inicioDelCurso(new Date("2026-03-10T10:00:00Z")), "2025-09-01");
  assert.equal(inicioDelCurso(new Date("2026-08-31T10:00:00Z")), "2025-09-01");
});

test("con cita desde septiembre, o futura, es activo", () => {
  assert.equal(estadoPorActividad({ ultimaCita: "2026-09-01 09:00:00+00" }, pac), "active");
  assert.equal(estadoPorActividad({ ultimaCita: "2026-10-20" }, pac), "active");
});

test("con una cuota vigente es activo aunque no tenga nada más", () => {
  assert.equal(estadoPorActividad({ cuotaVigente: true }, cli), "active");
});

test("la factura de agosto emitida en septiembre NO lo hace activo", () => {
  assert.equal(estadoPorActividad({ ultimaCita: "2026-08-20", ultimoDinero: "2026-09-03" }, cli), "paused");
});

test("con algo solo el curso pasado —cita, cobro o factura—, en pausa", () => {
  assert.equal(estadoPorActividad({ ultimaCita: "2026-08-31" }, cli), "paused");
  assert.equal(estadoPorActividad({ ultimaCita: "2024-01-10", ultimoDinero: "2025-09-01" }, cli), "paused");
});

test("sin nada desde septiembre de 2025, baja — con el valor de cada tabla", () => {
  assert.equal(estadoPorActividad({ ultimaCita: "2025-08-31", ultimoDinero: "2025-06-01" }, cli), "inactive");
  assert.equal(estadoPorActividad({}, pac), "discharged");
});

test("la familia toma el estado más vivo", () => {
  assert.equal(elMasVivo(["inactive", "paused", "active"], "inactive"), "active");
  assert.equal(elMasVivo(["inactive", "paused"], "inactive"), "paused");
  assert.equal(elMasVivo([], "inactive"), "inactive");
});

test("el `prospect` de la tienda no se reactiva solo", () => {
  assert.ok(!ESTADOS_QUE_SE_REACTIVAN.clients.includes("prospect"));
  assert.deepEqual(ESTADOS_QUE_SE_REACTIVAN.patients, ["paused", "discharged"]);
});

test("quien ESPERA PLAZA se queda en pausa, nunca de baja (AV-0177)", () => {
  // Una familia que se apunta hoy a la cola no tiene citas ni ha pagado nada:
  // por la regla de arriba nacería de Baja, y no se ha ido a ningún sitio.
  assert.equal(estadoPorActividad({ esperandoPlaza: true }, cli), "paused");
  assert.equal(estadoPorActividad({ esperandoPlaza: true }, pac), "paused");
  // Y no tapa nada de lo de antes: con cita de este curso sigue activo, y quien
  // ya no espera (su entrada se cerró) vuelve a la regla de siempre.
  assert.equal(estadoPorActividad({ esperandoPlaza: true, ultimaCita: "2026-09-20" }, cli), "active");
  assert.equal(estadoPorActividad({ esperandoPlaza: false }, pac), "discharged");
});

test("una ficha abierta ESTE curso tampoco puede ser baja", () => {
  // Salió al medir AV-0177: el pase iba a dar de Baja a dos familias abiertas
  // el 17/09 y a una del 11/09, sin cita todavía. Acaban de entrar.
  assert.equal(estadoPorActividad({ altaEn: "2026-09-17" }, cli), "paused");
  assert.equal(estadoPorActividad({ altaEn: "2026-09-01" }, pac), "paused");
  // La de agosto sí: ya estaba antes de que empezara el curso y no ha venido.
  assert.equal(estadoPorActividad({ altaEn: "2026-08-02" }, cli), "inactive");
  // Y con cita del curso manda la cita, como siempre.
  assert.equal(estadoPorActividad({ altaEn: "2026-09-17", ultimaCita: "2026-09-20" }, cli), "active");
});

test("«solo subir» sabe qué cambios mejoran y cuáles no", () => {
  assert.equal(sube("discharged", "paused"), true);
  assert.equal(sube("inactive", "active"), true);
  assert.equal(sube("paused", "active"), true);
  assert.equal(sube("active", "paused"), false);
  assert.equal(sube("paused", "inactive"), false);
  assert.equal(sube("paused", "paused"), false);
});
