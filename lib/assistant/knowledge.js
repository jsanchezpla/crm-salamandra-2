/**
 * lib/assistant/knowledge.js — base de conocimiento del CRM para el Salamandrobot.
 *
 * (Fichero nuevo en /lib, regla #2: encapsula el "qué sabe" el asistente, reutilizado
 * por el endpoint y por el modo sin-IA.) Es la fuente de navegación/ayuda: permite
 * que el asistente responda "¿dónde está X?" / "¿cómo hago Y?" incluso sin clave de IA.
 */

// Cada entrada: title, path (a dónde ir), keywords (para el match sin-IA), help (cómo se hace).
export const CRM_KNOWLEDGE = [
  { title: "Clientes", path: "/clientes", keywords: ["cliente", "clientes", "cuenta", "empresa", "contacto", "pagador", "razon social", "nif", "cif"],
    help: "En Clientes gestionas cuentas y contactos. Alta con «+ Nuevo cliente»; en la ficha ves sus facturas, pacientes y módulos asignados." },
  { title: "Facturación — facturas", path: "/facturacion/facturas", keywords: ["factura", "facturas", "facturar", "cobro", "emitir", "borrador", "rectificativa"],
    help: "Crea una factura con «Nueva factura», elige cliente (o «+ Nuevo» para alta rápida), añade líneas y guarda como borrador; luego «Emitir» le asigna número. Los cobros parciales se registran en la propia factura." },
  { title: "Facturación — configuración fiscal", path: "/configuracion", keywords: ["iva", "irpf", "impuesto", "exento", "exencion", "regimen", "autonomo", "sl", "vencimiento", "serie"],
    help: "En Configuración → Facturación eliges el régimen (Empresa/SL sin IRPF, o Autónomo con −15%), activas la exención de IVA si no repercutes IVA, y ajustas IVA por defecto, series y vencimiento." },
  { title: "Citas", path: "/citas", keywords: ["cita", "citas", "reserva", "agenda", "agendar", "hueco", "disponibilidad"],
    help: "En Citas ves y gestionas las reservas. Se pueden confirmar, cancelar o reprogramar. Cada cita puede ir asociada a un paciente y a un profesional." },
  { title: "Calendario", path: "/calendario", keywords: ["calendario", "tarea", "evento", "planificar"],
    help: "El Calendario muestra tareas y eventos del equipo, con enlace a cliente y profesional." },
  { title: "Pacientes", path: "/pacientes", keywords: ["paciente", "pacientes", "hijo", "tutor", "parentesco", "familia"],
    help: "En Pacientes gestionas las fichas clínicas. Un cliente pagador puede tener varios pacientes (p. ej. sus hijos); cada paciente tiene sus citas, sesiones y facturación." },
  { title: "Equipo — Mi desempeño", path: "/equipo/mi-desempeno", keywords: ["desempeño", "desempeno", "rendimiento", "incentivo", "puntuacion", "areas"],
    help: "En Equipo → «Mi desempeño» cada terapeuta ve su puntuación por áreas, complementos y evolución. «Dirección» muestra el ranking del equipo." },
  { title: "Equipo — Incidencias y bandeja", path: "/equipo/incidencias", keywords: ["incidencia", "incidencias", "bandeja", "pendiente", "pendientes", "aviso"],
    help: "En Equipo → «Incidencias» se registran y siguen las incidencias del centro; «Bandeja de trabajo» reúne lo pendiente de cada persona." },
  { title: "Clínica", path: "/clinica", keywords: ["clinica", "sesion", "sesiones", "informe", "coordinacion", "terapeuta"],
    help: "Clínica reúne sesiones, informes y coordinaciones de los pacientes." },
  { title: "Captación (Outreach)", path: "/outreach", keywords: ["captacion", "outreach", "lead", "leads", "prospecto", "scoring", "analizar", "correo frio"],
    help: "En Captación analizas empresas con IA (puntúa el encaje) y envías correos modelo en frío. En la demo va en modo simulado." },
  { title: "Nutrición", path: "/nutricion/alimentos", keywords: ["nutricion", "alimento", "alimentos", "receta", "recetas", "menu", "dieta", "plan"],
    help: "Nutrición incluye el catálogo de alimentos, recetas y menús/planes asignables a pacientes." },
  { title: "Equipo & RRHH", path: "/equipo", keywords: ["equipo", "empleado", "rrhh", "salario", "retribucion", "miembro", "profesional"],
    help: "En Equipo gestionas los miembros, sus módulos y su retribución." },
  { title: "Productos", path: "/productos", keywords: ["productos", "producto", "catalogo", "precio", "precios", "valor", "ventas", "vendido"],
    help: "Productos es el catálogo de lo que vendes con su valor (precio de venta y de compra). Con el avanzado, además, las estadísticas de venta, y de él cuelgan Inventario, Pedidos y Tienda." },
  { title: "Inventario", path: "/inventario", keywords: ["inventario", "stock", "almacen", "material", "existencias"],
    help: "Inventario es el almacén de los productos del catálogo: entradas de mercancía, ajustes y movimientos de stock. Los productos y su precio se dan de alta en Productos." },
  { title: "Proyectos", path: "/proyectos", keywords: ["proyecto", "proyectos", "kanban", "tablero", "tarea"],
    help: "Proyectos organiza el trabajo en tableros Kanban y vista de lista, con prioridades." },
  { title: "Pedidos", path: "/pedidos", keywords: ["pedido", "pedidos", "orden"],
    help: "Pedidos gestiona las órdenes; al completarse pueden enlazar con una factura." },
  { title: "Configuración e IA", path: "/configuracion", keywords: ["configuracion", "ajustes", "ia", "clave", "api", "anthropic", "claude", "openai", "resend", "empresa"],
    help: "En Configuración pones los datos de empresa, la facturación y las claves de IA por tenant (Claude, Whisper). La clave se guarda cifrada; sin ella, las funciones de IA no llaman a la API." },
];

const norm = (s) =>
  String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Entradas más relevantes para una consulta (match por palabras clave). */
export function findRelevant(query, limit = 4) {
  const q = norm(query);
  const words = q.split(/\W+/).filter((w) => w.length >= 3);
  const scored = CRM_KNOWLEDGE.map((e) => {
    let score = 0;
    for (const k of e.keywords) {
      const nk = norm(k);
      if (q.includes(nk)) score += 3;
      else if (words.some((w) => nk.includes(w) || w.includes(nk))) score += 1;
    }
    if (norm(e.title).split(/\W+/).some((t) => words.includes(t))) score += 2;
    return { e, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.e);
}

/** Texto compacto de toda la base para meter en el system prompt de Claude. */
export function knowledgeForPrompt() {
  return CRM_KNOWLEDGE.map((e) => `- ${e.title} (${e.path}): ${e.help}`).join("\n");
}
