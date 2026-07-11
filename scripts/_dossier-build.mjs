// Ensamblador del dossier comercial → dossier.html (16:9, 1280x720 por slide).
// Lee el copy de módulos generado por el workflow (content.json) y lo combina con
// el contenido hecho a mano (portadas, índice, Facturación, Documentos, Incidencias, bloque IA).
// Uso: node scripts/_dossier-build.mjs <content.json> <salida.html>
import fs from "node:fs";

const contentPath = process.argv[2];
const outPath = process.argv[3];
const fromWorkflow = JSON.parse(fs.readFileSync(contentPath, "utf8"));

// ---------- helpers ----------
const esc = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const md = (s = "") => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/→/g, "→");
const chip = (n, l) => `<span class="c"><b>${esc(n)}</b> ${esc(l)}</span>`;
// claim corto para la portada: 1 frase (o 2 si la primera es breve)
function shortClaim(claim = "") {
  const parts = claim.split(/(?<=\.)\s+/).filter(Boolean);
  let out = parts[0] || "";
  if (out.length < 125 && parts[1]) out += " " + parts[1];
  return out.trim();
}

// ---------- contenido hecho a mano (Facturación, Documentos, Incidencias) ----------
const HAND = {
  facturacion: {
    claim: "Del presupuesto al cobro, con el IVA y el IRPF calculados por el sistema y cada factura y gasto atribuidos a su empleado. Las cuentas de la empresa siempre cuadradas, sin hojas de cálculo aparte.",
    headline: "Del presupuesto al cobro, sin descuadres",
    bullets: [
      { bold: "Presupuestos", rest: "con ciclo de vida (borrador · enviado · visto · aceptado) y conversión a factura en un clic, heredando cliente, líneas e IVA." },
      { bold: "Facturas", rest: "con IVA por línea e IRPF configurable; los importes los calcula el sistema, nunca se teclean a mano." },
      { bold: "Cobros", rest: "totales o parciales, vinculados a su factura, con el importe autorrellenado desde el total." },
      { bold: "Gastos", rest: "con categoría contable (fijo · variable · OPEX · CAPEX) y su desgravación estimada." },
      { bold: "Recurrentes", rest: "series numeradas y Libro IVA / Modelo 303 con exportación." },
      { bold: "Panel operativo", rest: "embudo presupuesto → facturado → cobrado y rentabilidad por empleado y por cliente; preparado para Verifactu." },
    ],
    card: [
      { type: "flow", label: "Estados de la factura", pills: ["Borrador", "Emitida", "Enviada", "Pagada", "Parcial", "Vencida"] },
      { type: "formula", text: "Total = Base + IVA − **IRPF**", note: "IRPF configurable por empresa (retención de profesionales)" },
      { type: "text", label: "Cuentas de la empresa", text: "Cada factura y cada gasto se atribuye a un **empleado**. La rentabilidad por persona, por cliente y el total de la empresa, en un panel." },
    ],
    ai: [
      { title: "Borrador de factura desde el trabajo hecho", desc: "A partir de un pedido, proyecto o tarifa, la IA propone las líneas y los importes; una persona los revisa y emite. Las cifras salen de los datos del CRM." },
      { title: "Aviso de cobros en riesgo", desc: "Señala las facturas próximas a vencer o ya vencidas y sugiere a quién reclamar. Los importes son los reales de cada factura; la IA no inventa nada." },
    ],
  },
  documentos: {
    claim: "Un repositorio central para los documentos de la empresa y, a la vez, adjuntos que viven dentro de cada ficha: en el cliente, en el paciente, en el proyecto. El papel deja de estar suelto y pasa a estar donde se usa.",
    headline: "Cada documento, donde se usa",
    bullets: [
      { bold: "Repositorio central", rest: "contratos, plantillas y documentación de empresa en un único sitio, organizados por tipo." },
      { bold: "Adjuntos en contexto", rest: "cada documento puede colgar de un cliente, un paciente o un proyecto, sin duplicarlo ni perderlo." },
      { bold: "Un origen, muchos sitios", rest: "el mismo archivo se referencia desde varias fichas; se actualiza una vez y vale para todas." },
      { bold: "Control de acceso", rest: "quién puede ver y subir según su rol, con el aislamiento por empresa que ya aplica el CRM." },
      { bold: "Historial", rest: "quién subió qué y cuándo, para que ningún documento aparezca sin dueño." },
    ],
    card: [
      { type: "flow", label: "Dónde vive un documento", pills: ["Repositorio", "Cliente", "Paciente", "Proyecto"] },
      { type: "text", label: "Doble naturaleza", text: "Módulo central **y** adjunto contextual: la misma pieza, colocada donde el trabajo la necesita." },
    ],
    ai: [
      { title: "Clasificar al subir", desc: "Al subir un archivo, la IA propone su tipo y a qué ficha asociarlo (cliente, paciente o proyecto); la persona confirma antes de guardar." },
      { title: "Extraer datos clave", desc: "De un contrato o documento propone fechas, importes y partes para rellenar la ficha. Los datos salen del documento; nada se guarda sin revisión." },
    ],
    noData: true,
  },
  incidencias: {
    claim: "Cada incidencia entra, se asigna, se sigue y se cierra sin salir del CRM. Un hilo por caso, con su estado y su responsable, para que nada se quede olvidado en un correo.",
    headline: "Del aviso a la resolución, con trazabilidad",
    bullets: [
      { bold: "Alta del caso", rest: "una incidencia con su asunto, su prioridad y el cliente al que afecta." },
      { bold: "Asignación", rest: "un responsable claro por incidencia; se sabe quién la lleva en todo momento." },
      { bold: "Hilo tipo chat", rest: "los mensajes del caso quedan en un único hilo, con su histórico." },
      { bold: "Prioridad", rest: "baja, media, alta o crítica, para atender antes lo que más quema." },
      { bold: "Cierre con registro", rest: "al resolver queda constancia de cómo y cuándo, para consultarlo después." },
    ],
    card: [
      { type: "flow", label: "Ciclo de una incidencia", pills: ["Abierta", "En curso", "Esperando", "Resuelta", "Cerrada"] },
      { type: "text", label: "Un caso, un hilo", text: "Toda la conversación de una incidencia vive en **un solo sitio**, no repartida entre correos." },
    ],
    ai: [
      { title: "Prioridad y responsable sugeridos", desc: "Al crear la incidencia, la IA propone prioridad y a quién asignarla según el texto y el historial; la persona decide." },
      { title: "Detectar casos estancados", desc: "Avisa de las incidencias que llevan días sin moverse para que no se queden olvidadas. Solo señala; no cierra nada por su cuenta." },
    ],
    noData: true,
  },
};

