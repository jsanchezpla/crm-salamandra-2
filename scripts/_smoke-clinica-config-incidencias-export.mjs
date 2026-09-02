// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-clinica-config-incidencias-export.mjs — desempeño por roles, taxonomía
 * de incidencias y la exportación de estadísticas del centro (20/08/2026).
 *
 *   node scripts/_smoke-clinica-config-incidencias-export.mjs
 *   node --test-name-pattern="verificación" scripts/_smoke-clinica-config-incidencias-export.mjs
 *
 * ── DE QUÉ NACE ────────────────────────────────────────────────────────────
 *
 * Tres piezas del módulo Clínica que Aumenta usa en producción con datos
 * reales y que no tenían ninguna prueba:
 *
 * · `lib/clinica/performanceConfig.js` — el desempeño configurable por roles.
 *   Su promesa central es la COMPATIBILIDAD: un tenant SIN config guardada (o
 *   con una corrupta) se comporta EXACTAMENTE igual que antes — las 7 áreas
 *   históricas, pesos intactos, semáforo 85/70. Si `normalizeRoles` deja pasar
 *   una config con pesos que no suman 100, el total de desempeño de una
 *   terapeuta deja de ser un porcentaje y nadie lo ve hasta la reunión.
 *
 * · `lib/clinica/incidencias.js` — la verificación GOBIERNA el estado (un solo
 *   control, el estado se mueve solo). Si «no resuelta» dejara de mapear a
 *   «en proceso», una incidencia quedaría resuelta y pendiente a la vez, que
 *   es justo lo que el comentario del fichero prohíbe.
 *
 * · `lib/clinica/estadisticasExport.js` — el Excel y el PDF de dirección salen
 *   del MISMO objeto que pinta la pantalla: el papel de la reunión no puede
 *   decir una cosa distinta del CRM. Aquí se comprueba QUÉ acaba en cada hoja,
 *   celda a celda, abriendo el buffer que devuelve.
 *
 * FECHAS: producción corre en Europe/Madrid desde el 19/08/2026, pero nada de
 * esto debe depender de la zona. La prueba pasa igual con `TZ=UTC`: los
 * instantes van con offset explícito (+02:00) o como texto 'AAAA-MM-DD', que
 * es lo que entrega la columna DATEONLY de incidencias.
 *
 * `exceljs` se importa aquí SOLO para ABRIR el buffer que devuelve
 * `buildEstadisticasXlsx` y mirar dentro: es dependencia del propio fichero de
 * lib que se prueba (el import no añade nada nuevo al proyecto).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";

import {
  ALLOWED_ICONS,
  DEFAULT_ICON,
  DEFAULT_THRESHOLDS,
  LEGACY_ROLE,
  normalizeRoles,
  getPerformanceRoles,
  findRoleByKey,
  defaultRole,
  resolveRoleForMember,
  slugifyAreaKey,
} from "../lib/clinica/performanceConfig.js";
import {
  INCIDENCIA_CATEGORIES,
  INCIDENCIA_STATUS_ORDER,
  INCIDENCIA_VERIFICATIONS,
  exigeSubcategoria,
  isValidCategory,
  isValidStatus,
  isValidPriority,
  isValidVerification,
  categoryLabel,
  statusLabel,
  priorityLabel,
  verificationLabel,
  statusDeVerificacion,
  serializeIncidencia,
  responsablesDe,
  sincronizarResponsables,
} from "../lib/clinica/incidencias.js";
import { buildEstadisticasXlsx, buildEstadisticasPdf } from "../lib/clinica/estadisticasExport.js";

/* ── Piezas de ejemplo ────────────────────────────────────────────────────── */

/** Área mínima válida (los pesos los pone cada prueba para que sumen 100). */
const area = (key, weight, extra = {}) => ({ key, name: `Área ${key}`, weight, ...extra });

/** Rol mínimo válido: dos áreas 60/40. */
const rol = (key, extra = {}) => ({
  key,
  name: `Rol ${key}`,
  areas: [area("a1", 60), area("a2", 40)],
  ...extra,
});

/* ═══ performanceConfig ════════════════════════════════════════════════════ */

