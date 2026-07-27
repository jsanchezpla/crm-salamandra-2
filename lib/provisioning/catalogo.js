/**
 * lib/provisioning/catalogo.js — el catálogo de lo que se le puede vender a un
 * cliente nuevo, en un solo sitio.
 *
 * (Fichero nuevo en /lib, regla #2: lo comparten la pantalla de alta de
 * clientes y el endpoint que crea el tenant.)
 *
 * QUÉ RESUELVE: dar de alta un cliente costaba horas de Jorge — clonar un seed
 * de 400 líneas, correr scripts sueltos por cada módulo, otro para la marca,
 * otro para el schema... Cada venta se pagaba en trabajo artesanal. Aquí queda
 * escrito QUÉ módulos existen, cómo se llaman de cara al cliente y qué
 * dependencias tienen, para que el alta sea elegir de una lista.
 *
 * REGLA: si un módulo no está en esta lista, no se puede activar desde el alta.
 * Los módulos a medida se siguen programando de cero, como hasta ahora.
 */

/**
 * `requiere`: módulos sin los que ese no tiene sentido (se marcan solos).
 * `avisa`: nota honesta para quien vende — lo que ese módulo NECESITA además
 * del CRM (una clave, una web, una cuenta de terceros).
 */
export const CATALOGO = [
  {
    grupo: "Base",
    modulos: [
      { key: "clients", nombre: "Clientes", desc: "Fichas de clientes, contactos, adjuntos e historial.", recomendado: true },
      { key: "leads", nombre: "Leads / Comercial", desc: "Embudo de oportunidades por etapas, con importación desde Excel.", recomendado: true },
      { key: "team", nombre: "Equipo básico", desc: "Plantilla, altas, usuarios del CRM, roles y a qué módulos accede cada persona.", recomendado: true },
      { key: "team_avanzado", nombre: "Equipo avanzado", desc: "Desempeño, dirección, productividad, incidencias, bandeja de trabajo, ocupación y registro de actividad.", requiere: ["team"] },
      { key: "documents", nombre: "Documentos", desc: "Archivo central de documentos por carpetas, enlazados al cliente." },
    ],
  },
  {
    grupo: "Agenda y trabajo",
    modulos: [
      { key: "citas", nombre: "Citas", desc: "Reservas online con página pública, recordatorios y portal del paciente.", avisa: "Para reservas desde su web hace falta incrustar el widget." },
      { key: "calendar", nombre: "Calendario", desc: "Calendario interno de tareas del equipo." },
      { key: "projects", nombre: "Proyectos", desc: "Tableros tipo kanban con fases, hitos y tareas asignadas." },
      { key: "support", nombre: "Soporte", desc: "Tickets de sus clientes, con portal público y avisos por email." },
    ],
  },
  {
    grupo: "Dinero",
    modulos: [
      { key: "billing", nombre: "Facturación", desc: "Facturas con PDF, presupuestos, cobros, gastos y analítica.", avisa: "Verifactu todavía NO está integrado." },
      { key: "orders", nombre: "Pedidos", desc: "Pedidos de cliente con líneas y estados." },
      { key: "inventory", nombre: "Inventario", desc: "Entradas, lotes, fórmulas y movimientos de stock." },
    ],
  },
  {
    grupo: "Salud",
    modulos: [
      { key: "pacientes", nombre: "Pacientes", desc: "Ficha del paciente separada del pagador (tutor), con contratos.", requiere: ["clients"] },
      { key: "clinica", nombre: "Clínica", desc: "Sesiones, informes y coordinaciones. Transcripción de audio con IA.", requiere: ["pacientes"], avisa: "La transcripción y el resumen con IA necesitan que el cliente ponga sus claves." },
      { key: "nutricion", nombre: "Nutrición", desc: "Recetario, alimentos y menús semanales asignables a pacientes.", requiere: ["clients"] },
    ],
  },
  {
    grupo: "Captación y web",
    modulos: [
      { key: "formularios", nombre: "Formularios", desc: "Formularios públicos que caen en una bandeja y se convierten en ficha.", requiere: ["clients"] },
      { key: "outreach", nombre: "Captación", desc: "Búsqueda de empresas y análisis con IA para prospección en frío.", avisa: "Necesita las claves de IA y de Google del propio cliente." },
      { key: "referidos", nombre: "Referidos", desc: "Programa de recomendaciones con formulario público.", avisa: "Hoy está hecho a medida de un cliente; requiere ajuste." },
      { key: "training", nombre: "Formación", desc: "Cursos, alumnos y matrículas. Se sincroniza con TutorLMS.", avisa: "La sincronización exige un WordPress con TutorLMS." },
      { key: "cuestionarios", nombre: "Cuestionarios", desc: "Resultados de cuestionarios de TutorLMS.", requiere: ["training"] },
    ],
  },
];

/** Lista plana de claves válidas. */
export const CLAVES_VALIDAS = new Set(CATALOGO.flatMap((g) => g.modulos.map((m) => m.key)));

/** Metadatos de un módulo por clave. */
export function moduloPorClave(key) {
  for (const g of CATALOGO) {
    const m = g.modulos.find((x) => x.key === key);
    if (m) return m;
  }
  return null;
}

/**
 * Añade las dependencias que falten (en cascada) y descarta claves inventadas.
 * Ej.: elegir "clinica" arrastra "pacientes" y este a su vez "clients".
 */
export function resolverDependencias(seleccion) {
  const fuera = new Set();
  const pendientes = [...new Set((seleccion || []).filter((k) => CLAVES_VALIDAS.has(k)))];

  while (pendientes.length) {
    const k = pendientes.pop();
    if (fuera.has(k)) continue;
    fuera.add(k);
    const meta = moduloPorClave(k);
    for (const dep of meta?.requiere || []) {
      if (!fuera.has(dep)) pendientes.push(dep);
    }
  }
  // Orden estable según el catálogo, para que el alta sea reproducible.
  return CATALOGO.flatMap((g) => g.modulos.map((m) => m.key)).filter((k) => fuera.has(k));
}

/** Los que vienen marcados por defecto en la pantalla de alta. */
export const RECOMENDADOS = CATALOGO.flatMap((g) => g.modulos.filter((m) => m.recomendado).map((m) => m.key));