// ---------- metadatos: orden, numeración, área (eyebrow), captura y chips reales ----------
const META = {
  clientes:    { name: "Clientes",    num: "01", area: "Cuentas & Contactos",   shot: "clientes.png",    chips: [["14", "clientes"], ["9", "contactos"], ["5", "notas"], ["2", "empresas"]] },
  leads:       { name: "Leads",       num: "02", area: "Comercial & Ventas",    shot: "leads.png",       chips: [["16", "oportunidades"]] },
  calendario:  { name: "Calendario",  num: "03", area: "Agenda",                shot: "calendario.png",  chips: [["14", "eventos"]] },
  citas:       { name: "Citas",       num: "04", area: "Reservas & Portal",     shot: "citas.png",       chips: [["12", "reservas"], ["5", "disponibilidades"], ["2", "tipos de cita"]] },
  proyectos:   { name: "Proyectos",   num: "05", area: "Operaciones",           shot: "proyectos.png",   chips: [["5", "proyectos"], ["30", "tareas"], ["15", "columnas"], ["5", "fases"]] },
  pedidos:     { name: "Pedidos",     num: "06", area: "Operaciones",           shot: "pedidos.png",     chips: [["9", "pedidos"], ["16", "líneas"]] },
  inventario:  { name: "Inventario",  num: "07", area: "Almacén & Activos",     shot: "inventario.png",  chips: [["5", "productos"], ["5", "lotes"], ["4", "salidas"], ["4", "activos"]] },
  facturacion: { name: "Facturación", num: "08", area: "Operativa & Finanzas",  shot: "facturacion.png", chips: [["14", "facturas"], ["12", "gastos"], ["4", "cobros"], ["6", "tarifas"]] },
  equipo:      { name: "Equipo",      num: "09", area: "Empresa & RRHH",        shot: "equipo.png",      chips: [["6", "miembros"]] },
  formacion:   { name: "Formación",   num: "10", area: "Conocimiento",          shot: "formacion.png",   chips: [["3", "cursos"], ["12", "matrículas"], ["12", "alumnos"], ["18", "cuestionarios"]] },
  nutricion:   { name: "Nutrición",   num: "11", area: "Especial · Salud",      shot: "nutricion.png",   chips: [["8", "alimentos"], ["4", "planes"], ["12", "comidas"], ["24", "líneas"]] },
  clinica:     { name: "Clínica",     num: "12", area: "Especial · Salud",      shot: "clinica.png",     chips: [["36", "sesiones"], ["7", "informes"], ["4", "coordinaciones"], ["3", "métricas"]] },
  pacientes:   { name: "Pacientes",   num: "", area: "Submódulo de Clínica",    shot: "pacientes.png",   chips: [["9", "pacientes"]] },
  documentos:  { name: "Documentos",  num: "T1", area: "Transversal",           shot: null, chips: [] },
  incidencias: { name: "Incidencias", num: "S1", area: "Soporte & Calidad",     shot: null, chips: [] },
};

// merge workflow + hand
const CONTENT = {};
for (const m of fromWorkflow) CONTENT[m.key] = m;
for (const k of Object.keys(HAND)) CONTENT[k] = { ...(CONTENT[k] || {}), ...HAND[k] };

const ORDER_BASE = ["clientes", "leads", "calendario", "citas", "proyectos", "pedidos", "inventario", "facturacion", "equipo", "formacion"];
const AI_ORDER = [...ORDER_BASE, "nutricion", "clinica", "pacientes", "documentos", "incidencias"];

// ---------- plantillas de slide ----------
// Sin footer por página (eliminado a petición). Se mantiene la firma para no tocar las llamadas.
const foot = () => "";