describe("normalizeRoles: lo reparable se repara, lo irreparable devuelve null", () => {
  it("un rol bien formado sale normalizado entero: textos recortados, defaults rellenos", () => {
    const salida = normalizeRoles([
      {
        key: " ventas ",
        name: "  Equipo comercial  ",
        positions: [" Comercial ", "Comercial", "", 42, "Ventas"],
        thresholds: { green: 90, amber: 60 },
        areas: [
          {
            key: "captacion",
            name: "Captación",
            weight: 60,
            icon: "phone",
            goal: "Llamar",
            description: "d",
          },
          { key: "cierre", name: "Cierre", weight: 40, icon: "euro" },
        ],
      },
    ]);
    assert.deepEqual(salida, [
      {
        key: "ventas",
        name: "Equipo comercial",
        positions: ["Comercial", "Ventas"],
        isDefault: true, // único rol sin marcar → se marca él
        thresholds: { green: 90, amber: 60 },
        areas: [
          {
            key: "captacion",
            name: "Captación",
            weight: 60,
            icon: "phone",
            goal: "Llamar",
            description: "d",
          },
          { key: "cierre", name: "Cierre", weight: 40, icon: "euro", goal: "", description: "" },
        ],
      },
    ]);
  });

  it("acepta el objeto canónico { roles } igual que el array pelado", () => {
    assert.deepEqual(normalizeRoles({ roles: [rol("uno")] }), normalizeRoles([rol("uno")]));
  });

  it("pesos que no suman exactamente 100 → null, por ambos lados (99 y 101)", () => {
    assert.equal(normalizeRoles([rol("r", { areas: [area("a1", 60), area("a2", 39)] })]), null);
    assert.equal(normalizeRoles([rol("r", { areas: [area("a1", 60), area("a2", 41)] })]), null);
  });

  it("los pesos se redondean ANTES de sumar: 59.7 + 40 son 100 y pasa", () => {
    const [r] = normalizeRoles([rol("r", { areas: [area("a1", 59.7), area("a2", 40)] })]);
    assert.deepEqual(
      r.areas.map((a) => a.weight),
      [60, 40]
    );
  });

  it("un peso fuera de 1..100, cero o no numérico invalida todo → null", () => {
    assert.equal(normalizeRoles([rol("r", { areas: [area("a1", 0), area("a2", 100)] })]), null);
    assert.equal(normalizeRoles([rol("r", { areas: [area("a1", 101), area("a2", -1)] })]), null);
    assert.equal(normalizeRoles([rol("r", { areas: [area("a1", "abc"), area("a2", 40)] })]), null);
  });

  it("claves duplicadas → null: de rol y de área por igual", () => {
    assert.equal(normalizeRoles([rol("igual"), rol("igual")]), null);
    assert.equal(normalizeRoles([rol("r", { areas: [area("a1", 60), area("a1", 40)] })]), null);
  });

  it("una clave que no es slug (mayúsculas, guion, acento, vacía) → null", () => {
    for (const mala of ["Ventas", "con-guion", "área", "", "a".repeat(65)]) {
      assert.equal(normalizeRoles([rol(mala)]), null, `debió rechazar «${mala}»`);
    }
  });

  it("sin nombre no hay rol ni área; con 130 caracteres se queda en 120", () => {
    assert.equal(normalizeRoles([rol("r", { name: "   " })]), null);
    assert.equal(
      normalizeRoles([rol("r", { areas: [area("a1", 60, { name: "" }), area("a2", 40)] })]),
      null
    );
    const [r] = normalizeRoles([rol("r", { name: "x".repeat(130) })]);
    assert.equal(r.name.length, 120);
  });

  it("fuera de rango: 0 roles, 21 roles, 0 áreas o 16 áreas → null", () => {
    assert.equal(normalizeRoles([]), null);
    assert.equal(normalizeRoles(Array.from({ length: 21 }, (_, i) => rol(`r${i}`))), null);
    assert.equal(normalizeRoles([rol("r", { areas: [] })]), null);
    const dieciseis = Array.from({ length: 16 }, (_, i) => area(`a${i}`, i === 0 ? 25 : 5));
    assert.equal(normalizeRoles([rol("r", { areas: dieciseis })]), null);
  });

  it("un icono fuera de la lista se sustituye por el default, no invalida", () => {
    const [r] = normalizeRoles([
      rol("r", {
        areas: [area("a1", 60, { icon: "sparkles" }), area("a2", 40, { icon: "heart" })],
      }),
    ]);
    assert.equal(r.areas[0].icon, DEFAULT_ICON);
    assert.equal(r.areas[1].icon, "heart");
    assert.ok(ALLOWED_ICONS.includes(DEFAULT_ICON));
  });

  it("umbrales inválidos caen al 85/70 histórico; válidos se redondean", () => {
    const norm = (thresholds) => normalizeRoles([rol("r", { thresholds })])[0].thresholds;
    assert.deepEqual(norm({ green: 70, amber: 70 }), DEFAULT_THRESHOLDS); // verde debe SUPERAR al ámbar
    assert.deepEqual(norm({ green: 101, amber: 70 }), DEFAULT_THRESHOLDS);
    assert.deepEqual(norm({ green: 80, amber: -1 }), DEFAULT_THRESHOLDS);
    assert.deepEqual(norm(undefined), DEFAULT_THRESHOLDS);
    assert.deepEqual(norm({ green: "90.4", amber: 60.5 }), { green: 90, amber: 61 });
    assert.deepEqual(norm({ green: 100, amber: 0 }), { green: 100, amber: 0 });
  });

  it("exactamente UN rol por defecto: gana el primero marcado; sin marcar, el primero", () => {
    const varios = normalizeRoles([
      rol("a"),
      rol("b", { isDefault: true }),
      rol("c", { isDefault: true }),
    ]);
    assert.deepEqual(
      varios.map((r) => r.isDefault),
      [false, true, false]
    );
    const ninguno = normalizeRoles([rol("a"), rol("b")]);
    assert.deepEqual(
      ninguno.map((r) => r.isDefault),
      [true, false]
    );
  });

  it("con algo que no es una lista de roles → null, sin reventar", () => {
    assert.equal(normalizeRoles(null), null);
    assert.equal(normalizeRoles({}), null);
    assert.equal(normalizeRoles("texto"), null);
    assert.equal(normalizeRoles([null]), null);
  });
});

