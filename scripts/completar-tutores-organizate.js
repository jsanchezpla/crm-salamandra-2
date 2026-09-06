// @vivo — Completa los tutores (`Client.guardians`) con la pestaña Tutores de Organízate: añade los que faltan y rellena los huecos, sin pisar nunca un dato distinto. Se usó en aumenta el 04/09/2026 y se repite si el centro sigue tocando fichas allí.
/**
 * completar-tutores-organizate.js — los padres que faltaban (04/09/2026).
 *
 * ⚠️ SIMULA POR DEFECTO. Sin `--confirm` no escribe nada.
 *
 * Rodrigo (04/09): «faltan datos de muchos tutores. Cada paciente tiene una
 * pestaña de Tutores con los datos de los padres y sus mails, y en muchas
 * ocasiones o no has cogido los datos o has cogido solo uno».
 *
 * Era verdad: de 1.090 familias, 123 no tenían ningún tutor, 154 tenían uno
 * solo y 308 tenían algún tutor sin correo. El correo del tutor es con lo que
 * la familia entra al portal y por donde le llegan los avisos, así que un
 * tutor sin correo es una familia incomunicada.
 *
 * ── Qué entra ─────────────────────────────────────────────────────────────
 * El JSON que deja la lectura de las fichas de Organízate (pestaña Tutores):
 *   { "<id_pac>": { id, nombre, apellidos, tel, email,
 *                   tutores: [{ etiqueta, nombre, apellidos, dni, telefono, email }] } }
 *
 * ── La regla: se AÑADE y se RELLENA, nunca se pisa ────────────────────────
 * Cada tutor de Organízate se busca entre los del CRM por DNI y, si no lo hay,
 * por nombre completo normalizado.
 *
 *   · No está        → se añade entero.
 *   · Está y al CRM le falta un dato (correo, teléfono, DNI, parentesco)
 *                    → se rellena ese hueco.
 *   · Está y el dato del CRM es DISTINTO → no se toca y se cuenta como
 *     conflicto. En el CRM puede haber una corrección hecha a mano por el
 *     centro, y Organízate ya no es la fuente: desde el 03/09 trabajan aquí.
 *
 * El `email`/`phone` del propio cliente se rellena solo si está vacío, con el
 * del tutor de contacto (el primero que tenga correo).
 *
 * Uso:
 *   docker exec crm-salamandra-app-1 node scripts/completar-tutores-organizate.js /tmp/tutores-organizate.json [--slug aumenta] [--confirm] [--detalle]
 */
import { readFileSync } from "node:fs";
import { getTenantDb } from "../lib/db/tenantDb.js";
import { getMasterModels } from "../lib/db/masterDb.js";
import { normalizeGuardians } from "../lib/clients/guardians.js";
import { auditar } from "../lib/utils/auditoria.js";

const args = process.argv.slice(2);
const CONFIRM = args.includes("--confirm");
const DETALLE = args.includes("--detalle");
const valorDe = (f, d) => (args.includes(f) ? args[args.indexOf(f) + 1] : d);
const SLUG = valorDe("--slug", "aumenta");
const RUTA = args.find((a) => !a.startsWith("--") && a !== SLUG);
if (!RUTA) { process.stderr.write("Uso: node scripts/completar-tutores-organizate.js <tutores.json> [--slug] [--confirm] [--detalle]\n"); process.exit(1); }

const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
const limpio = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const dniOk = (s) => limpio(s).toUpperCase().replace(/[^0-9A-Z]/g, "");
/** «Madre», «PADRE», «Abuela»… → lo que entiende el CRM. */
const parentesco = (etiqueta) => {
  const e = norm(etiqueta);
  if (e.startsWith("MADRE")) return "madre";
  if (e.startsWith("PADRE")) return "padre";
  if (!e) return "tutor";
  return e.includes("TUTOR") ? "tutor" : "otro";
};
const correoValido = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(limpio(s));

/** Fichas dobles del origen: sus tutores son de la ficha que se conservó. */
const DOBLES = { 122: 121, 250: 249, 372: 371, 167: 166 };

/**
 * Nombres que no son un nombre: en las dos partes hay tutores apuntados como
 * «PADRE», «MADRE» o «ADULTO». En el CRM son un hueco que hay que rellenar con
 * el nombre de verdad; en Organízate no aportan nada y no se traen (el propio
 * paciente adulto no es tutor de sí mismo).
 */
const GENERICOS = new Set(["PADRE", "MADRE", "TUTOR", "TUTORA", "TUTOR LEGAL", "PADRES", "ADULTO", "ADULTA", "PACIENTE", "PAPA", "MAMA"]);
const esGenerico = (n) => GENERICOS.has(norm(n));

