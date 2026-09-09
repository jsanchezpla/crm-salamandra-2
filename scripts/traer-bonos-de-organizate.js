/**
 * traer-bonos-de-organizate.js — los bonos de sesiones que vivían en Organízate
 * (09/09/2026, Aumenta: «los bonos abiertos de Organízate no se tienen en
 * cuenta en CRM»).
 *
 * ── QUÉ PASABA ─────────────────────────────────────────────────────────────
 * El volcado de la Caja trajo el DINERO de los bonos —«Bono cobrado en
 * Organízate el 01/09/2026 (Organízate #280…)»— pero no el bono. Así que en el
 * CRM había cinco cobros de bonos y ni un solo bono: las sesiones no
 * descontaban de nada y en la ficha no había nada que mirar. Una terapeuta lo
 * escribió en una cita: «es un bono pero de momento no funciona en la CRM para
 * asignar bonos».
 *
 * ── DE DÓNDE SALE EL DATO ──────────────────────────────────────────────────
 * De barrer `index.php?opcion=pacientes&vista=bonos_list&id_pac=N` en
 * Organízate, paciente a paciente (el JSON lo monta el navegador; ver
 * `docs/decisions/` y la memoria del volcado). Cada bono trae su código, su
 * nombre, «restantes/total», la caducidad y las sesiones ya gastadas.
 *
 * ⚠️ La columna de Organízate son las sesiones que QUEDAN, no las usadas: un
 * «0/5» es un bono AGOTADO, y son la mayoría (210 de 229). Confundirlo regalaría
 * cinco sesiones a cada paciente que tuvo un bono en 2024.
 *
 * ── CÓMO SE CUADRA LO YA GASTADO ───────────────────────────────────────────
 * En el CRM las sesiones gastadas se CUENTAN desde las citas. Pero estos bonos
 * se gastaron en citas de 2023, 2024 y 2025 y el CRM solo tiene la agenda de
 * 2026 en adelante: contándolas saldrían todos enteros. Por eso lo ya gastado
 * viaja como número en el propio bono (`session_packs.sesiones_previas`), y de
 * hoy en adelante se sigue contando desde las citas, como siempre.
 *
 * ── LO QUE NO HACE ─────────────────────────────────────────────────────────
 * **No crea ni un cobro.** El dinero de estos bonos ya está en el CRM, traído
 * por el volcado de la Caja; apuntarlo otra vez sería cobrar dos veces. Lo que
 * sí hace es ATAR el cobro que ya existe a su bono (`payments.pack_id`) cuando
 * la nota lleva su «Organízate #código».
 *
 * Idempotente por el código de Organízate, que queda escrito en la nota del
 * bono. En seco por defecto.
 *
 * Uso VPS:
 *   docker cp organizate-bonos-2026-09-09.json crm-salamandra-app-1:/tmp/
 *   docker exec -w /app crm-salamandra-app-1 node scripts/traer-bonos-de-organizate.js \
 *     /tmp/organizate-bonos-2026-09-09.json --pacientes /tmp/pacientes-limpio.json [--slug aumenta] [--confirm] [--detalle]
 */

import { readFileSync } from "node:fs";
import { Op } from "sequelize";
import { getTenantDb } from "../lib/db/tenantDb.js";

const args = process.argv.slice(2);
const confirmar = args.includes("--confirm");
const detalle = args.includes("--detalle");
const valorDe = (flag, pd) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : pd);
const SLUG = valorDe("--slug", "aumenta");
const RUTA_PACIENTES = valorDe("--pacientes", null);
const RUTA = args.find((a) => !a.startsWith("--") && a.endsWith(".json") && a !== RUTA_PACIENTES);

const log = (m) => process.stdout.write(`  ${m}\n`);

/** Nombres comparables: sin tildes, sin dobles espacios, en minúsculas. */
const norm = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/**
 * El tipo de cita del CRM al que pertenece un bono.
 *
 * Primero por las sesiones que ya gastó: ahí Organízate escribe el nombre del
 * curso, que es EXACTAMENTE el nombre del tipo de cita del CRM (los 57 tipos
 * salieron de ese mismo volcado). Solo cuando el bono está sin estrenar hay que
 * deducirlo del nombre del bono, que es donde se puede fallar.
 */