describe("getPerformanceRoles: sin config guardada, el tenant se comporta como siempre", () => {
  it("sin tenant, sin settings o con settings vacíos → el rol legacy y isDefaultConfig", () => {
    for (const tenant of [undefined, null, {}, { settings: {} }, { settings: { clinica: {} } }]) {
      const r = getPerformanceRoles(tenant);
      assert.equal(r.isDefaultConfig, true);
      assert.equal(r.roles[0], LEGACY_ROLE);
    }
  });

  it("una config guardada CORRUPTA también cae al legacy (nunca deja al centro sin desempeño)", () => {
    const tenant = { settings: { clinica: { performanceRoles: { roles: [{ key: "x" }] } } } };
    assert.deepEqual(getPerformanceRoles(tenant), { roles: [LEGACY_ROLE], isDefaultConfig: true });
    const vacia = { settings: { clinica: { performanceRoles: [] } } };
    assert.equal(getPerformanceRoles(vacia).isDefaultConfig, true);
  });

  it("una config válida guardada manda: sus roles y isDefaultConfig=false", () => {
    const tenant = { settings: { clinica: { performanceRoles: { roles: [rol("ventas")] } } } };
    const r = getPerformanceRoles(tenant);
    assert.equal(r.isDefaultConfig, false);
    assert.equal(r.roles[0].key, "ventas");
  });

  it("el rol legacy reproduce las 7 áreas históricas: area1..area8 SIN area5, pesos que suman 100, semáforo 85/70", () => {
    assert.deepEqual(
      LEGACY_ROLE.areas.map((a) => a.key),
      ["area1", "area2", "area3", "area4", "area6", "area7", "area8"]
    );
    assert.equal(
      LEGACY_ROLE.areas.reduce((s, a) => s + a.weight, 0),
      100
    );
    assert.deepEqual(LEGACY_ROLE.thresholds, { green: 85, amber: 70 });
    assert.equal(LEGACY_ROLE.isDefault, true);
    // Conserva `n` e `indicators` para que el serializer emita lo mismo que antes,
    // y la meta se deriva de los indicadores del área.
    assert.equal(LEGACY_ROLE.areas[1].n, 2);
    assert.equal(LEGACY_ROLE.areas[1].goal, "Registros funcionales realizados");
    assert.equal(LEGACY_ROLE.areas[0].indicators.length, 3);
  });
});

describe("findRoleByKey / defaultRole / resolveRoleForMember: quién le toca a cada cual", () => {
  const config = {
    roles: normalizeRoles([
      rol("terapeuta", { isDefault: true }),
      rol("ventas", { positions: ["Comercial"] }),
    ]),
  };

  it("findRoleByKey encuentra por clave, con {roles} o con el array pelado; sin clave o sin rol → null", () => {
    assert.equal(findRoleByKey(config, "ventas").key, "ventas");
    assert.equal(findRoleByKey(config.roles, "ventas").key, "ventas");
    assert.equal(findRoleByKey(config, "nadie"), null);
    assert.equal(findRoleByKey(config, ""), null);
  });

  it("defaultRole devuelve el marcado; con lista vacía cae al legacy", () => {
    assert.equal(defaultRole(config).key, "terapeuta");
    assert.equal(defaultRole([]), LEGACY_ROLE);
    assert.equal(defaultRole(null), LEGACY_ROLE);
  });

  it("resolveRoleForMember casa el puesto sin distinguir mayúsculas ni espacios sobrantes", () => {
    assert.equal(resolveRoleForMember(config, { position: "  comercial " }).key, "ventas");
    assert.equal(resolveRoleForMember(config, { position: "COMERCIAL" }).key, "ventas");
  });

  it("sin puesto, con puesto que nadie reclama o sin miembro → el rol por defecto", () => {
    assert.equal(resolveRoleForMember(config, { position: "gerencia" }).key, "terapeuta");
    assert.equal(resolveRoleForMember(config, { position: "" }).key, "terapeuta");
    assert.equal(resolveRoleForMember(config, null).key, "terapeuta");
  });
});

