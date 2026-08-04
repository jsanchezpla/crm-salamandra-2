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
      { key: "clients_avanzado", nombre: "Clientes avanzado", desc: "Lista de espera de admisión (gente esperando plaza, por orden de llegada) y «Fichas a completar», el repaso de huecos de datos por carpetas. Para centros con muchas fichas.", requiere: ["clients"] },
      { key: "leads", nombre: "Leads profesionales", desc: "Embudo por etapas de quien deriva o pregunta: profesionales, centros y contactos directos. Importable desde Excel.", recomendado: true },
      { key: "team", nombre: "Equipo básico", desc: "Plantilla, altas, usuarios del CRM, roles y a qué módulos accede cada persona.", recomendado: true },
      { key: "team_avanzado", nombre: "Equipo avanzado", desc: "Desempeño, dirección, productividad, incidencias, bandeja de trabajo, ocupación y registro de actividad.", requiere: ["team"] },
      { key: "documents", nombre: "Documentos básico", desc: "Solo el Contrato de Prestación de Servicios del centro: subirlo, verlo y que la familia lo firme en su área privada." },
      { key: "documents_avanzado", nombre: "Documentos avanzado", desc: "El archivo completo: carpetas, buscador y subida de cualquier documento enlazado al cliente.", requiere: ["documents"] },
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
      { key: "formularios", nombre: "Leads comerciales", desc: "Los que llegan por la web: formularios públicos que caen en una bandeja de aceptación y se convierten en ficha.", requiere: ["clients", "leads"] },
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

/**
 * PAQUETES — lo que se vende con un nombre, no módulo a módulo (01/08/2026).
 *
 * Un paquete es solo un atajo: marca sus módulos en el alta y desde ahí se
 * puede quitar o añadir lo que sea. No queda guardado en ninguna parte, porque
 * lo que factura un cliente y lo que ve en el menú tienen que poder divergir
 * (un extra contratado no convierte a nadie en «otro paquete»).
 *
 * Solo se escribe aquí un paquete cuando está DECIDIDO qué lleva. Media
 * definición en el código es peor que ninguna: se acaba vendiendo lo que
 * alguien marcó un martes.
 */
export const PAQUETES = [
  {
    key: "nutricion",
    nombre: "Paquete Nutrición",
    desc: "Lo que tiene un centro de nutrición: agenda con área privada, fichas, leads profesionales y comerciales, equipo y el contrato del centro.",
    // Definido por Rodrigo el 01/08/2026 sobre lo que usa nutri_laura. Ojo:
    // Formación (`training`) NO entra — es un extra que ella tiene contratado.
    modulos: ["citas", "clients", "leads", "formularios", "team", "documents", "nutricion"],
  },
  {
    key: "clinica",
    nombre: "Paquete Clínica",
    desc: "El de Nutrición cambiando el recetario por el bloque clínico: pacientes, sesiones, informes y coordinaciones.",
    // Definido por Rodrigo el 01/08/2026: «lo mismo que el de Nutrición pero
    // cambiando Nutrición por Clínica completo». `pacientes` va escrito aunque
    // `clinica` lo arrastre solo: quien lee la lista tiene que ver que el
    // paquete incluye la ficha del paciente separada del pagador.
    // Equipo AVANZADO (desempeño, dirección, productividad) NO entra: es un
    // extra, igual que Formación en el de Nutrición.
    modulos: ["citas", "clients", "leads", "formularios", "team", "documents", "pacientes", "clinica"],
  },
];

/** Un paquete por clave. */
export function paquetePorClave(key) {
  return PAQUETES.find((p) => p.key === key) ?? null;
}

/** Los que vienen marcados por defecto en la pantalla de alta. */
export const RECOMENDADOS = CATALOGO.flatMap((g) => g.modulos.filter((m) => m.recomendado).map((m) => m.key));
