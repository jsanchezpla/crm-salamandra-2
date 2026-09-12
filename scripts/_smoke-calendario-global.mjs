// @prueba ligera
/**
 * _smoke-calendario-global.mjs — lo que del calendario global se puede
 * comprobar sin base de datos (03/09/2026; ampliada el 12/09/2026).
 *
 *   node --test scripts/_smoke-calendario-global.mjs
 *
 * Lo que un despiste rompería en silencio:
 *   1. el reparto por host (`CALENDAR_HOST`) normaliza igual que el del
 *      back-office: mayúsculas, espacios y puerto no cambian la decisión;
 *   2. `etiquetar` marca cada evento con su calendario, pone el slug delante
 *      del id (FullCalendar exige ids únicos entre tenants) y el `kind`;
 *   3. `etiquetarProyecto` hace lo mismo con tarjetas e hitos SIN pisar el
 *      `taskId` real (el fallo de antes del 12/09: el arrastre mandaba
 *      `project-task:<uuid>` a Postgres) y sin dejar estirarlos;
 *   4. quién es admin de Salamandra (`cumpleAdminSalamandra`): ve TODOS los
 *      clientes y entra en ellos como su admin, así que cada candado cuenta;
 *   5. con qué cuenta se salta (`decidirSalto`) y qué sale al navegador
 *      (`fichaPublica`, sin ids de master);
 *   6. a dónde aterriza un pase (`destinoDelPase`): lista blanca, nunca una
 *      ruta libre;
 *   7. el pase de salto: un token que no es un pase, o que caducó, no se
 *      canjea, y un destino malo no se emite (sin tocar la base: se rechaza
 *      ANTES de buscar la cuenta);
 *   8. `fechaValida` y `fechaDeParametro` (fechas.js, 12/09/2026): una fecha
 *      imposible (`2026-02-31`) no llega a Postgres como un 500, y un ISO con
 *      hora vale por su día, como lo recorta la pantalla;
 *   9. `repartirColores` (12/09/2026): dos clientes con la misma marca no
 *      salen del mismo color, el elegido a mano se respeta y cada carga da
 *      los mismos colores;
 *  10. `porQueNoSeToca` / `proyectoEditable` (12/09/2026): qué proyecto se
 *      mueve desde el global, con la misma regla en el tablero y al escribir.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SignJWT } from "jose";

process.env.JWT_SECRET ??= "secreto-de-prueba";

const { hostCalendario, esPeticionDeCalendario } = await import("../lib/auth/backoffice.js");
const { etiquetar, etiquetarProyecto } = await import("../lib/calendario-global/eventos.js");
const { canjearSalto, emitirSalto, destinoDelPase } = await import("../lib/calendario-global/salto.js");
const { cumpleAdminSalamandra, decidirSalto, fichaPublica, NOSOTROS, ROLES_ADMIN } = await import(
  "../lib/calendario-global/acceso.js"
);
const { repartirColores, distanciaColor, PALETA_RESERVA, UMBRAL_PARECIDO } = await import(
  "../lib/calendario-global/acceso.js"
);
const { fechaValida, fechaDeParametro } = await import("../lib/calendario-global/fechas.js");
const { porQueNoSeToca, proyectoEditable } = await import("../lib/calendario-global/proyectos.js");

const peticion = (host) => ({ headers: { get: (k) => (k === "host" ? host : null) } });

describe("reparto por host del calendario global", () => {
  it("sin CALENDAR_HOST no hay host de calendario", () => {
    delete process.env.CALENDAR_HOST;
    assert.equal(hostCalendario(), "");
    assert.equal(esPeticionDeCalendario(peticion("calendar.salamandrasolutions.com")), false);
  });

  it("normaliza mayúsculas, espacios y puerto, como el back-office", () => {
    process.env.CALENDAR_HOST = " Calendar.SalamandraSolutions.com:443 ";
    assert.equal(hostCalendario(), "calendar.salamandrasolutions.com");
    assert.equal(esPeticionDeCalendario(peticion("calendar.salamandrasolutions.com")), true);
    assert.equal(esPeticionDeCalendario(peticion("CALENDAR.salamandrasolutions.com:8443")), true);
    assert.equal(esPeticionDeCalendario(peticion("crm.salamandrasolutions.com")), false);
    assert.equal(esPeticionDeCalendario(peticion("admin.salamandrasolutions.com")), false);
  });
});

describe("etiquetar: cada evento sabe de qué calendario es", () => {
  const vinculo = { slug: "aumenta", nombre: "Aumenta", color: "#FF1F96" };
  const ev = {
    id: "6dd41253-4036-4b88-b9b0-660ed50ec442",
    title: "Reunión",
    backgroundColor: "#f97316",
    borderColor: "#f97316",
    extendedProps: { status: "pending", colorPrioridad: "#f97316" },
  };
  const out = etiquetar(ev, vinculo);

  it("el id lleva el slug delante y el de verdad viaja en taskId", () => {
    assert.equal(out.id, "aumenta:6dd41253-4036-4b88-b9b0-660ed50ec442");
    assert.equal(out.extendedProps.taskId, ev.id);
  });

  it("lleva kind calendarTask, que es lo que decide a qué endpoint va el arrastre", () => {
    assert.equal(out.extendedProps.kind, "calendarTask");
  });

  it("se pinta del color del calendario y conserva el de prioridad para poder cambiar", () => {
    assert.equal(out.backgroundColor, "#FF1F96");
    assert.equal(out.borderColor, "#FF1F96");
    assert.equal(out.extendedProps.colorPrioridad, "#f97316");
    assert.deepEqual(out.extendedProps.calendario, vinculo);
  });

  it("no toca el evento original", () => {
    assert.equal(ev.id, "6dd41253-4036-4b88-b9b0-660ed50ec442");
    assert.equal(ev.extendedProps.taskId, undefined);
    assert.equal(ev.extendedProps.kind, undefined);
  });

  it("solo copia slug, nombre y color de la entrada (nada de ids de master ni cuentas)", () => {
    const entrada = { ...vinculo, tenantId: "t-1", saltoUsuarioId: "u-1", saltoEmail: "admin@x", via: "todos" };
    assert.deepEqual(etiquetar(ev, entrada).extendedProps.calendario, vinculo);
  });
});

describe("etiquetarProyecto: tarjetas e hitos de Proyectos en el global", () => {
  const entrada = { slug: "aumenta", nombre: "Aumenta", color: "#FF1F96" };
  const tarjeta = {
    id: "project-task:0b0e7a3c-5d1f-4c2e-9f7a-1a2b3c4d5e6f",
    title: "Maquetar portada · WEB",
    start: "2026-09-15",
    allDay: true,
    backgroundColor: "#3B82F6",
    borderColor: "#3B82F6",
    extendedProps: {
      kind: "projectTask",
      taskId: "0b0e7a3c-5d1f-4c2e-9f7a-1a2b3c4d5e6f",
      projectId: "a7c1d2e3-f4a5-4b6c-8d7e-9f0a1b2c3d4e",
      priority: "high",
    },
  };
  const hito = (status) => ({
    id: "project-milestone:5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b",
    title: "🚩 Entrega · WEB",
    start: "2026-09-20",
    allDay: true,
    backgroundColor: "#8B5CF6",
    borderColor: "#8B5CF6",
    editable: status === "pending",
    extendedProps: {
      kind: "projectMilestone",
      milestoneId: "5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b",
      projectId: "a7c1d2e3-f4a5-4b6c-8d7e-9f0a1b2c3d4e",
      status,
    },
  });

  it("NO pisa el taskId real con el id prefijado (el fallo de antes)", () => {
    const out = etiquetarProyecto(tarjeta, entrada);
    assert.equal(out.extendedProps.taskId, "0b0e7a3c-5d1f-4c2e-9f7a-1a2b3c4d5e6f");
    assert.equal(out.extendedProps.kind, "projectTask");
    assert.equal(out.extendedProps.projectId, "a7c1d2e3-f4a5-4b6c-8d7e-9f0a1b2c3d4e");
  });

  it("prefija el id con el slug y conserva el tipo dentro", () => {
    assert.equal(etiquetarProyecto(tarjeta, entrada).id, "aumenta:project-task:0b0e7a3c-5d1f-4c2e-9f7a-1a2b3c4d5e6f");
    assert.equal(etiquetarProyecto(hito("pending"), entrada).id, "aumenta:project-milestone:5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b");
  });

  it("no se estira (durationEditable:false) y guarda el color original para «Color por prioridad»", () => {
    const out = etiquetarProyecto(tarjeta, entrada);
    assert.equal(out.durationEditable, false);
    assert.equal(out.backgroundColor, "#FF1F96");
    assert.equal(out.borderColor, "#FF1F96");
    assert.equal(out.extendedProps.colorOriginal, "#3B82F6");
    assert.deepEqual(out.extendedProps.calendario, entrada);
  });

  it("conserva el editable del hito: el pendiente se arrastra, el completado no", () => {
    assert.equal(etiquetarProyecto(hito("pending"), entrada).editable, true);
    assert.equal(etiquetarProyecto(hito("completed"), entrada).editable, false);
    assert.equal(etiquetarProyecto(hito("pending"), entrada).extendedProps.milestoneId, "5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b");
  });

  it("no toca el evento original", () => {
    etiquetarProyecto(tarjeta, entrada);
    assert.equal(tarjeta.id, "project-task:0b0e7a3c-5d1f-4c2e-9f7a-1a2b3c4d5e6f");
    assert.equal(tarjeta.extendedProps.calendario, undefined);
    assert.equal(tarjeta.durationEditable, undefined);
  });
});

describe("cumpleAdminSalamandra: quién ve todos los clientes", () => {
  const TENANT = { id: "t-sal", slug: NOSOTROS, status: "active" };
  const admin = { id: "u-1", role: "admin", tenantId: "t-sal", moduleAccess: ["all"], soloBackoffice: false };
  const caso = (cambios = {}) => ({ user: admin, tenant: TENANT, provisioningActivo: true, ...cambios });

  it("los roles de admin son admin y superadmin, y NOSOTROS es salamandra_solutions", () => {
    assert.deepEqual(ROLES_ADMIN, ["admin", "superadmin"]);
    assert.equal(NOSOTROS, "salamandra_solutions");
  });

  it("sí: admin de salamandra_solutions en marcha, con provisioning y moduleAccess all", () => {
    assert.equal(cumpleAdminSalamandra(caso()), true);
  });

  it("sí: con moduleAccess que incluye provisioning (sin all)", () => {
    assert.equal(cumpleAdminSalamandra(caso({ user: { ...admin, moduleAccess: ["calendar", "provisioning"] } })), true);
  });

  it("sí: superadmin sin moduleAccess", () => {
    assert.equal(cumpleAdminSalamandra(caso({ user: { ...admin, role: "superadmin", moduleAccess: null } })), true);
  });

  it("no: cuenta de back-office", () => {
    assert.equal(cumpleAdminSalamandra(caso({ user: { ...admin, soloBackoffice: true } })), false);
  });

  it("no: rol user o manager", () => {
    assert.equal(cumpleAdminSalamandra(caso({ user: { ...admin, role: "user" } })), false);
    assert.equal(cumpleAdminSalamandra(caso({ user: { ...admin, role: "manager" } })), false);
  });

  it("no: admin de OTRO tenant, aunque tenga provisioning encendido a mano", () => {
    assert.equal(cumpleAdminSalamandra(caso({ tenant: { id: "t-sal", slug: "aumenta", status: "active" } })), false);
  });

  it("no: nuestro tenant suspendido", () => {
    assert.equal(cumpleAdminSalamandra(caso({ tenant: { ...TENANT, status: "suspended" } })), false);
  });

  it("no: sin provisioning (apagado o sin fila); solo vale true de verdad", () => {
    assert.equal(cumpleAdminSalamandra(caso({ provisioningActivo: false })), false);
    assert.equal(cumpleAdminSalamandra(caso({ provisioningActivo: undefined })), false);
    assert.equal(cumpleAdminSalamandra(caso({ provisioningActivo: "true" })), false);
  });

  it("no: admin con moduleAccess sin all ni provisioning (o vacío)", () => {
    assert.equal(cumpleAdminSalamandra(caso({ user: { ...admin, moduleAccess: ["calendar", "projects"] } })), false);
    assert.equal(cumpleAdminSalamandra(caso({ user: { ...admin, moduleAccess: null } })), false);
  });

  it("no: la cuenta no es de ese tenant", () => {
    assert.equal(cumpleAdminSalamandra(caso({ user: { ...admin, tenantId: "t-otro" } })), false);
  });

  it("no: sin cuenta, sin tenant o sin nada", () => {
    assert.equal(cumpleAdminSalamandra(caso({ user: null })), false);
    assert.equal(cumpleAdminSalamandra(caso({ tenant: null })), false);
    assert.equal(cumpleAdminSalamandra(), false);
  });
});

describe("decidirSalto: con qué cuenta se abre el CRM del cliente", () => {
  const aumenta = { id: "t-aum", slug: "aumenta" };
  const demo = { id: "t-demo", slug: "demo" };
  const nuestro = { id: "t-sal", slug: NOSOTROS };
  const yo = { id: "u-yo", email: "rodrigo", tenantId: "t-sal", soloBackoffice: false };
  const vinculada = { id: "u-vin", email: "oficina@aumenta.es", tenantId: "t-aum", soloBackoffice: false };
  const adminAumenta = { id: "u-adm", email: "admin@aumenta.es", tenantId: "t-aum" };

  it("manda la cuenta del vínculo, aunque haya admin", () => {
    const s = decidirSalto({ tenant: aumenta, cuentaVinculo: vinculada, yo, todos: true, adminCliente: adminAumenta });
    assert.deepEqual(s, { saltoComo: "cuenta", saltoUsuarioId: "u-vin", saltoEmail: "oficina@aumenta.es" });
  });

  it("una cuenta de vínculo de otro tenant o de back-office no vale", () => {
    const ajena = { ...vinculada, tenantId: "t-otro" };
    assert.equal(decidirSalto({ tenant: aumenta, cuentaVinculo: ajena }).saltoComo, null);
    const bo = { ...vinculada, soloBackoffice: true };
    assert.equal(decidirSalto({ tenant: aumenta, cuentaVinculo: bo }).saltoComo, null);
  });

  it("sin vínculo, un admin de Salamandra entra como el admin del cliente", () => {
    const s = decidirSalto({ tenant: aumenta, yo, todos: true, adminCliente: adminAumenta });
    assert.deepEqual(s, { saltoComo: "admin", saltoUsuarioId: "u-adm", saltoEmail: "admin@aumenta.es" });
  });

  it("sin ser admin de Salamandra no hay «como admin»", () => {
    assert.equal(decidirSalto({ tenant: aumenta, yo, todos: false, adminCliente: adminAumenta }).saltoComo, null);
  });

  it("nunca como admin en una demo", () => {
    const adminDemo = { id: "u-d", email: "admin@demo", tenantId: "t-demo" };
    assert.equal(decidirSalto({ tenant: demo, yo, todos: true, adminCliente: adminDemo }).saltoComo, null);
  });

  it("en nuestro propio CRM se entra con la cuenta propia, no con la de un compañero", () => {
    const compa = { id: "u-jorge", email: "jorge", tenantId: "t-sal" };
    const s = decidirSalto({ tenant: nuestro, yo, todos: true, adminCliente: compa });
    assert.deepEqual(s, { saltoComo: "cuenta", saltoUsuarioId: "u-yo", saltoEmail: "rodrigo" });
  });

  it("sin cuenta admin en el cliente, no hay salto", () => {
    assert.deepEqual(decidirSalto({ tenant: aumenta, yo, todos: true, adminCliente: null }), {
      saltoComo: null,
      saltoUsuarioId: null,
      saltoEmail: null,
    });
  });

  it("fichaPublica no saca ids de master ni por dónde entró", () => {
    const entrada = {
      slug: "aumenta", nombre: "Aumenta", tenantId: "t-aum", color: "#FF1F96", orden: null,
      calendario: false, proyectos: true, via: "todos",
      saltoComo: "admin", saltoUsuarioId: "u-adm", saltoEmail: "admin@aumenta.es",
    };
    assert.deepEqual(fichaPublica(entrada), {
      slug: "aumenta", nombre: "Aumenta", color: "#FF1F96", calendario: false, proyectos: true,
      saltoComo: "admin", saltoEmail: "admin@aumenta.es",
    });
  });
});

describe("fechaValida y fechaDeParametro: qué fecha acepta el global", () => {
  it("fechas civiles de verdad, bisiestos incluidos", () => {
    assert.equal(fechaValida("2026-09-12"), true);
    assert.equal(fechaValida("2024-02-29"), true);
    assert.equal(fechaValida("2026-12-31"), true);
  });

  it("pasan la regex pero no existen: se rechazan (antes eran un 500 de Postgres)", () => {
    assert.equal(fechaValida("2026-02-31"), false);
    assert.equal(fechaValida("2026-13-01"), false);
    assert.equal(fechaValida("2025-02-29"), false);
    assert.equal(fechaValida("2026-00-10"), false);
  });

  it("otro formato, con hora, vacío o que no es texto: no", () => {
    assert.equal(fechaValida("2026-9-1"), false);
    assert.equal(fechaValida("12/09/2026"), false);
    assert.equal(fechaValida("2026-09-12T10:00"), false);
    assert.equal(fechaValida(""), false);
    assert.equal(fechaValida(null), false);
    assert.equal(fechaValida(undefined), false);
    assert.equal(fechaValida(20260912), false);
  });

  it("un parámetro con hora vale por su día, sin cambiar de zona", () => {
    assert.equal(fechaDeParametro("2026-09-07"), "2026-09-07");
    assert.equal(fechaDeParametro("2026-09-07T00:00:00+02:00"), "2026-09-07");
    // Un «+» sin codificar en la URL llega como espacio: la fecha es la misma.
    assert.equal(fechaDeParametro("2026-09-07T00:00:00 02:00"), "2026-09-07");
    assert.equal(fechaDeParametro(" 2026-09-07 "), "2026-09-07");
  });

  it("un parámetro imposible o basura da null (el route responde 400)", () => {
    assert.equal(fechaDeParametro("2026-13-01"), null);
    assert.equal(fechaDeParametro("2026-02-31T00:00:00"), null);
    assert.equal(fechaDeParametro("mañana"), null);
    assert.equal(fechaDeParametro(""), null);
    assert.equal(fechaDeParametro(null), null);
    assert.equal(fechaDeParametro(["2026-09-07"]), null);
  });
});

describe("repartirColores: cada cliente con un color que se distinga", () => {
  const VERDE = "#1B3A2D"; // la marca por defecto de Salamandra, la de muchos clientes

  it("dos clientes con la misma marca no salen iguales", () => {
    const [a, b] = repartirColores([{ propuesto: VERDE }, { propuesto: VERDE }]);
    assert.equal(a, VERDE);
    assert.notEqual(b, VERDE);
    assert.ok(distanciaColor(a, b) >= UMBRAL_PARECIDO);
    // El primero de la reserva (#1F3B34) es otro verde casi igual: se salta.
    assert.equal(b, "#B7791F");
  });

  it("una marca que no se parece a nada se conserva", () => {
    assert.deepEqual(repartirColores([{ propuesto: "#FF1F96" }, { propuesto: VERDE }]), ["#FF1F96", VERDE]);
  });

  it("el color de la fila se respeta siempre, aunque se repita", () => {
    assert.deepEqual(repartirColores([{ explicito: VERDE }, { explicito: VERDE }]), [VERDE, VERDE]);
  });

  it("el color de la fila se reserva antes: un cliente de más arriba no se lo quita por marca", () => {
    const [arriba, conFila] = repartirColores([{ propuesto: VERDE }, { explicito: VERDE, propuesto: "#FF1F96" }]);
    assert.equal(conFila, VERDE);
    assert.ok(distanciaColor(arriba, VERDE) >= UMBRAL_PARECIDO);
  });

  it("parecido cuenta como igual (distancia < 60), no solo el mismo código", () => {
    const [, b] = repartirColores([{ propuesto: "#1B3A2D" }, { propuesto: "#1f3b34" }]);
    assert.notEqual(b.toUpperCase(), "#1F3B34");
  });

  it("un color que no es #RRGGBB no cuenta: va a la reserva", () => {
    assert.deepEqual(repartirColores([{ explicito: "rojo", propuesto: null }]), ["#1F3B34"]);
    assert.deepEqual(repartirColores([{ propuesto: "#FFF" }]), ["#1F3B34"]);
  });

  it("determinista: la misma lista da los mismos colores", () => {
    const lista = [{ propuesto: VERDE }, { explicito: "#2563EB" }, { propuesto: VERDE }, { propuesto: "#FF1F96" }, {}];
    assert.deepEqual(repartirColores(lista), repartirColores(lista));
  });

  it("doce clientes con la misma marca: doce colores distinguibles", () => {
    const colores = repartirColores(Array.from({ length: 12 }, () => ({ propuesto: VERDE })));
    for (let i = 0; i < colores.length; i++) {
      for (let j = i + 1; j < colores.length; j++) {
        assert.ok(distanciaColor(colores[i], colores[j]) >= UMBRAL_PARECIDO, `${colores[i]} y ${colores[j]}`);
      }
    }
  });

  it("más clientes que colores: no lanza y los que sobran se reparten por turnos", () => {
    const colores = repartirColores(Array.from({ length: 14 }, () => ({ propuesto: VERDE })));
    assert.equal(colores.length, 14);
    for (const c of colores) assert.match(c, /^#[0-9A-Fa-f]{6}$/);
    assert.notEqual(colores[12], colores[13]);
  });

  it("sin candidatos, nada", () => {
    assert.deepEqual(repartirColores([]), []);
    assert.deepEqual(repartirColores(null), []);
  });

  it("la paleta de reserva: doce, distinguibles entre sí y sin rojo puro", () => {
    assert.equal(PALETA_RESERVA.length, 12);
    for (let i = 0; i < PALETA_RESERVA.length; i++) {
      assert.ok(distanciaColor(PALETA_RESERVA[i], "#FF0000") >= UMBRAL_PARECIDO, PALETA_RESERVA[i]);
      for (let j = i + 1; j < PALETA_RESERVA.length; j++) {
        assert.ok(distanciaColor(PALETA_RESERVA[i], PALETA_RESERVA[j]) >= UMBRAL_PARECIDO, `${PALETA_RESERVA[i]} y ${PALETA_RESERVA[j]}`);
      }
    }
  });
});

describe("porQueNoSeToca / proyectoEditable: qué proyecto se mueve desde el global", () => {
  it("activo, borrador, en pausa o completado: se puede", () => {
    for (const status of ["active", "draft", "paused", "completed"]) {
      assert.equal(porQueNoSeToca({ status, archivedAt: null }), null, status);
      assert.equal(proyectoEditable({ status, archivedAt: null }), true, status);
    }
  });

  it("cancelado: no, con el mismo texto que da la escritura", () => {
    assert.equal(porQueNoSeToca({ status: "cancelled", archivedAt: null }), "Ese proyecto está cancelado");
    assert.equal(proyectoEditable({ status: "cancelled", archivedAt: null }), false);
  });

  it("archivado: no, aunque esté activo; y archivado manda sobre cancelado", () => {
    const archivado = new Date("2026-09-01T10:00:00Z");
    assert.equal(porQueNoSeToca({ status: "active", archivedAt: archivado }), "Ese proyecto está archivado");
    assert.equal(porQueNoSeToca({ status: "cancelled", archivedAt: archivado }), "Ese proyecto está archivado");
    assert.equal(proyectoEditable({ status: "active", archivedAt: archivado }), false);
  });

  it("sin proyecto: no (nunca `editable: true` por un fallo de lectura)", () => {
    assert.equal(proyectoEditable(null), false);
    assert.equal(proyectoEditable(undefined), false);
  });

  it("devuelve un boolean de verdad, que es lo que viaja en `proyecto.editable`", () => {
    assert.equal(typeof proyectoEditable({ status: "active", archivedAt: null }), "boolean");
  });
});

describe("destinoDelPase: a dónde aterriza un pase (lista blanca)", () => {
  const P = "a7c1d2e3-f4a5-4b6c-8d7e-9f0a1b2c3d4e";
  const T = "6dd41253-4036-4b88-b9b0-660ed50ec442";

  it("calendario con evento y fecha si valen", () => {
    assert.equal(destinoDelPase({ a: "calendario", taskId: T, fecha: "2026-09-15" }), `/calendario?evento=${T}&fecha=2026-09-15`);
    assert.equal(destinoDelPase({ a: "calendario" }), "/calendario");
    assert.equal(destinoDelPase({ a: "calendario", taskId: "project-task:x", fecha: "15/09/2026" }), "/calendario");
  });

  it("proyecto y tablero con un UUID", () => {
    assert.equal(destinoDelPase({ a: "proyecto", projectId: P }), `/proyectos/${P}`);
    assert.equal(destinoDelPase({ a: "tablero", projectId: P }), `/proyectos/${P}/board`);
  });

  it("un projectId que no es UUID no sale de /calendario (nada de rutas libres)", () => {
    assert.equal(destinoDelPase({ a: "proyecto", projectId: "../../admin" }), "/calendario");
    assert.equal(destinoDelPase({ a: "tablero", projectId: `${P}/../../admin` }), "/calendario");
    assert.equal(destinoDelPase({ a: "tablero" }), "/calendario");
  });

  it("un `a` desconocido o ausente (pases de antes del 12/09) es el calendario", () => {
    assert.equal(destinoDelPase({ a: "/admin", projectId: P }), "/calendario");
    assert.equal(destinoDelPase({ taskId: T, fecha: "2026-09-15" }), `/calendario?evento=${T}&fecha=2026-09-15`);
    assert.equal(destinoDelPase(null), "/calendario");
    assert.equal(destinoDelPase("proyecto"), "/calendario");
  });
});

describe("el pase de salto se rechaza antes de tocar la base", () => {
  it("nada, basura o un token de otro secreto → pase inválido", async () => {
    await assert.rejects(() => canjearSalto(null), /inválido/);
    await assert.rejects(() => canjearSalto("no-es-un-jwt"), /inválido/);
    const ajeno = await new SignJWT({ p: "calendario-global:salto", slug: "demo" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("a25a9846-09ed-41e1-ab74-72d5a1c0684e")
      .setJti("x")
      .setIssuedAt()
      .setExpirationTime("60s")
      .sign(new TextEncoder().encode("otro-secreto"));
    await assert.rejects(() => canjearSalto(ajeno), /inválido/);
  });

  it("un pase con el propósito equivocado, aunque esté bien firmado, no vale", async () => {
    const secreto = new TextEncoder().encode(process.env.JWT_SECRET + "_salto");
    const raro = await new SignJWT({ p: "otra-cosa", slug: "demo" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("a25a9846-09ed-41e1-ab74-72d5a1c0684e")
      .setJti("y")
      .setIssuedAt()
      .setExpirationTime("60s")
      .sign(secreto);
    await assert.rejects(() => canjearSalto(raro), /inválido/);
  });

  it("un pase caducado no vale, y lo dice como caducado", async () => {
    const secreto = new TextEncoder().encode(process.env.JWT_SECRET + "_salto");
    const viejo = await new SignJWT({ p: "calendario-global:salto", slug: "demo" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("a25a9846-09ed-41e1-ab74-72d5a1c0684e")
      .setJti("z")
      .setIssuedAt(Math.floor(Date.now() / 1000) - 600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 540)
      .sign(secreto);
    await assert.rejects(() => canjearSalto(viejo), /caducado/);
  });

  it("un destino fuera de la lista blanca no llega a emitirse", async () => {
    const pedir = (destino) => emitirSalto({ usuarioId: "a25a9846-09ed-41e1-ab74-72d5a1c0684e", slug: "aumenta", destino });
    await assert.rejects(() => pedir({ tipo: "proyecto", projectId: "../../admin" }), /Proyecto inválido/);
    await assert.rejects(() => pedir({ tipo: "tablero" }), /Proyecto inválido/);
    await assert.rejects(() => pedir({ tipo: "/admin/clientes" }), /Destino inválido/);
    await assert.rejects(() => pedir({ tipo: "calendario", taskId: "project-task:x" }), /Evento inválido/);
    await assert.rejects(() => pedir({ tipo: "calendario", fecha: "mañana" }), /Fecha inválida/);
  });
});