function tipoDelBono(bono, porNombre) {
  for (const u of bono.usadas ?? []) {
    const t = porNombre.get(norm(u.tipo));
    if (t) return { tipo: t, como: "por sus sesiones" };
  }
  const n = norm(bono.bono);
  const minutos = /1 hora/.test(n) ? "60" : "45";
  const familia = /psicolog/.test(n) ? "PSICOLOGIA"
    : /logopedia/.test(n) ? "LOGOPEDIA"
    : /pedagog/.test(n) ? "PEDAGOGIA"
    : /t\.?\s*o\.?|ocupacional/.test(n) ? "TERAPIA OCUPACIONAL"
    : /fisioterapia/.test(n) ? "CUOTA FISIOTERAPIA"
    : null;
  if (!familia) return { tipo: null, como: "sin familia reconocible" };
  const t = porNombre.get(norm(`${familia} ${minutos}`));
  return { tipo: t ?? null, como: t ? "por el nombre del bono" : `no existe «${familia} ${minutos}»` };
}

/** Lo que costó el bono, en céntimos. 200 € los de 45 min, 250 € los de 1 hora. */
function importeDelBono(bono) {
  return /1 hora/.test(norm(bono.bono)) ? 25000 : 20000;
}

/** 'dd/mm/yy HH:MM' o 'dd/mm/yy' de Organízate → Date, o null. */
function fechaOrganizate(txt) {
  const m = String(txt ?? "").match(/^(\d{2})\/(\d{2})\/(\d{2})(?:\s+(\d{2}):(\d{2}))?/);
  if (!m) return null;
  const [, d, mes, a, hh, mm] = m;
  const d2 = new Date(Date.UTC(2000 + Number(a), Number(mes) - 1, Number(d), Number(hh ?? 12), Number(mm ?? 0)));
  return Number.isNaN(d2.getTime()) ? null : d2;
}

/** Cuándo se compró: la primera sesión que gastó; si está sin estrenar, su caducidad. */
function compradoEl(bono) {
  const fechas = (bono.usadas ?? []).map((u) => fechaOrganizate(u.cuando)).filter(Boolean);
  if (fechas.length) return new Date(Math.min(...fechas.map((f) => f.getTime())));
  return fechaOrganizate(bono.caducidad) ?? new Date();
}