async function main() {
  const datos = JSON.parse(readFileSync(RUTA, "utf8"));
  const { models, sequelize } = getTenantDb(SLUG);
  const { Client, Patient } = models;

  const pacientes = await Patient.findAll({ attributes: ["id", "clientId", "firstName", "lastName"], raw: true });
  // Un nombre que se repite en dos familias distintas NO cruza (revisión del
  // 06/09/2026): hasta hoy ganaba el primero y los tutores de la segunda ficha
  // de Organízate se colgaban de la familia equivocada sin decir nada.
  const clientePorNombre = new Map();
  const repetidos = new Set();
  for (const p of pacientes) {
    const k = norm(`${p.firstName ?? ""} ${p.lastName ?? ""}`);
    if (!k) continue;
    const ya = clientePorNombre.get(k);
    if (ya && ya !== String(p.clientId)) repetidos.add(k);
    if (!ya) clientePorNombre.set(k, String(p.clientId));
  }
  for (const k of repetidos) clientePorNombre.delete(k);
  const clientes = await Client.findAll({ attributes: ["id", "name", "email", "phone", "guardians"] });
  const porId = new Map(clientes.map((c) => [String(c.id), c]));

  const plan = new Map();   // clienteId → { cliente, guardians, añadidos, rellenos, conflictos, contacto }
  const sinCruce = [];
  let fichas = 0, tutoresLeidos = 0;

  for (const ficha of Object.values(datos)) {
    if (!ficha || !Array.isArray(ficha.tutores)) continue;
    fichas++;
    // Una ficha doble aporta sus tutores a la ficha que se conservó.
    const idReal = DOBLES[Number(ficha.id)] ?? Number(ficha.id);
    const nombreFicha = idReal === Number(ficha.id)
      ? `${ficha.nombre ?? ""} ${ficha.apellidos ?? ""}`
      : `${datos[idReal]?.nombre ?? ficha.nombre ?? ""} ${datos[idReal]?.apellidos ?? ficha.apellidos ?? ""}`;
    const clienteId = clientePorNombre.get(norm(nombreFicha));
    const cliente = clienteId ? porId.get(clienteId) : null;
    if (!cliente) {
      sinCruce.push({
        id: ficha.id,
        nombre: limpio(nombreFicha),
        motivo: repetidos.has(norm(nombreFicha)) ? "nombre repetido en dos familias del CRM" : "sin paciente con ese nombre",
      });
      continue;
    }

    if (!plan.has(clienteId)) {
      plan.set(clienteId, {
        cliente,
        guardians: (Array.isArray(cliente.guardians) ? cliente.guardians : []).map((g) => ({ ...g })),
        anadidos: [], rellenos: [], conflictos: [], ignorados: [],
      });
    }
    const p = plan.get(clienteId);

    for (const t of ficha.tutores) {
      const nombreCompleto = limpio(`${t.nombre ?? ""} ${t.apellidos ?? ""}`);
      if (!nombreCompleto) continue;
      tutoresLeidos++;
      const dni = dniOk(t.dni);
      const email = limpio(t.email).toLowerCase();
      const tel = limpio(t.telefono);
      const rel = parentesco(t.etiqueta);

      // «ADULTO», «PACIENTE»…: no es un tutor, es el propio paciente.
      if (esGenerico(nombreCompleto)) { p.ignorados.push(nombreCompleto); continue; }

      let g = p.guardians.find((x) => dni && dniOk(x.dni) === dni)
           ?? p.guardians.find((x) => norm(x.name) === norm(nombreCompleto));
      // El CRM puede tener el tutor apuntado como «PADRE» a secas: es el mismo
      // que el de Organízate si coincide el parentesco. Se le pone su nombre.
      if (!g && rel !== "tutor") {
        const generico = p.guardians.find((x) => esGenerico(x.name) && (x.relationship === rel || norm(x.name) === norm(rel)));
        if (generico) {
          p.rellenos.push(`${limpio(generico.name)} → ${nombreCompleto}: nombre`);
          generico.name = nombreCompleto;
          g = generico;
        }
      }
      if (!g) {
        p.guardians.push({ name: nombreCompleto, relationship: rel, dni: dni || null, phone: tel || null, email: correoValido(email) ? email : null });
        p.anadidos.push(nombreCompleto);
        continue;
      }
      // Rellenar huecos, nunca pisar
      // Un teléfono con guiones y otro sin ellos son el mismo teléfono: se
      // comparan solo los dígitos, o saldrían conflictos que no lo son.
      const iguales = (campo, a, b) => (campo === "phone" ? a.replace(/\D/g, "") === b.replace(/\D/g, "") : norm(a) === norm(b));
      const hueco = (campo, valor, valido = true) => {
        if (!valor || !valido) return;
        const actual = limpio(g[campo]);
        if (!actual) { g[campo] = valor; p.rellenos.push(`${nombreCompleto}: ${campo}`); }
        else if (!iguales(campo, actual, valor)) p.conflictos.push({ quien: nombreCompleto, campo, crm: actual, organizate: valor });
      };
      hueco("email", email, correoValido(email));
      hueco("phone", tel);
      hueco("dni", dni);
      if (rel !== "tutor" && (!g.relationship || g.relationship === "tutor")) {
        g.relationship = rel;
        p.rellenos.push(`${nombreCompleto}: parentesco`);
      }
    }
  }

  // ── Informe ──────────────────────────────────────────────────────────────
  const conCambios = [...plan.values()].filter((p) => p.anadidos.length || p.rellenos.length);
  const nAnadidos = conCambios.reduce((s, p) => s + p.anadidos.length, 0);
  const nRellenos = conCambios.reduce((s, p) => s + p.rellenos.length, 0);
  const conflictos = [...plan.values()].flatMap((p) => p.conflictos);
  const w = (s) => process.stdout.write(s);
  w(`\n▶ Tutores de Organízate → ${SLUG}${CONFIRM ? "" : "  (ENSAYO: no se escribe nada)"}\n`);
  w(`  fichas leídas: ${fichas} · tutores en ellas: ${tutoresLeidos} · familias tocadas: ${conCambios.length}\n\n`);
  w(`  Tutores que se AÑADEN            ${String(nAnadidos).padStart(5)}\n`);
  w(`  Huecos que se RELLENAN           ${String(nRellenos).padStart(5)}\n`);
  w(`  Conflictos (no se tocan)         ${String(conflictos.length).padStart(5)}\n`);
  w(`  «ADULTO»/«PACIENTE» que no se traen ${String([...plan.values()].reduce((s, p) => s + p.ignorados.length, 0)).padStart(2)}\n`);
  w(`  Fichas sin cruzar con el CRM     ${String(sinCruce.length).padStart(5)}\n\n`);
  const porCampo = {};
  conCambios.flatMap((p) => p.rellenos).forEach((r) => { const c = r.split(": ")[1]; porCampo[c] = (porCampo[c] ?? 0) + 1; });
  w(`  Huecos por campo: ${Object.entries(porCampo).map(([k, v]) => `${k} ${v}`).join(" · ") || "(ninguno)"}\n`);
  if (DETALLE && conflictos.length) {
    w(`\n  Conflictos (el CRM manda, no se tocan):\n`);
    for (const c of conflictos.slice(0, 25)) w(`     ${c.campo.padEnd(6)} CRM «${c.crm.slice(0, 34)}» · Organízate «${c.organizate.slice(0, 34)}»\n`);
  }
  if (DETALLE && sinCruce.length) {
    w(`\n  Sin cruzar (id de Organízate):\n     ${sinCruce.slice(0, 30).map((x) => x.id).join(", ")}\n`);
  }
  if (!CONFIRM) { w("\n  ENSAYO: no se ha escrito nada. Con --confirm se ejecuta.\n\n"); process.exit(0); }

  // ── Escribir ─────────────────────────────────────────────────────────────
  const { Tenant } = getMasterModels();
  const tenant = await Tenant.findOne({ where: { slug: SLUG }, attributes: ["id"] });
  let tocados = 0, contactos = 0;
  for (const p of conCambios) {
    const antes = Array.isArray(p.cliente.guardians) ? p.cliente.guardians.length : 0;
    const guardians = normalizeGuardians(p.guardians);
    const cambios = { guardians };
    // El contacto del cliente, solo si está vacío.
    if (!limpio(p.cliente.email)) {
      const conCorreo = guardians.find((g) => correoValido(g.email));
      if (conCorreo) { cambios.email = conCorreo.email; contactos++; }
    }
    if (!limpio(p.cliente.phone)) {
      const conTel = guardians.find((g) => limpio(g.phone));
      if (conTel) cambios.phone = limpio(conTel.phone);
    }
    await p.cliente.update(cambios);
    await auditar({
      tenantId: tenant?.id ?? null,
      userId: null,
      action: "client.updated",
      entity: "Client",
      entityId: p.cliente.id,
      before: { tutores: antes },
      after: { tutores: guardians.length, anadidos: p.anadidos.length, rellenos: p.rellenos.length, via: "script:completar-tutores-organizate" },
      ip: null,
    }).catch(() => {});
    tocados++;
  }
  w(`\n  ✓ familias actualizadas ${tocados} · tutores añadidos ${nAnadidos} · huecos rellenados ${nRellenos} · contacto del cliente puesto ${contactos}\n\n`);
  process.exit(0);
}

main().catch((err) => { process.stderr.write(`\n✗ ${err.message}\n${err.stack}\n`); process.exit(1); });