describe("slugifyAreaKey: claves nuevas legibles, únicas y de por vida", () => {
  it("acentos fuera, minúsculas, separador _", () => {
    assert.equal(slugifyAreaKey("Atención al cliente"), "atencion_al_cliente");
    assert.equal(slugifyAreaKey("  Órdenes / Pedidos  "), "ordenes_pedidos");
    assert.equal(slugifyAreaKey("Año 1"), "ano_1");
  });

  it("un nombre vacío o solo símbolos cae a «area»", () => {
    assert.equal(slugifyAreaKey(""), "area");
    assert.equal(slugifyAreaKey("¡¡¡···!!!"), "area");
    assert.equal(slugifyAreaKey(null), "area");
  });

  it("las colisiones numeran: _2, _3…", () => {
    assert.equal(slugifyAreaKey("Cierre", ["cierre"]), "cierre_2");
    assert.equal(slugifyAreaKey("Cierre", ["cierre", "cierre_2"]), "cierre_3");
  });

  it("nunca pasa de 64 caracteres, ni siquiera al numerar una colisión", () => {
    const largo = "a".repeat(80);
    assert.equal(slugifyAreaKey(largo).length, 64);
    const numerado = slugifyAreaKey(largo, ["a".repeat(64)]);
    assert.equal(numerado, `${"a".repeat(62)}_2`);
    assert.equal(numerado.length, 64);
  });
});

/* ═══ incidencias ══════════════════════════════════════════════════════════ */

describe("incidencias: la taxonomía es fija y la verificación gobierna el estado", () => {
  it("las 10 categorías en el orden que las escribió el centro, y solo Administrativa trae subcategorías", () => {
    assert.deepEqual(
      INCIDENCIA_CATEGORIES.map((c) => c.key),
      [
        "terapeutica",
        "organizativa",
        "documental",
        "administrativa",
        "coordinacion",
        "tecnologica",
        "comunicativa",
        "solicitud_laboral",
        "informacion",
        "otros",
      ]
    );
    const conSub = INCIDENCIA_CATEGORIES.filter((c) => c.subcategories.length);
    assert.deepEqual(
      conSub.map((c) => c.key),
      ["administrativa"]
    );
    assert.equal(conSub[0].subcategories.length, 6);
  });

  /* Las claves de las ocho viejas están escritas en `incidencias.category`: si
     alguien renombra una para que "cuadre" con la etiqueta nueva, las filas que
     ya existan se quedan apuntando a una categoría que no existe y la pantalla
     las pinta con la clave cruda. La etiqueta se cambia; la clave, no. */
  it("las claves históricas siguen siendo válidas aunque su etiqueta haya cambiado", () => {
    for (const k of ["comunicativa", "informacion", "coordinacion", "tecnologica"]) {
      assert.equal(isValidCategory(k), true, `la clave ${k} tiene que seguir existiendo`);
    }
    assert.equal(categoryLabel("comunicativa"), "Comunicación oficial");
    assert.equal(categoryLabel("informacion"), "Solicitud de información");
    assert.equal(categoryLabel("coordinacion"), "Coordinación / apoyo");
  });

  it("solo «Otros» obliga a especificar la subcategoría", () => {
    assert.equal(exigeSubcategoria("otros"), true);
    for (const c of INCIDENCIA_CATEGORIES) {
      if (c.key !== "otros") assert.equal(exigeSubcategoria(c.key), false, `${c.key} no debería exigirla`);
    }
  });

  it("verificar mueve el estado solo: resuelta → resolved; parcial y no_resuelta → in_progress", () => {
    assert.equal(statusDeVerificacion("resuelta"), "resolved");
    assert.equal(statusDeVerificacion("parcial"), "in_progress");
    assert.equal(statusDeVerificacion("no_resuelta"), "in_progress");
  });

  it("sin verificar (null, undefined o clave desconocida) → pendiente, nunca resuelta", () => {
    assert.equal(statusDeVerificacion(null), "pending");
    assert.equal(statusDeVerificacion(undefined), "pending");
    assert.equal(statusDeVerificacion("a_medias"), "pending");
  });

  it("los validadores dicen sí a lo suyo y no a lo demás", () => {
    assert.equal(isValidCategory("administrativa"), true);
    assert.equal(isValidCategory("ventas"), false);
    assert.equal(isValidStatus("in_progress"), true);
    assert.equal(isValidStatus("open"), false);
    assert.equal(isValidPriority("high"), true);
    assert.equal(isValidPriority("urgente"), false);
    assert.equal(isValidVerification("parcial"), true);
    assert.equal(isValidVerification("resuelto"), false);
    assert.deepEqual(INCIDENCIA_STATUS_ORDER, ["pending", "in_progress", "resolved"]);
    assert.deepEqual(
      INCIDENCIA_VERIFICATIONS.map((v) => v.key),
      ["resuelta", "parcial", "no_resuelta"]
    );
  });

  it("las etiquetas de categoría/estado/prioridad devuelven la CLAVE si no la conocen; la de verificación, null", () => {
    assert.equal(categoryLabel("tecnologica"), "Tecnológica / material");
    assert.equal(categoryLabel("desconocida"), "desconocida");
    assert.equal(statusLabel("resolved"), "Resuelta");
    assert.equal(statusLabel("wat"), "wat");
    assert.equal(priorityLabel("medium"), "Media");
    assert.equal(priorityLabel("wat"), "wat");
    assert.equal(verificationLabel("no_resuelta"), "No resuelta");
    assert.equal(verificationLabel("wat"), null);
  });
});