function moduleCover(key) {
  const meta = META[key], c = CONTENT[key];
  const eyebrow = meta.num ? `Módulo ${meta.num} · ${meta.area}` : meta.area;
  const shot = meta.shot
    ? `<div class="mock"><div class="bar"><span class="d"></span><span class="d"></span><span class="d"></span><span class="url">Salamandra CRM · ${esc(meta.name)}</span></div><div class="shot" style="background-image:url('./shots/${meta.shot}')"></div></div>`
    : conceptMock(key);
  return `<section class="slide cover">
    <div class="cover-left">
      <div class="eyebrow">${esc(eyebrow)}</div>
      <h1>${esc(meta.name)}</h1>
      <div class="rule"></div>
      <p class="claim">${esc(shortClaim(c.claim))}</p>
      <div class="hint"><span class="ar">→</span> ${meta.shot ? "Así se ve al entrar en el módulo" : "Ejemplo ilustrativo del módulo"}</div>
    </div>
    ${shot}
    ${foot(`${meta.num || "—"} · ${meta.name}`)}
  </section>`;
}

// mock conceptual para módulos sin datos en el Sandbox (Documentos, Incidencias)
function conceptMock(key) {
  if (key === "documentos") {
    return `<div class="concept">
      <div class="cnode hub">Repositorio<br><span>central</span></div>
      <div class="cline l1"></div><div class="cline l2"></div><div class="cline l3"></div>
      <div class="cnode n1">Cliente</div>
      <div class="cnode n2">Paciente</div>
      <div class="cnode n3">Proyecto</div>
      <div class="clabel">Ejemplo ilustrativo · sin datos en el Sandbox</div>
    </div>`;
  }
  return `<div class="concept">
    <div class="cflow">
      <span class="cs">Abierta</span><span class="ca">›</span>
      <span class="cs">En curso</span><span class="ca">›</span>
      <span class="cs">Esperando</span><span class="ca">›</span>
      <span class="cs on">Resuelta</span>
    </div>
    <div class="cticket">
      <div class="ct-h"><span class="ct-dot"></span> Incidencia · <b>prioridad alta</b></div>
      <div class="ct-l"></div><div class="ct-l s"></div>
      <div class="ct-msg">Hilo del caso · mensajes</div>
    </div>
    <div class="clabel">Ejemplo ilustrativo · sin datos en el Sandbox</div>
  </div>`;
}

function renderCard(key) {
  const meta = META[key], c = CONTENT[key];
  const maxBlocks = key === "facturacion" ? 3 : 2;
  const blocks = (c.card || []).slice(0, maxBlocks).map((b) => {
    if (b.type === "flow") {
      const pills = (b.pills || []).map((p) => `<span class="st">${esc(p)}</span>`).join('<span class="arw">›</span>');
      return `<div><div class="ch">${esc(b.label)}</div><div class="flow" style="margin-top:12px">${pills}</div></div>`;
    }
    if (b.type === "formula") {
      return `<div class="formula">${md(b.text)}${b.note ? `<span class="note">${esc(b.note)}</span>` : ""}</div>`;
    }
    return `<div><div class="ch">${esc(b.label)}</div><div class="desc" style="margin-top:8px">${md(b.text)}</div></div>`;
  }).join("");
  return `<div class="card">${blocks}</div>`;
}

function moduleFeatures(key, extra = "") {
  const meta = META[key], c = CONTENT[key];
  const bullets = (c.bullets || []).map((b) => `<li><span class="mk"></span><span><b>${esc(b.bold)}</b> ${esc(b.rest)}</span></li>`).join("");
  return `<section class="slide feat">
    <div class="eyebrow" style="color:var(--gold)">${esc(meta.name)}</div>
    <h2>${esc(c.headline)}</h2>
    <div class="grid">
      <ul>${bullets}</ul>
      ${extra || renderCard(key)}
    </div>
    ${foot(`${meta.name} · Características`)}
  </section>`;
}

// Clínica: la tarjeta lateral incluye el submódulo Pacientes
function clinicaFeatures() {
  const c = CONTENT.clinica, p = CONTENT.pacientes;
  const flow = (c.card.find((b) => b.type === "flow")) || { label: "Flujo", pills: [] };
  const pills = flow.pills.map((x) => `<span class="st">${esc(x)}</span>`).join('<span class="arw">›</span>');
  const card = `<div class="card">
    <div><div class="ch">${esc(flow.label)}</div><div class="flow" style="margin-top:12px">${pills}</div></div>
    <div class="subm">
      <div class="ch" style="color:var(--gold)">Submódulo · Pacientes</div>
      <div class="desc" style="margin-top:8px">La ficha de cada paciente —centro escolar, motivo de derivación, terapeuta principal y estado del tratamiento— es la base sobre la que se apoyan las <b>sesiones</b>, los <b>informes</b> y las <b>coordinaciones</b>.</div>
    </div>
  </div>`;
  return moduleFeatures("clinica", card);
}

