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
 *
 * ⚠️ `requiere` YA NO ES QUIEN MANDA (10/08/2026). Quien decide qué se puede
 * activar con qué es `dependencias.js`, que está escrita leyendo el código y
 * comprobada contra producción. Esto se mantiene al día porque es lo que se LEE
 * al vender: si dice menos de lo que el alta va a exigir, alguien ofrecerá un
 * módulo suelto y se llevará la sorpresa al marcarlo. `discrepanciasConCatalogo()`
 * lo vigila y lo saca en /admin/integraciones.
 */
export const CATALOGO = [
  {
    grupo: "Base",
    modulos: [
      { key: "clients", nombre: "Clientes", desc: "Fichas de clientes, contactos, adjuntos e historial.", recomendado: true },
      { key: "clients_avanzado", nombre: "Clientes avanzado", desc: "Lista de espera de admisión (gente esperando plaza, por orden de llegada) y «Fichas a completar», el repaso de huecos de datos por carpetas. Para centros con muchas fichas.", requiere: ["clients"] },
      { key: "leads", nombre: "Leads profesionales", desc: "Embudo por etapas de quien deriva o pregunta: profesionales, centros y contactos directos. Importable desde Excel.", recomendado: true },
      { key: "team", nombre: "Equipo básico", desc: "Plantilla, altas, usuarios del CRM, roles y a qué módulos accede cada persona.", recomendado: true },
      { key: "fichaje", nombre: "Fichaje", desc: "Control horario: se vuelca el Excel del reloj de fichar cada mes y queda el registro por persona y día, con horas extra, avisos y correcciones a mano justificadas.", requiere: ["team"], avisa: "El lector del Excel se adapta al fichero de cada cliente: hay que ver un mes real antes de activarlo." },
      { key: "team_avanzado", nombre: "Equipo avanzado", desc: "Desempeño, dirección, productividad, incidencias, bandeja de trabajo, ocupación y registro de actividad.", requiere: ["team"] },
      // YA NO EXIGE CITAS (24/08/2026, Rodrigo). Entre el 10 y el 24/08 pidió
      // `citas` además de `clients`, y era una puerta COMERCIAL, no técnica: se
      // razonó que lo que se vende no es «guardar un PDF» sino «que la familia
      // lo firme», y el área privada donde se firma es de Citas.
      //
      // El día que hizo falta para un cliente que no es un centro —Laura Úbeda,
      // que necesita guardar el rider técnico y el dossier de prensa— la regla
      // dejó fuera un caso legítimo. Y en el CÓDIGO nunca hubo tal dependencia:
      // el único gate de `/api/documents/contrato-servicios` es DOCUMENTS.
      //
      // Cómo queda: Documentos se activa solo, y la firma en el área privada
      // sigue existiendo tal cual PARA QUIEN TENGA CITAS. Es integración, no
      // requisito: sin Citas se sube, se ve y se descarga, pero no hay portal
      // donde firmarlo — que es exactamente lo que quiere quien no atiende
      // familias. `clients` sí se queda: un documento cuelga de una ficha.
      { key: "documents", nombre: "Documentos básico", desc: "El Contrato de Prestación de Servicios del centro: subirlo, verlo y descargarlo. Si además hay Citas, la familia lo firma en su área privada.", requiere: ["clients"] },
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
      // Sin Clientes no se puede emitir NI UNA factura: `invoices.client_id` es
      // NOT NULL y las fichas solo se crean desde el módulo Clientes.
      { key: "billing", nombre: "Facturación", desc: "Facturas con PDF, presupuestos, cobros, gastos y analítica.", requiere: ["clients"], avisa: "Verifactu todavía NO está integrado." },
      // Dar un pedido por servido es lo que genera la factura borrador: sin
      // Facturación responde 403 y el pedido se queda en borrador para siempre.
      { key: "orders", nombre: "Pedidos", desc: "Pedidos de cliente con líneas y estados.", requiere: ["clients", "billing"] },
      { key: "inventory", nombre: "Inventario", desc: "Productos, entradas de mercancía y movimientos de stock; proveedores compartidos con Gastos." },
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
      // BOOKING (24/08/2026). Para agencias de management y artistas: quien
      // vende actuaciones, no servicios.
      //
      // No abre pantallas nuevas: CAMBIA las que ya hay. El embudo de Leads
      // pasa a ser el de contratación —propuesta enviada, han respondido,
      // negociando caché, fecha cerrada— y Clientes pasa a llamarse
      // «Contratantes», que es lo que son un ayuntamiento o una sala. Por eso
      // exige los dos: sin ellos no hay nada que reetiquetar.
      //
      // Se vende dentro de «Captación y web» y no en «Base» a propósito: es un
      // módulo de sector, no algo que necesite cualquier cliente.
      // TIENDA (25/08/2026). Escaparate público de lo que ya hay en Inventario.
      // Exige los tres del trío: los productos viven en `inventory`, los
      // pedidos caen en `orders` y el comprador se convierte en ficha de
      // `clients`. Vender sin ninguno de los tres sería un formulario de pago
      // sin nada detrás.
      { key: "tienda", nombre: "Tienda online", desc: "Escaparate público de tus productos: catálogo, carrito y pago con tarjeta. Los pedidos entran en Pedidos y descuentan stock de Inventario.", requiere: ["inventory", "orders", "clients"], avisa: "Necesita las claves de Stripe del propio cliente y una dirección donde incrustar la tienda." },
      { key: "booking", nombre: "Booking", desc: "Contratación de actuaciones: embudo de propuestas a festivales, salas y ayuntamientos, con caché, aforo y fecha del bolo. Clientes pasa a llamarse «Contratantes».", requiere: ["clients", "leads"], avisa: "Cambia el embudo de Leads y el rótulo de Clientes para todo el cliente." },
      /*
       * REFERIDOS YA NO EXISTE (12/08/2026). Por la mañana se retiró del
       * catálogo —se podía marcar en un alta y venderle a alguien algo que no
       * le iba a funcionar— y por la tarde Rodrigo lo mandó quitar entero:
       * «era una cosa que pidió Abarca y que nadie ha querido».
       *
       * Se fue con su cliente. Abarcaia era el único que lo tenía encendido, y
       * ese mismo día se dio de baja y se purgó su schema. Con él se fueron la
       * pantalla (`/referidos`), sus tres endpoints, el formulario público y
       * los dos overrides de leads que colgaban de aquello.
       *
       * Nunca fue un módulo de verdad: no tenía tabla propia —su pantalla leía
       * y escribía `leads` filtrando por `customFields.source =
       * 'referido_abarcaia'`, con el nombre del cliente dentro del código— y
       * sus endpoints exigían `leads` y NUNCA `referidos`.
       */
      // Faltaba desde que se construyó (10/08/2026). Tenía pantalla y endpoint
      // en producción, pero al no estar aquí no se podía activar desde el alta
      // ni ofrecer como línea: había que meterlo a mano en la base de datos.
      { key: "analytics", nombre: "Analítica web", desc: "Visitas de su web día a día, con su histórico, dentro del CRM.", avisa: "Necesita que el cliente tenga su web en Cloudflare y nos dé un token de solo lectura." },
      { key: "training", nombre: "Formación", desc: "Cursos, alumnos y matrículas. Se sincroniza con TutorLMS. Incluye los resultados de los cuestionarios.", avisa: "La sincronización exige un WordPress con TutorLMS. Las matrículas se hacen POR EMPRESA: hoy no se puede matricular a un alumno suelto desde el CRM." },
      // CUESTIONARIOS YA NO SE VENDE APARTE (10/08/2026, decisión de Jorge).
      // Nunca fue un módulo de verdad: la puerta de sus siete endpoints era
      // `training || cuestionarios`, así que todo el que compraba Formación lo
      // tenía igual. Y los datos lo confirmaban al revés de como parecía: el
      // único tenant con intentos reales (retorika, 526 de 65 alumnos) NO tenía
      // la clave, y los dos que sí la tenían —aumenta y demo— tenían 0 y 18.
      // Se queda como pantalla de Formación (/formacion/cuestionarios). Ni el
      // código ni la tabla `quiz_attempts` se tocan.
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

/*
 * `resolverDependencias()` VIVÍA AQUÍ y se ha ido a `dependencias.js`, partida
 * en dos: `validarSeleccion()` y `completarSeleccion()` (10/08/2026).
 *
 * Motivo (regla #2), dos cosas: resolvía la cascada mirando SOLO el `requiere`
 * de arriba, que estaba incompleto en seis módulos; y la aplicaba EN SILENCIO,
 * que es lo que se ha quitado — lo que entra en esa lista entra en la factura
 * del cliente, así que no puede entrar sin que nadie lo haya marcado.
 *
 * No se ha dejado un envoltorio aquí a propósito: dos funciones que resuelven
 * dependencias, una completa y otra no, se acaban llamando por error.
 */

/**
 * PAQUETES_SEMILLA — lo que se vende con un nombre, no módulo a módulo
 * (01/08/2026).
 *
 * Un paquete es solo un atajo: marca sus módulos en el alta y desde ahí se
 * puede quitar o añadir lo que sea. **No queda guardado en ninguna parte**,
 * porque lo que factura un cliente y lo que ve en el menú tienen que poder
 * divergir (un extra contratado no convierte a nadie en «otro paquete»). Eso
 * sigue igual y no va a cambiar (Jorge, 12/08/2026).
 *
 * ⚠️ ESTO YA NO ES LA FUENTE (12/08/2026). Desde hoy los paquetes se crean y se
 * editan desde el back-office y viven en `master.paquetes_modulos`; esta lista
 * es la SEMILLA con la que arranca esa tabla —la inserta
 * `scripts/migrate-paquetes-modulos.js`— y el respaldo que se enseña si la
 * migración todavía no se ha corrido. **En una petición normal no la lee
 * nadie**: quien quiere los paquetes usa `lib/provisioning/paquetesStore.js`.
 *
 * Se conserva escrita, y no se borra al migrar, por dos motivos: es de dónde
 * arranca un entorno nuevo, y son los comentarios de abajo —qué entra en cada
 * paquete y qué se dejó fuera a propósito— los que explican unas decisiones que
 * en una fila de base de datos se perderían.
 *
 * El freno que protegía el «solo se escribe aquí un paquete cuando está
 * DECIDIDO qué lleva» era pasar por un diff. Ahora vive en
 * `lib/provisioning/paquetes.js`, que no deja guardar un paquete con módulos
 * que no existen ni con dependencias que no se sostienen.
 */
export const PAQUETES_SEMILLA = [
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

/*
 * `paquetePorClave()` vivía aquí y se ha ido (12/08/2026). No tenía ni un
 * consumidor —se escribió por simetría con `moduloPorClave()` y nadie la llamó
 * nunca—, y ahora habría sido peor que inútil: buscaría en la SEMILLA, que ya
 * no es lo que hay. Quien necesite un paquete lo pide a
 * `lib/provisioning/paquetesStore.js`, que lee la tabla.
 */

/** Los que vienen marcados por defecto en la pantalla de alta. */
export const RECOMENDADOS = CATALOGO.flatMap((g) => g.modulos.filter((m) => m.recomendado).map((m) => m.key));