/** Una fila de incidencia como sale de la base: la DATEONLY llega como texto. */
function filaCompleta() {
  return {
    id: "i-1",
    incidenceDate: "2026-08-04",
    title: "Se solapan dos citas",
    description: "Detalle",
    category: "administrativa",
    subcategory: "Citas",
    status: "in_progress",
    priority: "high",
    patientId: "p-1",
    patient: { id: "p-1", firstName: "Ana", lastName: "López" },
    clientId: "c-1",
    assignedToId: "tm-1",
    assignedTo: { id: "tm-1", displayName: "Marta García", avatarColor: "#AA0000" },
    assignees: [
      { id: "tm-2", displayName: "Luis", avatarColor: null },
      { id: "tm-1", displayName: "Marta García", avatarColor: "#AA0000" },
    ],
    reportedById: "tm-3",
    reportedBy: { id: "tm-3", displayName: "Rodrigo" },
    comments: [
      { authorId: "tm-1", authorName: "Marta", text: "Visto", at: "2026-08-04T10:00:00.000Z" },
    ],
    resolution: "Se movió la cita",
    verification: "parcial",
    resolvedAt: null,
    createdAt: "2026-08-04T09:00:00.000Z",
    updatedAt: "2026-08-04T10:30:00.000Z",
  };
}

describe("serializeIncidencia: la forma exacta que consume el frontend", () => {
  it("una fila completa sale con etiquetas, niveles, iniciales y color por defecto", () => {
    assert.deepEqual(serializeIncidencia(filaCompleta()), {
      id: "i-1",
      date: "2026-08-04",
      title: "Se solapan dos citas",
      description: "Detalle",
      category: "administrativa",
      categoryLabel: "Administrativa",
      subcategory: "Citas",
      status: "in_progress",
      statusLabel: "En proceso",
      statusLevel: "blue",
      priority: "high",
      priorityLabel: "Alta",
      patientId: "p-1",
      patient: { id: "p-1", name: "Ana López" },
      clientId: "c-1",
      assignedToId: "tm-1",
      assignedTo: { id: "tm-1", name: "Marta García", initials: "MG", color: "#AA0000" },
      assignees: [
        { id: "tm-2", name: "Luis", initials: "L", color: "#1B3A2D" },
        { id: "tm-1", name: "Marta García", initials: "MG", color: "#AA0000" },
      ],
      reportedById: "tm-3",
      reportedBy: { id: "tm-3", name: "Rodrigo", initials: "R", color: "#1B3A2D" },
      comments: [
        { authorId: "tm-1", authorName: "Marta", text: "Visto", at: "2026-08-04T10:00:00.000Z" },
      ],
      resolution: "Se movió la cita",
      verification: "parcial",
      verificationLabel: "Parcial",
      verificationLevel: "amber",
      resolvedAt: null,
      createdAt: "2026-08-04T09:00:00.000Z",
      updatedAt: "2026-08-04T10:30:00.000Z",
    });
  });

  it("acepta filas con toJSON (así llegan de los modelos) igual que objetos pelados", () => {
    const pelada = serializeIncidencia(filaCompleta());
    const conToJSON = serializeIncidencia({ toJSON: () => filaCompleta() });
    assert.deepEqual(conToJSON, pelada);
  });

  it("la pivote vacía cae al responsable legacy; sin nadie de nadie, lista vacía", () => {
    const sinPivote = { ...filaCompleta(), assignees: [] };
    assert.deepEqual(serializeIncidencia(sinPivote).assignees, [
      { id: "tm-1", name: "Marta García", initials: "MG", color: "#AA0000" },
    ]);
    const sinNadie = { ...filaCompleta(), assignees: [], assignedTo: null, assignedToId: null };
    assert.deepEqual(serializeIncidencia(sinNadie).assignees, []);
    assert.equal(serializeIncidencia(sinNadie).assignedTo, null);
  });

  it("una fila mínima rellena los huecos sin reventar: nulls, «—», nivel gris", () => {
    const s = serializeIncidencia({
      id: "i-2",
      title: "Pelada",
      category: "rara",
      status: "wat",
      priority: "low",
      comments: "no-array",
    });
    assert.equal(s.date, null);
    assert.equal(s.description, null);
    assert.equal(s.categoryLabel, "rara");
    assert.equal(s.statusLevel, "gray");
    assert.deepEqual(s.comments, []);
    assert.deepEqual(s.assignees, []);
    assert.equal(s.verificationLabel, null);
    assert.equal(s.verificationLevel, null);
    const conHuecos = serializeIncidencia({ ...filaCompleta(), comments: [{}] });
    assert.deepEqual(conHuecos.comments, [{ authorId: null, authorName: "—", text: "", at: null }]);
  });

  it("las iniciales: dos palabras dan dos letras, una da una, sin nombre «?»", () => {
    const con = (assignedTo) =>
      serializeIncidencia({ ...filaCompleta(), assignees: [], assignedTo }).assignees[0];
    assert.equal(con({ id: "x", displayName: "ana maría" }).initials, "AM");
    assert.equal(con({ id: "x", displayName: "ana" }).initials, "A");
    assert.equal(con({ id: "x", displayName: null }).initials, "?");
  });

  it("el paciente junta nombre y apellido, aguanta que falte uno y sin paciente es null", () => {
    const con = (patient) => serializeIncidencia({ ...filaCompleta(), patient }).patient;
    assert.deepEqual(con({ id: "p-9", firstName: "Ana", lastName: null }), {
      id: "p-9",
      name: "Ana",
    });
    assert.equal(con(null), null);
  });

  it("la fecha con la DATEONLY en texto no depende de la zona; con un Date, es el día UTC del instante", () => {
    // El camino real: la columna llega como 'AAAA-MM-DD' y se recorta tal cual.
    assert.equal(
      serializeIncidencia({ ...filaCompleta(), incidenceDate: "2026-08-04" }).date,
      "2026-08-04"
    );
    // Un instante con offset explícito da lo mismo en cualquier zona.
    assert.equal(
      serializeIncidencia({
        ...filaCompleta(),
        incidenceDate: new Date("2026-08-04T10:00:00+02:00"),
      }).date,
      "2026-08-04"
    );
    // SOSPECHOSO: el camino Date pasa por el día UTC. Una medianoche de Madrid
    // en verano (+02:00) serializa el día ANTERIOR. Hoy no muerde porque los
    // endpoints solo aceptan 'AAAA-MM-DD' (texto), pero quien pase un Date
    // local a este serializer verá la incidencia con un día menos.
    assert.equal(
      serializeIncidencia({
        ...filaCompleta(),
        incidenceDate: new Date("2026-08-04T00:00:00+02:00"),
      }).date,
      "2026-08-03"
    );
  });
});

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const U3 = "33333333-3333-4333-8333-333333333333";