// ---------- portadas / índice / divisores / IA ----------
function openingSlide() {
  return `<section class="slide open">
    <div class="open-body">
      <div class="eyebrow">Dossier de producto · 2026</div>
      <h1>Salamandra<span class="thin"> CRM</span></h1>
      <div class="rule"></div>
      <p class="lead">Un solo sistema para clientes, ventas, proyectos, facturación y equipo. Multi-empresa y
        adaptable a cómo trabaja cada negocio: cada uno activa los módulos que necesita y los ve a su medida.
        Lo que sigue es un recorrido por el producto, módulo a módulo, con datos reales de un entorno de muestra.</p>
    </div>
    <div class="open-brand">Salamandra Solutions</div>
    <div class="open-dot"></div>
  </section>`;
}

// ---------- Planes de pago (una slide, antes del cierre) ----------
function plansSlide() {
  // Sin importes: cada plan se presenta por su CONCEPTO, en grande.
  const PLANS = [
    {
      cls: "side",
      name: "Compra única",
      concept: "Pago único",
      note: "sin cuota recurrente",
      bullets: [
        "El producto queda en propiedad, para toda la vida, en la cuenta del cliente.",
        "Un año de mantenimiento gratuito incluido.",
        "Permite hiperpersonalización del producto.",
      ],
      who: "Para quien prefiere invertir una vez y tener el CRM en propiedad y a medida.",
    },
    {
      cls: "mid",
      badge: "Recomendado",
      name: "Mix",
      concept: "Suscripción",
      concept2: "+ compra única",
      note: "base por cuota · especiales en propiedad",
      bullets: [
        "Módulos base en suscripción.",
        "Módulos especiales (Nutrición, Clínica) en compra única.",
        "Coste de entrada contenido en lo base.",
        "Propiedad e hiperpersonalización donde más valor aporta.",
      ],
      who: "El equilibrio óptimo. La opción que recomendamos por defecto.",
    },
    {
      cls: "side",
      name: "Suscripción",
      concept: "Cuota mensual",
      note: "módulos base",
      bullets: [
        "Sin desembolso inicial grande.",
        "Siempre actualizado, sin gestionar versiones.",
        "Cubre tu operativa con los módulos base.",
      ],
      who: "Para quien quiere empezar con coste de entrada bajo, cubriendo su operativa con los módulos base.",
    },
  ];

  const cards = PLANS.map((p) => `
    <div class="plan ${p.cls}">
      ${p.badge ? `<div class="badge">${esc(p.badge)}</div>` : ""}
      <div class="pname">${esc(p.name)}</div>
      <div class="pprice">${esc(p.concept)}</div>
      ${p.concept2 ? `<div class="pplus">${esc(p.concept2)}</div>` : ""}
      <div class="pnote">${esc(p.note)}</div>
      <div class="pdiv"></div>
      <ul class="plist">${p.bullets.map((b) => `<li><span class="pmk"></span><span>${esc(b)}</span></li>`).join("")}</ul>
      <div class="who"><div class="wlabel">Para quién</div><div class="wtext">${esc(p.who)}</div></div>
    </div>`).join("");

  return `<section class="slide plans-slide">
    <div class="eyebrow" style="color:var(--gold)">Cómo se contrata</div>
    <h2>Planes de pago</h2>
    <p class="plead">Tres formas de tener el CRM: en propiedad, por suscripción, o el punto medio que recomendamos.</p>
    <div class="plans">${cards}</div>
  </section>`;
}

function closingSlide() {
  return `<section class="slide open closing">
    <div class="open-body">
      <div class="eyebrow">Gracias</div>
      <h1>Hablemos de<br><span class="thin">tu operativa</span></h1>
      <div class="rule"></div>
      <p class="lead">Cada empresa enciende los módulos que necesita, con su marca y sus reglas. Si algo de lo que
        habéis visto encaja con vuestro día a día, el siguiente paso es montarlo con vuestros propios datos.</p>
    </div>
    <div class="open-brand">Salamandra Solutions · CRM</div>
    <div class="open-dot"></div>
  </section>`;
}

function indexSlide() {
  const groups = [
    { t: "Módulos base", items: ["Clientes", "Leads", "Calendario", "Citas", "Proyectos", "Pedidos", "Inventario", "Facturación", "Equipo", "Formación"] },
    { t: "Módulos especiales", items: ["Nutrición (Recetario)", "Clínica", "Pacientes (submódulo)"] },
    { t: "Transversales", items: ["Documentos"] },
    { t: "Soporte", items: ["Incidencias"] },
    { t: "Inteligencia Artificial", items: ["Enfoque y principios", "6 capacidades", "Ideas por módulo"] },
  ];
  const cols = groups.map((g) => `<div class="ix-col">
    <div class="ix-h">${esc(g.t)}</div>
    <ul>${g.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>
  </div>`).join("");
  return `<section class="slide idx">
    <div class="eyebrow" style="color:var(--gold)">El producto de un vistazo</div>
    <h2>Mapa de módulos</h2>
    <div class="ix-grid">${cols}</div>
    ${foot("Índice")}
  </section>`;
}

function dividerSlide(kicker, title, sub) {
  return `<section class="slide divider">
    <div class="dv-body">
      <div class="eyebrow">${esc(kicker)}</div>
      <h1>${esc(title)}</h1>
      <div class="rule"></div>
      <p class="lead">${esc(sub)}</p>
    </div>
    ${foot(esc(kicker))}
  </section>`;
}

