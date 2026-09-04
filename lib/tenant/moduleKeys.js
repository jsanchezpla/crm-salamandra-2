/**
 * Claves canónicas de módulo (master.tenant_modules.module_key).
 *
 * `moduleKey` es un STRING libre sin enum/FK, así que un typo ("document" vs
 * "documents") crea una fila huérfana que ni el sidebar ni la API casan nunca.
 * El módulo Documents introduce esta constante para usar la MISMA key en el
 * gate de endpoints, el enable script y la migración.
 *
 * Backlog (no en Sprint 1): extraer las demás keys del Sidebar y centralizarlas
 * aquí, y referenciarlas desde el Sidebar y los enable/migrate existentes.
 */
export const MODULE_KEYS = Object.freeze({
  // Booking: contratación de actuaciones (agencias de management y artistas).
  // Es la primera clave que decide COSAS DEL PRODUCTO además de abrir pantallas:
  // de ella dependen el embudo (`lib/leads/embudos.js`), el rótulo del embudo y
  // el vocabulario de Clientes, que pasa a decir «Contratantes». Todo eso se
  // pregunta por MÓDULO y no por slug a propósito, para que el segundo cliente
  // del sector salga bien de fábrica sin tocar código.
  BOOKING: "booking",
  // Facturación y Citas entran aquí el 04/09/2026 porque la página de Productos
  // pregunta por las dos para decidir si enseña la pestaña de SERVICIOS: las
  // cuotas son de Facturación y los tipos de cita, de Citas.
  BILLING: "billing",
  CITAS: "citas",
  CLIENTS: "clients",
  // Clientes AVANZADO: hoy, la lista de espera de ADMISIÓN (gente esperando
  // plaza). Nació encendida para todo el que tuviera `clients`, y un centro de
  // nutrición no admite por cola: no le sobra la pantalla, le sobra el concepto.
  CLIENTS_AVANZADO: "clients_avanzado",
  // Documentos BÁSICO: solo el Contrato de Prestación de Servicios del centro.
  // Es lo que se le da a un cliente que no necesita un archivo entero.
  DOCUMENTS: "documents",
  // Documentos AVANZADO: el archivo completo (carpetas, buscador, subida
  // general). Mismo patrón que `team` / `team_avanzado`.
  DOCUMENTS_AVANZADO: "documents_avanzado",
  // Fichaje: control horario. Cuelga de `team` y NO de `team_avanzado` a
  // propósito — los submenús del avanzado exigen además `clinica`, y eso
  // dejaría el control horario atado a un centro clínico. Quien compra un
  // control horario es justo el que solo quiere Equipo.
  FICHAJE: "fichaje",
  FORMULARIOS: "formularios",
  // Pacientes: en un centro clínico el CLIENTE es la familia que paga y los
  // PACIENTES son los hijos, con su propia tabla. Quien no tiene este módulo
  // no tiene la tabla `patients`, así que todo lo que la escriba debe
  // comprobarlo ANTES de abrir una transacción (un INSERT contra una tabla que
  // no existe hace rollback de todo lo demás).
  PACIENTES: "pacientes",
  // Productos (03/09/2026): el módulo grande del que cuelgan Inventario,
  // Pedidos y Tienda. El BÁSICO es el catálogo con su valor (la tabla
  // `products` y su endpoint); el AVANZADO añade las estadísticas de venta y
  // es la puerta del menú a los tres de abajo. Mismo patrón que
  // `documents` / `documents_avanzado`.
  PRODUCTOS: "productos",
  PRODUCTOS_AVANZADO: "productos_avanzado",
  // Los tres que cuelgan de Productos avanzado. Entraron aquí el mismo día
  // porque la página de Productos pregunta por ellos para decidir qué enseña.
  INVENTORY: "inventory",
  ORDERS: "orders",
  SUPPORT: "support",
  // Tienda: el escaparate público de los productos del catálogo. No es un
  // catálogo aparte — vende lo que ya hay en `products`, los pedidos caen en
  // `orders` y el stock se descuenta con un `stock_movements` de tipo `pedido`.
  TIENDA: "tienda",
});