describe("responsablesDe: del formulario a ids válidos, únicos y en orden", () => {
  it("assigneeIds: guarda el orden, quita duplicados y descarta lo que no es un uuid", () => {
    assert.deepEqual(responsablesDe({ assigneeIds: [U2, ` ${U1} `, U2, "abc", 42, null] }), [
      U2,
      U1,
    ]);
    assert.deepEqual(responsablesDe({ assigneeIds: [U1.toUpperCase()] }), [U1.toUpperCase()]);
  });

  it("sin assigneeIds cae al assignedToId de un solo responsable (clientes viejos de la API)", () => {
    assert.deepEqual(responsablesDe({ assignedToId: U1 }), [U1]);
  });

  it("un assigneeIds VACÍO gana al legacy: es «quitar a todos», no «no me han mandado la lista»", () => {
    assert.deepEqual(responsablesDe({ assigneeIds: [], assignedToId: U1 }), []);
  });

  it("sin cuerpo o sin nada dentro, lista vacía", () => {
    assert.deepEqual(responsablesDe(null), []);
    assert.deepEqual(responsablesDe({}), []);
    assert.deepEqual(responsablesDe({ assignedToId: "" }), []);
  });
});

/** Incidencia de mentira que apunta lo que le hacen. */
function incidenciaFalsa(asignadoInicial = null) {
  return {
    assignedToId: asignadoInicial,
    pivotes: [],
    cambios: [],
    async setAssignees(ids) {
      this.pivotes.push(ids);
    },
    async update(c) {
      this.cambios.push(c);
      Object.assign(this, c);
    },
  };
}

/** Modelos de mentira: la tabla de equipo solo «tiene» estos ids. */
function modelosFalsos(idsQueExisten) {
  const registro = { consultas: 0 };
  return {
    registro,
    TeamMember: {
      async findAll({ where }) {
        registro.consultas += 1;
        return idsQueExisten.filter((id) => where.id.includes(id)).map((id) => ({ id }));
      },
    },
  };
}

describe("sincronizarResponsables: la pivote queda como el formulario y el espejo apunta al primero", () => {
  it("respeta el orden del formulario y descarta los ids que no existen en el equipo", async () => {
    const inc = incidenciaFalsa(U1);
    const modelos = modelosFalsos([U1, U2]);
    const resultado = await sincronizarResponsables(inc, [U2, U3, U1], modelos);
    assert.deepEqual(resultado, [U2, U1]); // U3 no existe → fuera
    assert.deepEqual(inc.pivotes, [[U2, U1]]);
    assert.deepEqual(inc.cambios, [{ assignedToId: U2 }]); // el espejo pasa a ser el primero
  });

  it("si el espejo ya es el primero, no toca la fila", async () => {
    const inc = incidenciaFalsa(U2);
    await sincronizarResponsables(inc, [U2], modelosFalsos([U2]));
    assert.deepEqual(inc.pivotes, [[U2]]);
    assert.deepEqual(inc.cambios, []);
  });

  it("sin ids: vacía la pivote, pone el espejo a null y NI consulta la tabla de equipo", async () => {
    const inc = incidenciaFalsa(U1);
    const modelos = modelosFalsos([U1]);
    const resultado = await sincronizarResponsables(inc, [], modelos);
    assert.deepEqual(resultado, []);
    assert.deepEqual(inc.pivotes, [[]]);
    assert.deepEqual(inc.cambios, [{ assignedToId: null }]);
    assert.equal(modelos.registro.consultas, 0);
    // Y si ya estaba a null, tampoco escribe.
    const quieta = incidenciaFalsa(null);
    await sincronizarResponsables(quieta, [], modelosFalsos([]));
    assert.deepEqual(quieta.cambios, []);
  });
});

