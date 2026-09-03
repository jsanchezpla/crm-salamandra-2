// @vivo — Herramienta genérica: pone (o quita) la categoría externa —la empresa con acuerdo— a las fichas de cliente que se le digan. En seco por defecto.
/**
 * marcar-categoria-externa.js — etiqueta fichas de cliente con su empresa
 * (03/09/2026, Aumenta por Rodrigo: «apadrinados por la Fundación Adecco»).
 *
 * ── QUÉ HACE ────────────────────────────────────────────────────────────────
 * Escribe `clients.categoria_externa` en las fichas indicadas. Es la MISMA
 * etiqueta que pone la ficha desde «Consulta externa → Empresa»
 * (`components/clients/ClientConsultaExternaSection.jsx`), y solo eso:
 *
 *   · NO marca `es_consulta_externa`. Esa marca esconde la ficha a todo el
 *     equipo menos a su profesional y le quita el portal a la familia
 *     (lib/clients/consultaExterna.js). Un niño apadrinado por una fundación
 *     sigue siendo paciente del centro con su familia detrás: lo que cambia
 *     es a quién se le factura, y eso es la etiqueta.
 *   · La categoría es texto libre a propósito (`normalizarCategoria`), pero
 *     aquí se exige que esté en la lista del tenant
 *     (`settings.clientes.categoriasExternas`) salvo `--aunque-no-este`: un
 *     script no debería inventarse una empresa nueva por una errata.
 *
 * ── USO ─────────────────────────────────────────────────────────────────────
 *   node --env-file=.env.local scripts/marcar-categoria-externa.js <slug> \
 *        --categoria "Fundación Adecco" --cliente <uuid> --cliente <uuid>
 *   … --confirm           escribe (sin él, solo enseña)
 *   … --quitar            deja la categoría a NULL en esas fichas
 *   … --aunque-no-este    acepta una categoría que no está en Configuración
 *
 * En el VPS: docker exec crm-salamandra-app-1 node scripts/marcar-categoria-externa.js aumenta …
 */

import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { getTenantDb } from "../lib/db/tenantDb.js";
import { categoriasDe, normalizarCategoria } from "../lib/clients/consultaExterna.js";

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--") && !["--categoria", "--cliente"].includes(a)));
const [slug] = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--categoria" && argv[i - 1] !== "--cliente");
const valorDe = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const clientes = argv.map((a, i) => (a === "--cliente" ? argv[i + 1] : null)).filter(Boolean);
const confirm = flags.has("--confirm");
const quitar = flags.has("--quitar");

function die(msg) { process.stderr.write(`\n✗ ${msg}\n\n`); process.exit(1); }

if (!slug) die("Falta el slug.\n  Uso: scripts/marcar-categoria-externa.js <slug> --categoria \"Empresa\" --cliente <uuid> [--confirm]");
if (!clientes.length) die("Falta al menos un --cliente <uuid>.");
const categoria = quitar ? null : normalizarCategoria(valorDe("--categoria"));
if (!quitar && !categoria) die("Falta --categoria \"Nombre de la empresa\" (o --quitar).");

const master = getMasterDb();
const { Tenant } = getMasterModels();
const tenant = await Tenant.findOne({ where: { slug } });
if (!tenant) die(`No existe el tenant "${slug}"`);

if (categoria && !flags.has("--aunque-no-este")) {
  const lista = categoriasDe(tenant);
  const esta = lista.some((c) => c.toLocaleLowerCase("es") === categoria.toLocaleLowerCase("es"));
  if (!esta) die(`«${categoria}» no está en Configuración → Clientes → empresas de este centro (${lista.length ? lista.join(" · ") : "lista vacía"}). Añádela ahí, o --aunque-no-este.`);
}

const { sequelize, models } = getTenantDb(slug);
const { Client } = models;

process.stdout.write(`\n${slug} · categoría externa ${quitar ? "QUITAR" : `→ «${categoria}»`}${confirm ? "" : "  (EN SECO)"}\n\n`);

let cambios = 0;
for (const id of clientes) {
  const c = await Client.findByPk(id, { attributes: ["id", "name", "categoriaExterna", "esConsultaExterna"] });
  if (!c) { process.stdout.write(`  ✗ ${id}: no existe\n`); continue; }
  const antes = c.categoriaExterna ?? null;
  if (antes === categoria) { process.stdout.write(`  · ${c.name}: ya estaba ${categoria ? `en «${categoria}»` : "sin empresa"}\n`); continue; }
  process.stdout.write(`  ${confirm ? "✓" : "→"} ${c.name}: ${antes ? `«${antes}»` : "sin empresa"} → ${categoria ? `«${categoria}»` : "sin empresa"}${c.esConsultaExterna ? "  (ojo: es consulta externa)" : ""}\n`);
  if (confirm) await c.update({ categoriaExterna: categoria });
  cambios++;
}

process.stdout.write(`\n  ${confirm ? "Escritas" : "A escribir"}: ${cambios} de ${clientes.length}${confirm ? "" : " — relanza con --confirm"}\n\n`);
await sequelize.close();
await master.close();