function aiPrinciplesSlide() {
  return `<section class="slide feat">
    <div class="eyebrow" style="color:var(--gold)">Inteligencia Artificial · El enfoque</div>
    <h2>Cómo entendemos la IA</h2>
    <div class="pr-grid">
      <div class="pr-card">
        <div class="pr-n">01</div>
        <div class="pr-t">La IA propone, una persona confirma</div>
        <div class="pr-d">Nada se emite, se guarda ni se envía por su cuenta. La IA prepara el borrador y deja la última palabra a quien lo revisa. Ahorra el trabajo pesado sin quitar el control.</div>
      </div>
      <div class="pr-card">
        <div class="pr-n">02</div>
        <div class="pr-t">La IA nunca inventa cifras</div>
        <div class="pr-d">Todo número que aparece sale de los datos reales del CRM. Si un dato no existe, lo dice; no rellena huecos con suposiciones. Lo que se ve, se puede rastrear hasta su origen.</div>
      </div>
    </div>
    ${foot("IA · Principios")}
  </section>`;
}

function aiCapabilitiesSlide() {
  const caps = [
    ["Asistente global", "Preguntas en lenguaje normal sobre tus datos y te responde con lo que hay en el CRM."],
    ["Resumen 360", "De un cliente, un paciente o un proyecto, un resumen con lo que de verdad importa."],
    ["Lectura de documentos y audio", "Subes un PDF o una nota de voz y la IA extrae lo relevante; tú lo confirmas."],
    ["Detección de cosas raras", "Avisa de lo que se sale de lo normal: un gasto fuera de rango, un lead parado."],
    ["Tu día", "Al entrar, lo que requiere tu atención hoy, ordenado por lo que más urge."],
    ["Crear estructura desde una frase", "Describes un proyecto o un plan y la IA propone su estructura inicial."],
  ];
  const cells = caps.map((c, i) => `<div class="cap">
    <div class="cap-n">${String(i + 1).padStart(2, "0")}</div>
    <div class="cap-t">${esc(c[0])}</div>
    <div class="cap-d">${esc(c[1])}</div>
  </div>`).join("");
  return `<section class="slide feat">
    <div class="eyebrow" style="color:var(--gold)">Inteligencia Artificial · Capacidades</div>
    <h2>Seis capacidades transversales</h2>
    <div class="cap-grid">${cells}</div>
    ${foot("IA · Capacidades")}
  </section>`;
}

function aiIdeasSlides() {
  // 3 módulos por slide en bandas; cada módulo con sus 2 ideas en tarjetas anchas
  const perSlide = 3;
  const slides = [];
  const total = Math.ceil(AI_ORDER.length / perSlide);
  for (let i = 0; i < AI_ORDER.length; i += perSlide) {
    const group = AI_ORDER.slice(i, i + perSlide);
    const bands = group.map((k) => {
      const meta = META[k], c = CONTENT[k];
      const ideas = (c.ai || []).map((a) => `<div class="idea"><div class="it">${esc(a.title)}</div><div class="id">${esc(a.desc)}</div></div>`).join("");
      return `<div class="aim">
        <div class="aim-h"><span class="aim-name">${esc(meta.name)}</span></div>
        <div class="aim-ideas">${ideas}</div>
      </div>`;
    }).join("");
    const n = Math.floor(i / perSlide) + 1;
    slides.push(`<section class="slide aiideas">
      <div class="eyebrow" style="color:var(--gold)">Inteligencia Artificial · Ideas por módulo</div>
      <h2>Dos ideas por módulo <span class="pg">${n} / ${total}</span></h2>
      <div class="aim-grid">${bands}</div>
      ${foot(`IA · Ideas ${n}/${total}`)}
    </section>`);
  }
  return slides.join("\n");
}

// ---------- ensamblado ----------
const slides = [];
slides.push(openingSlide());
slides.push(indexSlide());
slides.push(dividerSlide("Módulos base", "Lo que usa cualquier empresa", "Los diez módulos que forman el núcleo del CRM: de captar un cliente a cobrarle, pasando por el trabajo del día a día."));
for (const k of ORDER_BASE) { slides.push(moduleCover(k)); slides.push(moduleFeatures(k)); }
slides.push(dividerSlide("Módulos especiales", "Para sectores concretos", "Módulos verticales que encienden solo los negocios que los necesitan. Aquí, el ejemplo de un centro de salud y nutrición."));
slides.push(moduleCover("nutricion")); slides.push(moduleFeatures("nutricion"));
slides.push(moduleCover("clinica")); slides.push(clinicaFeatures());
slides.push(dividerSlide("Transversal & Soporte", "Presentes en todo el CRM", "Dos piezas que atraviesan el resto: los documentos, que viven en cada ficha, y las incidencias, que ordenan el soporte."));
slides.push(moduleCover("documentos")); slides.push(moduleFeatures("documentos"));
slides.push(moduleCover("incidencias")); slides.push(moduleFeatures("incidencias"));
slides.push(dividerSlide("Inteligencia Artificial", "IA con criterio, no de adorno", "Un enfoque claro, seis capacidades que atraviesan el producto y dos ideas concretas por cada módulo."));
slides.push(aiPrinciplesSlide());
slides.push(aiCapabilitiesSlide());
slides.push(aiIdeasSlides());
slides.push(plansSlide());
slides.push(closingSlide());

