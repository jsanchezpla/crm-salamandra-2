/**
 * socios — ¿este centro reparte su facturación por socios? (31/08/2026)
 *
 * La pestaña «Por socio», el campo «Socio» de factura y gasto y el «Cliente
 * (opcional)» del gasto salían SIEMPRE: un centro sin socios (Aumenta) veía
 * una analítica con una sola fila «Sin asignar» y campos que nadie usa. La
 * vara, con nombre y en un solo sitio: si no hay socios CONFIGURADOS
 * (`tenant_billing_settings.partners`), nada de eso se enseña — el gasto
 * atribuible a un cliente es el mismo rasgo de facturación de despacho que el
 * reparto por socios, por eso comparten interruptor. Configurar un socio por
 * la API lo enciende todo sin tocar código; no hace falta submódulo.
 *
 * Solo la regla pura: la vive el navegador (formularios). La consulta de
 * servidor para el layout está en sociosServidor.js — importarla aquí
 * arrastraría Sequelize al bundle del cliente.
 */
export function haySocios(settings) {
  return Array.isArray(settings?.partners) && settings.partners.length > 0;
}