async function main() {
  if (!RUTA) throw new Error("Falta el JSON de bonos. Ver la cabecera.");
  process.stdout.write(`\n▶ Bonos de Organízate → ${SLUG}${confirmar ? "" : "  (EN SECO)"}\n\n`);

  const doc = JSON.parse(readFileSync(RUTA, "utf8"));
  const fichas = Array.isArray(doc.fichas) ? doc.fichas : [];
  log(`JSON: ${fichas.length} pacientes con bonos, ${doc.bonos ?? "?"} bonos (extraído ${String(doc.extraido).slice(0, 10)})`);

  // id_pac de Organízate → nombre. El volcado de fichas del 01/08/2026.
  const nombrePorId = new Map();
  if (RUTA_PACIENTES) {
    const pac = JSON.parse(readFileSync(RUTA_PACIENTES, "utf8"));
    for (const f of pac.fichas ?? []) {
      nombrePorId.set(Number(f.id_pac), norm(`${f.nombre ?? ""} ${f.apellidos ?? ""}`));
    }
    log(`Fichas de Organízate: ${nombrePorId.size}`);
  }

  const { models } = getTenantDb(SLUG);
  const { Patient, EventType, SessionPack, Payment } = models;
  if (!SessionPack) throw new Error(`${SLUG} no tiene bonos de sesiones`);

  const pacientes = await Patient.findAll({ attributes: ["id", "clientId", "firstName", "lastName"], raw: true });
  const pacientePorNombre = new Map();
  for (const p of pacientes) {
    const clave = norm(`${p.firstName ?? ""} ${p.lastName ?? ""}`);
    // Un nombre repetido no sirve para identificar a nadie: se aparta.
    if (pacientePorNombre.has(clave)) pacientePorNombre.set(clave, "ambiguo");
    else pacientePorNombre.set(clave, p);
  }

  const tipos = await EventType.findAll({ attributes: ["id", "name"], raw: true });
  const tipoPorNombre = new Map(tipos.map((t) => [norm(t.name), t]));

  // Lo que ya se trajo: el código de Organízate vive en la nota del bono.
  const yaHay = await SessionPack.findAll({ where: { notes: { [Op.iLike]: "%Organízate #%" } }, attributes: ["id", "notes"], raw: true });
  const codigosHechos = new Set(
    yaHay.map((p) => Number(String(p.notes).match(/Organ[íi]zate #(\d+)/)?.[1])).filter(Boolean)
  );
  if (codigosHechos.size) log(`Ya traídos antes: ${codigosHechos.size}`);

  const problemas = [];
  const aCrear = [];
  for (const ficha of fichas) {
    const nombreOrg = nombrePorId.get(Number(ficha.id_pac));
    const paciente = nombreOrg ? pacientePorNombre.get(nombreOrg) : null;
    for (const bono of ficha.bonos ?? []) {
      if (codigosHechos.has(Number(bono.codigo))) continue;
      if (!nombreOrg) { problemas.push({ cod: bono.codigo, motivo: `el paciente ${ficha.id_pac} no está en el volcado de fichas` }); continue; }
      if (!paciente) { problemas.push({ cod: bono.codigo, motivo: "no hay paciente con ese nombre en el CRM" }); continue; }
      if (paciente === "ambiguo") { problemas.push({ cod: bono.codigo, motivo: "hay dos pacientes con ese nombre" }); continue; }
      const { tipo, como } = tipoDelBono(bono, tipoPorNombre);
      if (!tipo) { problemas.push({ cod: bono.codigo, motivo: `sin tipo de cita (${como})` }); continue; }

      const total = Number(bono.total) || 0;
      const restantes = Number(bono.restantes);
      if (!(total > 0) || !Number.isFinite(restantes)) { problemas.push({ cod: bono.codigo, motivo: `sesiones ilegibles («${bono.restantes}/${bono.total}»)` }); continue; }
      const previas = Math.max(0, Math.min(total, total - restantes));

      aCrear.push({
        codigo: Number(bono.codigo),
        patientId: paciente.id,
        clientId: paciente.clientId ?? null,
        eventTypeId: tipo.id,
        tipoNombre: tipo.name,
        como,
        totalSessions: total,
        sesionesPrevias: previas,
        amount: importeDelBono(bono),
        purchasedAt: compradoEl(bono),
        notes:
          `Bono de Organízate #${bono.codigo} · ${bono.bono} · caduca el ${bono.caducidad}` +
          (previas ? ` · ${previas} de ${total} sesiones ya gastadas al traerlo (09/09/2026)` : " · sin estrenar al traerlo (09/09/2026)"),
      });
    }
  }

  const abiertos = aCrear.filter((b) => b.sesionesPrevias < b.totalSessions);
  log(`\nA crear: ${aCrear.length} bonos · ${abiertos.length} con sesiones libres · ${problemas.length} que no se pueden`);
  if (detalle) {
    for (const b of abiertos) log(`  + #${b.codigo} · ${b.tipoNombre} · ${b.totalSessions - b.sesionesPrevias} de ${b.totalSessions} libres (${b.como})`);
    for (const p of problemas) log(`  ✗ #${p.cod}: ${p.motivo}`);
  }

  if (!confirmar) {
    process.stdout.write("\n(en seco: repite con --confirm para escribir)\n\n");
    return;
  }

  let creados = 0;
  let cobrosAtados = 0;
  for (const b of aCrear) {
    const pack = await SessionPack.create({
      clientEmail: null,
      clientId: b.clientId,
      patientId: b.patientId,
      eventTypeId: b.eventTypeId,
      totalSessions: b.totalSessions,
      sesionesPrevias: b.sesionesPrevias,
      pricingMode: "upfront",
      amount: b.amount,
      paymentSessionId: null,
      origin: "manual",
      createdBy: "Volcado de Organízate",
      purchasedAt: b.purchasedAt,
      status: "active",
      notes: b.notes,
    });
    creados++;
    /*
     * El cobro que ya trajo el volcado de la Caja, atado a su bono. No se crea
     * ninguno: el dinero ya está apuntado y apuntarlo otra vez sería cobrarlo
     * dos veces.
     */
    if (Payment) {
      const [n] = await Payment.update(
        { packId: pack.id },
        { where: { packId: null, notes: { [Op.iLike]: `%Organízate #${b.codigo}%` } } }
      );
      cobrosAtados += n;
    }
  }
  log(`\n✓ ${creados} bonos creados · ${cobrosAtados} cobros atados a su bono`);
  process.stdout.write("\n");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    process.stderr.write(`\n✗ ${e.message}\n${e.stack}\n`);
    process.exit(1);
  });