const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><style>${CSS()}</style></head><body>\n${slides.join("\n")}\n</body></html>`;
fs.writeFileSync(outPath, html);
console.log("OK dossier:", outPath, "· slides:", (html.match(/class="slide/g) || []).length);

// ---------- CSS ----------
function CSS() {
  return `
@font-face{font-family:'Poppins';src:url('./fonts/Poppins-Light.ttf');font-weight:300}
@font-face{font-family:'Poppins';src:url('./fonts/Poppins-Regular.ttf');font-weight:400}
@font-face{font-family:'Poppins';src:url('./fonts/Poppins-Medium.ttf');font-weight:500}
@font-face{font-family:'Poppins';src:url('./fonts/Poppins-SemiBold.ttf');font-weight:600}
@font-face{font-family:'Poppins';src:url('./fonts/Poppins-Bold.ttf');font-weight:700}
:root{--green:#1F3B34;--green-2:#3E5C57;--light:#F7F7F4;--gold:#D9B93E;--ink:#20302B;--on-green:#EAF1EC;--on-green-soft:#9FB6AC}
*{box-sizing:border-box;margin:0;padding:0}
html,body{font-family:'Poppins',sans-serif;-webkit-font-smoothing:antialiased}
@page{size:1280px 720px;margin:0}
.slide{width:1280px;height:720px;position:relative;overflow:hidden;page-break-after:always}
.slide:last-child{page-break-after:auto}
.eyebrow{font-size:14px;font-weight:600;letter-spacing:.22em;text-transform:uppercase;color:var(--gold)}
.foot{position:absolute;bottom:34px;font-size:12.5px;letter-spacing:.04em;z-index:3}
.foot.l{left:80px;color:#8A968F}.foot.r{right:80px;color:#8A968F}
.foot b{font-weight:600}
.cover .foot.l,.cover .foot.r,.divider .foot.l,.divider .foot.r,.open .foot.l,.open .foot.r{color:var(--on-green-soft)}
.cover .foot b{color:#DDE9DF}
.feat .foot b,.idx .foot b,.aiideas .foot b{color:var(--green)}

/* portada de módulo */
.cover{background:var(--green);color:var(--on-green)}
.cover::before{content:"";position:absolute;left:-150px;bottom:-170px;width:470px;height:470px;border-radius:50%;border:1.5px solid rgba(217,185,62,.14)}
.cover-left{position:absolute;left:80px;top:0;bottom:0;width:356px;display:flex;flex-direction:column;justify-content:center;z-index:2}
.cover-left h1{font-weight:700;font-size:50px;line-height:1.04;color:#fff;letter-spacing:-.02em;margin-top:16px}
.rule{width:70px;height:4px;background:var(--gold);margin:22px 0 20px;border-radius:2px}
.cover-left .claim{font-weight:300;font-size:17px;line-height:1.55;color:#CFE0D5;max-width:344px;text-align:justify}
.cover-left .hint{margin-top:26px;font-size:11.5px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--gold);display:flex;align-items:center;gap:8px}
.cover-left .hint .ar{font-size:15px}
.mock{position:absolute;left:456px;top:81px;width:824px;border-radius:14px 0 0 14px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,.16),0 18px 44px rgba(0,0,0,.26);background:#fff;border:1px solid rgba(255,255,255,.16);border-right:none;z-index:1}
.mock .bar{height:38px;background:#e9ede9;display:flex;align-items:center;padding:0 15px}
.mock .bar .d{width:11px;height:11px;border-radius:50%;background:#c9d1c9;margin-right:8px}
.mock .bar .url{margin-left:12px;font-size:12px;color:#7c877e;font-weight:500;background:#fff;border-radius:6px;padding:5px 14px}
.mock .shot{height:520px;background-size:cover;background-position:top left;background-repeat:no-repeat}

/* mock conceptual (sin datos) — sobre fondo verde oscuro */
.concept{position:absolute;left:456px;top:0;bottom:0;right:0;display:flex;align-items:center;justify-content:center}
.cnode{position:absolute;background:rgba(255,255,255,.07);border:1px solid rgba(217,185,62,.3);border-radius:12px;padding:14px 20px;font-size:15px;font-weight:600;color:#EAF1EC;text-align:center}
.cnode span{font-weight:300;color:#9FB6AC;font-size:12px}
.cnode.hub{left:120px;top:300px;background:rgba(217,185,62,.14);border-color:var(--gold);color:#fff;font-size:17px}
.cnode.n1{right:120px;top:150px}.cnode.n2{right:150px;top:300px}.cnode.n3{right:120px;top:450px}
.cline{position:absolute;height:1.5px;background:linear-gradient(90deg,var(--gold),transparent);opacity:.5;transform-origin:left}
.cline.l1{left:300px;top:325px;width:360px;transform:rotate(-22deg)}
.cline.l2{left:300px;top:332px;width:340px}
.cline.l3{left:300px;top:340px;width:360px;transform:rotate(22deg)}
.clabel{position:absolute;bottom:60px;left:0;right:80px;text-align:center;font-size:12px;color:#8A968F;letter-spacing:.05em}
.cflow{position:absolute;top:210px;left:0;right:60px;display:flex;gap:10px;align-items:center;justify-content:center;flex-wrap:wrap}
.cs{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14);border-radius:20px;padding:7px 16px;font-size:14px;color:#DDE9DF;font-weight:500}
.cs.on{background:rgba(217,185,62,.18);border-color:var(--gold);color:#fff}
.ca{color:var(--gold);font-weight:700}
.cticket{position:absolute;top:300px;left:130px;right:150px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:22px 24px}
.ct-h{font-size:15px;color:#EAF1EC;display:flex;align-items:center;gap:10px;margin-bottom:16px}
.ct-h b{color:var(--gold)}
.ct-dot{width:10px;height:10px;border-radius:50%;background:#c0894f}
.ct-l{height:9px;background:rgba(255,255,255,.1);border-radius:5px;margin-bottom:9px}
.ct-l.s{width:60%}
.ct-msg{margin-top:16px;font-size:12.5px;color:#9FB6AC}

/* características */
.feat{background:var(--light);color:var(--ink);padding:74px 80px 64px}
.feat h2{font-weight:700;font-size:44px;color:var(--green);letter-spacing:-.01em;margin-top:6px}
.feat .grid{display:grid;grid-template-columns:1.15fr .85fr;gap:44px;margin-top:36px;align-items:start}
.feat ul{list-style:none;display:flex;flex-direction:column;gap:13px}
.feat li{display:flex;gap:13px;align-items:flex-start;font-size:15.3px;line-height:1.4;color:#2C3A34}
.feat li .mk{width:8px;height:8px;border-radius:50%;background:var(--gold);flex-shrink:0;margin-top:7px}
.feat li b{font-weight:600;color:var(--green)}
.card{background:var(--green);color:var(--on-green);border-radius:16px;padding:28px 30px;display:flex;flex-direction:column;gap:18px;overflow:hidden}
.card .ch{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--gold);font-weight:600}
.flow{display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:13px;color:#DDE9DF}
.flow .st{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);border-radius:20px;padding:5px 12px;font-weight:500}
.flow .arw{color:var(--gold);font-weight:700}
.formula{font-size:18px;color:#fff;font-weight:500;background:rgba(217,185,62,.12);border:1px solid rgba(217,185,62,.3);border-radius:10px;padding:12px 14px;text-align:center}
.formula b{color:var(--gold)}
.formula .note{display:block;font-size:11.5px;color:#9FB6AC;font-weight:400;margin-top:5px}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chips .c{background:rgba(255,255,255,.06);border-radius:8px;padding:6px 11px;font-size:12.5px;color:#CFE0D5}
.chips .c b{color:#fff;font-weight:600}
.desc{font-size:13.5px;color:#CFE0D5;line-height:1.5}
.desc b{color:var(--gold);font-weight:600}
.subm{border-top:1px solid rgba(255,255,255,.12);padding-top:16px;margin-top:2px}
.subshot{height:118px;margin-top:12px;border-radius:8px;background-size:cover;background-position:top left;border:1px solid rgba(255,255,255,.12)}

/* apertura / cierre / divisores */
.open,.divider{background:var(--green);color:var(--on-green)}
.open::before,.divider::before{content:"";position:absolute;right:-160px;top:-160px;width:520px;height:520px;border-radius:50%;border:2px solid rgba(217,185,62,.18)}
.open::after,.divider::after{content:"";position:absolute;right:-70px;top:-70px;width:360px;height:360px;border-radius:50%;border:1px solid rgba(217,185,62,.12)}
.open-body,.dv-body{position:absolute;left:80px;top:0;bottom:0;width:760px;display:flex;flex-direction:column;justify-content:center;z-index:2}
.open h1,.divider h1{font-weight:700;font-size:76px;line-height:1.02;color:#fff;letter-spacing:-.025em}
.open h1 .thin{font-weight:300;color:var(--gold)}
.open .lead,.divider .lead{font-weight:300;font-size:20px;line-height:1.55;color:#CFE0D5;max-width:640px;text-align:justify}
.divider h1{font-size:62px}
.divider .lead{font-size:19px;max-width:600px}
.open-brand{position:absolute;left:80px;bottom:56px;font-size:14px;letter-spacing:.14em;text-transform:uppercase;color:var(--on-green-soft);font-weight:600;z-index:2}
.open-dot{position:absolute;left:80px;bottom:92px;width:34px;height:4px;background:var(--gold);border-radius:2px}
.closing .open-body{width:720px}

/* índice */
.idx{background:var(--light);color:var(--ink);padding:74px 80px 64px}
.idx h2{font-weight:700;font-size:46px;color:var(--green);margin-top:6px;letter-spacing:-.01em}
.ix-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:20px;margin-top:44px}
.ix-col{background:#fff;border:1px solid #e7e6df;border-radius:14px;padding:22px 20px;height:452px}
.ix-h{font-size:14px;font-weight:700;color:var(--green);letter-spacing:.01em;padding-bottom:12px;margin-bottom:14px;border-bottom:2px solid var(--gold)}
.ix-col ul{list-style:none;display:flex;flex-direction:column;gap:11px}
.ix-col li{font-size:13.5px;color:#3A463F;line-height:1.3;padding-left:14px;position:relative}
.ix-col li::before{content:"";position:absolute;left:0;top:7px;width:5px;height:5px;border-radius:50%;background:var(--gold)}

/* IA principios */
.pr-grid{display:grid;grid-template-columns:1fr 1fr;gap:30px;margin-top:44px;height:430px}
.pr-card{background:#fff;border:1px solid #e7e6df;border-left:5px solid var(--gold);border-radius:16px;padding:40px 40px;display:flex;flex-direction:column;justify-content:center}
.pr-n{font-size:15px;font-weight:700;color:var(--gold);letter-spacing:.1em;margin-bottom:16px}
.pr-t{font-size:30px;font-weight:700;color:var(--green);line-height:1.15;letter-spacing:-.01em}
.pr-d{font-size:16.5px;line-height:1.55;color:#3A463F;margin-top:18px;text-align:justify}

/* IA capacidades */
.cap-grid{display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:1fr 1fr;gap:18px;margin-top:38px;height:452px}
.cap{background:#fff;border:1px solid #e7e6df;border-radius:14px;padding:24px 24px;position:relative}
.cap-n{font-size:13px;font-weight:700;color:var(--gold);letter-spacing:.08em}
.cap-t{font-size:19px;font-weight:700;color:var(--green);margin-top:10px;line-height:1.15}
.cap-d{font-size:14px;line-height:1.5;color:#3A463F;margin-top:10px}

/* Planes de pago */
.plans-slide{background:var(--light);color:var(--ink);padding:48px 80px 40px}
.plans-slide h2{font-weight:700;font-size:42px;color:var(--green);margin-top:4px;letter-spacing:-.01em}
.plead{font-size:16.5px;color:#3E5C57;margin-top:10px;max-width:900px;line-height:1.5}
.plans{display:grid;grid-template-columns:1fr 1.08fr 1fr;gap:26px;align-items:stretch;margin-top:30px}
.plan{border-radius:18px;display:flex;flex-direction:column;position:relative}
.plan.side{background:#fff;border:1px solid #e7e6df;color:var(--ink);padding:28px 26px 26px;margin-top:32px}
.plan.mid{background:var(--green);color:#fff;border:1.5px solid rgba(217,185,62,.5);padding:36px 30px 32px;box-shadow:0 18px 46px rgba(20,40,34,.20)}
.badge{position:absolute;top:-14px;left:50%;transform:translateX(-50%);background:var(--gold);color:#1F3B34;font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;padding:7px 20px;border-radius:20px;white-space:nowrap}
.pname{font-size:20px;font-weight:700;letter-spacing:.01em}
.plan.side .pname{color:var(--green)}
.plan.mid .pname{color:#fff}
.pprice{font-size:31px;font-weight:700;margin-top:14px;line-height:1.12;letter-spacing:-.01em}
.plan.side .pprice{color:var(--green)}
.plan.mid .pprice{color:var(--gold)}
.pplus{font-size:24px;font-weight:700;color:#EAF1EC;margin-top:2px;line-height:1.12;letter-spacing:-.01em}
.pnote{font-size:12.5px;margin-top:7px;line-height:1.35}
.plan.side .pnote{color:#7c877e}
.plan.mid .pnote{color:#9FB6AC}
.pdiv{height:1px;margin:20px 0 18px}
.plan.side .pdiv{background:#e7e6df}
.plan.mid .pdiv{background:rgba(217,185,62,.35)}
.plist{list-style:none;display:flex;flex-direction:column;gap:11px}
.plist li{display:flex;gap:11px;align-items:flex-start;font-size:13.5px;line-height:1.45}
.plan.side .plist li{color:#3A463F}
.plan.mid .plist li{color:#DDE9DF}
.pmk{width:7px;height:7px;border-radius:50%;background:var(--gold);flex-shrink:0;margin-top:6px}
.who{margin-top:auto;padding-top:18px}
.plan.side .who{border-top:1px solid #eeede6}
.plan.mid .who{border-top:1px solid rgba(255,255,255,.12)}
.wlabel{font-size:10.5px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--gold);margin-bottom:7px}
.wtext{font-size:12.8px;line-height:1.45}
.plan.side .wtext{color:#5b6660}
.plan.mid .wtext{color:#CFE0D5}

/* IA ideas por módulo */
.aiideas{background:var(--light);color:var(--ink);padding:46px 80px 42px}
.aiideas h2{font-weight:700;font-size:34px;color:var(--green);margin-top:4px;letter-spacing:-.01em}
.aiideas h2 .pg{font-size:16px;font-weight:600;color:#A9B2AC;margin-left:10px}
.aim-grid{display:grid;grid-template-rows:repeat(3,1fr);gap:14px;margin-top:20px;height:534px}
.aim{display:flex;flex-direction:column;min-height:0}
.aim-h{border-bottom:2px solid var(--gold);padding-bottom:5px;margin-bottom:9px}
.aim-name{font-size:16px;font-weight:700;color:var(--green);letter-spacing:.01em}
.aim-ideas{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start}
.idea{background:#fff;border:1px solid #e7e6df;border-radius:11px;padding:11px 15px}
.idea .it{font-size:14px;font-weight:700;color:var(--ink);line-height:1.2}
.idea .id{font-size:11.8px;line-height:1.36;color:#4A554F;margin-top:4px}
`;
}
