// Pruebas del módulo de análisis sin servidor ni API key.
// Uso: node scripts/_outreach-ai-unit.mjs
import { buildSystemPrompt, buildUserMessage } from "../lib/outreach/analysis/prompt.js";
import { parseAnalysis } from "../lib/outreach/analysis/schema.js";
import { analyzeLead } from "../lib/outreach/analysis/index.js";
import { normalizeCompany } from "../lib/outreach/scraping.js";

let fails = 0;
function check(name, cond, extra = "") {
  if (cond) console.log(`✓ ${name}`);
  else { fails++; console.log(`✗ ${name} ${extra}`); }
}

const LINES = [
  { key: "solutions", name: "Solutions", description: "Webs y apps", scoringUp: ["Sin web"], scoringDown: ["Web moderna"], active: true },
  { key: "agencia", name: "Agencia", description: "Social media", scoringUp: ["Redes flojas"], scoringDown: ["Otra agencia"], active: true },
  { key: "vieja", name: "Vieja", description: "x", scoringUp: [], scoringDown: [], active: false },
];
const LEAD = { name: "Bar Paco", sector: "Bares", location: "Ávila", website: null, phone: null, email: null, source: "google_maps", rawData: { redes: {} } };

// ── Prompt ────────────────────────────────────────────────────────────────
const sys = buildSystemPrompt({
  companyName: "Acme SL",
  companyContext: "Acme hace cosas.",
  businessLines: LINES.filter((l) => l.active),
  chainingRule: "Si A sube, B sube.",
});
check("el prompt usa el nombre del tenant, no 'Salamandra'", sys.includes("Acme SL") && !sys.includes("Salamandra"));
check("el prompt incluye cada línea con su clave JSON", sys.includes('[clave JSON: "solutions"]') && sys.includes('[clave JSON: "agencia"]'));
check("el prompt incluye los criterios de scoring", sys.includes("Sin web") && sys.includes("Redes flojas"));
check("el prompt incluye la regla de encadenamiento", sys.includes("Si A sube, B sube."));
check("la forma del JSON tiene una clave por línea", sys.includes('{"solutions":{"score"') && sys.includes('"agencia":{"score"'));
check("el prompt prohíbe inventar datos", sys.includes("NO lo inventes"));

const sysSinRegla = buildSystemPrompt({ companyName: "X", businessLines: [LINES[0]] });
check("sin regla de encadenamiento no aparece la sección", !sysSinRegla.includes("RELACIÓN ENTRE LÍNEAS"));

try {
  buildSystemPrompt({ companyName: "X", businessLines: [] });
  check("sin líneas activas lanza error", false);
} catch { check("sin líneas activas lanza error", true); }

const usr = buildUserMessage(LEAD);
check("el mensaje de usuario lleva los datos scrapeados", usr.includes("Bar Paco") && usr.includes("datos_scrapeados"));

// ── Parseo y normalización ────────────────────────────────────────────────
const active = LINES.filter((l) => l.active);
const good = JSON.stringify({
  solutions: { score: 150, reason_why: "  x  ", necesidades: ["a", "", "b"], pitch: "p", correo: { asunto: "s", cuerpo: "b" } },
  agencia: { score: -5, reason_why: 1, necesidades: "no-lista", pitch: null, correo: null },
  fantasma: { score: 99 },
});
const parsed = parseAnalysis(good, active);
check("acota el score por arriba (150 → 100)", parsed.solutions.score === 100);
check("acota el score por abajo (-5 → 0)", parsed.agencia.score === 0);
check("limpia strings y filtra vacíos", parsed.solutions.reasonWhy === "x" && parsed.solutions.needs.length === 2);
check("normaliza tipos raros sin romper", parsed.agencia.reasonWhy === "" && Array.isArray(parsed.agencia.needs) && parsed.agencia.needs.length === 0);
check("mapea correo → emailDraft {subject, body}", parsed.solutions.emailDraft.subject === "s" && parsed.solutions.emailDraft.body === "b");
check("el correo ausente sale vacío, no null", parsed.agencia.emailDraft.subject === "" && parsed.agencia.emailDraft.body === "");
check("ignora líneas que el modelo se inventa", !("fantasma" in parsed));

const fenced = parseAnalysis('```json\n{"solutions":{"score":50}}\n```', active);
check("quita las vallas de markdown", fenced.solutions.score === 50);
check("rellena la línea que el modelo omite", fenced.agencia.score === 0);

try { parseAnalysis("no soy json", active); check("JSON inválido lanza error", false); }
catch (e) { check("JSON inválido lanza error", e.message.includes("JSON válido")); }

// ── analyzeLead con proveedor inyectado ───────────────────────────────────
let captured = null;
const res = await analyzeLead({
  lead: LEAD,
  businessLines: LINES, // incluye la inactiva
  settings: { aiModel: "claude-sonnet-5" },
  companyName: "Acme SL",
  complete: async (args) => {
    captured = args;
    return JSON.stringify({ solutions: { score: 70 }, agencia: { score: 30 } });
  },
});
check("descarta las líneas inactivas", captured.businessLines.length === 2);
check("respeta el modelo de los ajustes", res.model === "claude-sonnet-5");
check("devuelve un bloque por línea activa", Object.keys(res.results).join(",") === "solutions,agencia");
check("max_tokens escala con el nº de líneas", captured.maxTokens === 2000 + 2 * 2500);

const res2 = await analyzeLead({
  lead: LEAD, businessLines: active, settings: { aiModel: "gpt-4o" }, companyName: "X",
  complete: async () => JSON.stringify({ solutions: {}, agencia: {} }),
});
check("un modelo no admitido cae al de por defecto", res2.model === "claude-opus-4-8");

try {
  await analyzeLead({ lead: LEAD, businessLines: [], settings: {}, companyName: "X", complete: async () => "{}" });
  check("sin líneas activas analyzeLead lanza NO_BUSINESS_LINES", false);
} catch (e) { check("sin líneas activas analyzeLead lanza NO_BUSINESS_LINES", e.code === "NO_BUSINESS_LINES"); }

// ── Normalización del scraping ────────────────────────────────────────────
const c1 = normalizeCompany({ nombre: " Bar Paco ", direccion: "Ávila", web: "http://x.es", extra: 1 }, "google_maps");
check("scraping: mapea alias en español", c1.name === "Bar Paco" && c1.location === "Ávila" && c1.website === "http://x.es");
check("scraping: aplica la fuente por defecto", c1.source === "google_maps");
check("scraping: conserva lo no mapeado en rawData", c1.rawData.extra === 1);
const c2 = normalizeCompany({ title: "Otro", source: "linkedin" }, "google_maps");
check("scraping: la fuente del item gana a la de por defecto", c2.source === "linkedin");
const c3 = normalizeCompany({}, null);
check("scraping: sin nombre devuelve null (el endpoint lo descarta)", c3.name === null && c3.source === "manual");

console.log(fails === 0 ? `\n✓ Todas las comprobaciones pasan` : `\n✗ ${fails} fallos`);
process.exit(fails === 0 ? 0 : 1);