/* ═══ estadisticasExport ═══════════════════════════════════════════════════ */

/** El objeto que produce el cálculo de estadísticas, con los tres bloques. */
function statsCompletas() {
  return {
    desde: "2026-08-01",
    hasta: "2026-08-31",
    clinica: {
      pacientesActivos: 42,
      pacientesEnPausa: 3,
      altas: 5,
      bajas: 2,
      sesiones: 210,
      informes: 12,
      informesEntregados: 9,
      informesEnPlazoPct: 78,
      especialidades: [
        { label: "Logopedia", pacientes: 18 },
        { label: "Psicología", pacientes: 12 },
      ],
      terapeutas: [
        { therapistId: "t1", name: "Marta García", sesiones: 120, informes: 7 },
        { therapistId: "t2", name: "Luis Pérez", sesiones: 90, informes: 5 },
      ],
    },
    agenda: {
      total: 300,
      porEstado: [
        { estado: "pending", label: "Pendiente", citas: 10 },
        { estado: "confirmed", label: "Confirmada", citas: 40 },
        { estado: "completed", label: "Atendida", citas: 230 },
        { estado: "cancelled", label: "Cancelada", citas: 12 },
        { estado: "no_show", label: "No asistió", citas: 8 },
      ],
      faltas: 8,
      faltasJustificadas: 3,
      faltasSinJustificar: 5,
      tasaAusenciasPct: 3,
      profesionales: [
        {
          therapistId: "t1",
          name: "Marta García",
          citas: 200,
          atendidas: 180,
          faltas: 5,
          tasaAusenciasPct: 3,
        },
      ],
    },
    captacion: {
      leads: 20,
      leadsPorOrigen: [
        { origen: "web", leads: 12 },
        { origen: "sin origen", leads: 8 },
      ],
      clientesNuevos: 6,
      clientesPorOrigen: [{ origen: "Alta directa", clientes: 6 }],
      listaEspera: { enEspera: 4, convertidos: 2, esperaMediaDias: 11 },
    },
  };
}

async function abrirLibro(buffer) {
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(buffer);
  return libro;
}

function filasDe(hoja) {
  const filas = [];
  hoja.eachRow((fila) => filas.push(fila.values.slice(1)));
  return filas;
}

describe("buildEstadisticasXlsx: lo que se lleva a la reunión dice lo mismo que la pantalla", () => {
  it("con los tres bloques salen las cinco hojas, en este orden y con el creador del centro", async () => {
    const buffer = await buildEstadisticasXlsx(statsCompletas(), { tenantName: "Centro Prueba" });
    assert.ok(Buffer.isBuffer(buffer));
    const libro = await abrirLibro(buffer);
    assert.deepEqual(
      libro.worksheets.map((h) => h.name),
      ["Resumen", "Por terapeuta", "Agenda por profesional", "Captación", "Especialidades"]
    );
    assert.equal(libro.creator, "Centro Prueba");
  });

  it("la hoja Resumen lleva cada dato en su fila, celda a celda", async () => {
    const libro = await abrirLibro(await buildEstadisticasXlsx(statsCompletas(), {}));
    assert.deepEqual(filasDe(libro.getWorksheet("Resumen")), [
      ["Bloque", "Dato", "Valor"],
      ["Actividad clínica", "Pacientes activos", 42],
      ["Actividad clínica", "Pacientes en pausa", 3],
      ["Actividad clínica", "Altas del periodo", 5],
      ["Actividad clínica", "Bajas del periodo", 2],
      ["Actividad clínica", "Sesiones registradas", 210],
      ["Actividad clínica", "Informes del periodo", 12],
      ["Actividad clínica", "Informes entregados", 9],
      ["Actividad clínica", "Entregados en plazo (%)", "78"],
      ["Agenda", "Citas del periodo", 300],
      ["Agenda", "Pendiente", 10],
      ["Agenda", "Confirmada", 40],
      ["Agenda", "Atendida", 230],
      ["Agenda", "Cancelada", 12],
      ["Agenda", "No asistió", 8],
      ["Agenda", "Faltas justificadas", 3],
      ["Agenda", "Faltas sin justificar", 5],
      ["Agenda", "Tasa de ausencias (%)", "3"],
      ["Captación", "Leads nuevos", 20],
      ["Captación", "Clientes nuevos", 6],
      ["Captación", "En lista de espera", 4],
      ["Captación", "Convertidos desde la lista", 2],
      ["Captación", "Espera media (días)", "11"],
    ]);
  });

  it("las hojas de detalle llevan sus tablas y la cabecera va congelada", async () => {
    const libro = await abrirLibro(await buildEstadisticasXlsx(statsCompletas(), {}));
    assert.deepEqual(filasDe(libro.getWorksheet("Por terapeuta")), [
      ["Terapeuta", "Sesiones", "Informes"],
      ["Marta García", 120, 7],
      ["Luis Pérez", 90, 5],
    ]);
    assert.deepEqual(filasDe(libro.getWorksheet("Agenda por profesional")), [
      ["Profesional", "Citas", "Atendidas", "Faltas", "Ausencias (%)"],
      ["Marta García", 200, 180, 5, 3],
    ]);
    assert.deepEqual(filasDe(libro.getWorksheet("Captación")), [
      ["Origen", "Leads"],
      ["web", 12],
      ["sin origen", 8],
    ]);
    assert.deepEqual(filasDe(libro.getWorksheet("Especialidades")), [
      ["Especialidad", "Pacientes activos"],
      ["Logopedia", 18],
      ["Psicología", 12],
    ]);
    const vista = libro.getWorksheet("Resumen").views[0];
    assert.equal(vista.state, "frozen");
    assert.equal(vista.ySplit, 1);
  });

  it("un porcentaje null sale como «—» y un cero sale como cero (no son lo mismo)", async () => {
    const stats = {
      desde: "2026-01-01",
      hasta: "2026-01-31",
      clinica: {
        pacientesActivos: 0,
        pacientesEnPausa: 0,
        altas: 0,
        bajas: 0,
        sesiones: 0,
        informes: 0,
        informesEntregados: 0,
        informesEnPlazoPct: null,
        especialidades: [],
        terapeutas: [],
      },
      agenda: null,
      captacion: null,
    };
    const libro = await abrirLibro(await buildEstadisticasXlsx(stats, {}));
    // Con las listas vacías no se crean hojas de detalle.
    assert.deepEqual(
      libro.worksheets.map((h) => h.name),
      ["Resumen"]
    );
    const filas = filasDe(libro.getWorksheet("Resumen"));
    assert.deepEqual(filas[1], ["Actividad clínica", "Pacientes activos", 0]);
    assert.deepEqual(filas[8], ["Actividad clínica", "Entregados en plazo (%)", "—"]);
    assert.equal(filas.length, 9); // cabecera + las 8 del bloque clínico
  });

  it("sin ningún bloque (tenant sin esos módulos) queda un Resumen solo con cabecera, sin reventar", async () => {
    const stats = {
      desde: "2026-01-01",
      hasta: "2026-01-31",
      clinica: null,
      agenda: null,
      captacion: null,
    };
    const libro = await abrirLibro(await buildEstadisticasXlsx(stats, {}));
    assert.deepEqual(
      libro.worksheets.map((h) => h.name),
      ["Resumen"]
    );
    assert.deepEqual(filasDe(libro.getWorksheet("Resumen")), [["Bloque", "Dato", "Valor"]]);
    const sinNombre = await abrirLibro(await buildEstadisticasXlsx(stats, {}));
    assert.equal(sinNombre.creator, "CRM Salamandra");
  });
});

describe("buildEstadisticasPdf: el papel de la reunión sale del mismo objeto", () => {
  it("con los tres bloques devuelve un Buffer PDF de verdad", async () => {
    const buffer = await buildEstadisticasPdf(statsCompletas(), {
      tenantName: "Centro Prueba",
      brand: { primaryColor: "#124A55" },
    });
    assert.ok(Buffer.isBuffer(buffer));
    assert.equal(buffer.subarray(0, 5).toString("latin1"), "%PDF-");
    assert.ok(buffer.length > 1000, `un PDF con tablas no puede pesar ${buffer.length} bytes`);
  });

  it("sin ningún bloque también sale un PDF (solo cabecera y rango), en cualquier zona horaria", async () => {
    const stats = {
      desde: "2026-01-01",
      hasta: "2026-01-31",
      clinica: null,
      agenda: null,
      captacion: null,
    };
    const buffer = await buildEstadisticasPdf(stats, {});
    assert.equal(buffer.subarray(0, 5).toString("latin1"), "%PDF-");
  });

  it("un bloque clínico sin la lista de terapeutas REVIENTA en el PDF (el Excel lo tolera)", async () => {
    // SOSPECHOSO: buildEstadisticasXlsx pregunta con ?. (stats.clinica?.terapeutas?.length)
    // pero buildEstadisticasPdf lee stats.clinica.terapeutas.length a pelo (y lo
    // mismo con agenda.profesionales y captacion.leadsPorOrigen). Hoy no muerde
    // porque el productor siempre rellena esas listas, pero los dos formatos no
    // toleran la misma entrada. Esta prueba fija lo que DEVUELVE HOY: un rechazo.
    const stats = statsCompletas();
    delete stats.clinica.terapeutas;
    stats.agenda = null;
    stats.captacion = null;
    await assert.rejects(buildEstadisticasPdf(stats, {}), TypeError);
    const buffer = await buildEstadisticasXlsx(stats, {});
    assert.ok(Buffer.isBuffer(buffer)); // el Excel, con lo mismo, sale
  });
});
