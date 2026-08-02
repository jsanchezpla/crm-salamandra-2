import { DataTypes } from "sequelize";

/**
 * Product — una cosa que el centro compra, guarda y saca.
 *
 * Sustituye a `InboundProduct` + `OutboundProduct` + `Formula` (rework del
 * 02/08/2026, decisión de Rodrigo: *«Inventario es un módulo hecho a medias.
 * Quiero uno más lógico y normal»*).
 *
 * ── Por qué UNA tabla y no dos ─────────────────────────────────────────────
 *
 * El esquema viejo partía el producto en «entrante» y «de salida» y los unía con
 * recetas. Eso solo tiene sentido si compras materia prima y FABRICAS otra cosa.
 * Un centro clínico compra guantes y saca guantes; una librería compra libros y
 * vende libros. Lo que entra y lo que sale es lo mismo.
 *
 * ── `unit` es el arreglo del problema de fondo ─────────────────────────────
 *
 * El esquema viejo tenía los kilos CABLEADOS en los nombres de columna (`kg`,
 * `kgRemaining`). No es que faltara la unidad: es que no sabía expresar otra
 * cosa que peso. Rodrigo: *«No necesito 3 kg de folios, necesito 400.»*
 *
 * La UI debe enseñar SIEMPRE la unidad junto a la cifra: un «400» a secas no
 * dice si son unidades o kilos, y ese es exactamente el fallo de hoy.
 *
 * `purchasePrice` y `salePrice` son los precios POR DEFECTO. El precio real de
 * una entrada va en `StockEntry.unitCost` y el de una venta en
 * `OrderLine.unitPrice`, los dos editables: lo que pactas con un cliente concreto
 * no puede depender de que nadie edite la ficha del producto.
 */

export const UNIDADES = ["ud", "kg", "g", "l", "ml", "caja", "paquete"];

export const UNIDAD_LABEL = {
  ud: "unidades",
  kg: "kilos",
  g: "gramos",
  l: "litros",
  ml: "mililitros",
  caja: "cajas",
  paquete: "paquetes",
};

export function defineProduct(sequelize) {
  return sequelize.define(
    "Product",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      name: {
        type: DataTypes.STRING(200),
        allowNull: false,
      },
      // Referencia interna del centro. Opcional: mucha gente no usa códigos.
      sku: {
        type: DataTypes.STRING(60),
        allowNull: true,
      },
      // Texto libre a propósito: las categorías de una librería no se parecen en
      // nada a las de un centro clínico, y una lista cerrada le sobraría a los dos.
      category: {
        type: DataTypes.STRING(80),
        allowNull: true,
      },
      unit: {
        type: DataTypes.ENUM(...UNIDADES),
        allowNull: false,
        defaultValue: "ud",
      },
      purchasePrice: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
      },
      salePrice: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
      },
      // Umbral de reposición. Nullable = no avisar: obligar a poner un mínimo
      // llenaría la pantalla de avisos falsos el primer día.
      minStock: {
        type: DataTypes.DECIMAL(12, 3),
        allowNull: true,
      },
      active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      tableName: "products",
      indexes: [
        { fields: ["name"], name: "products_name_idx" },
        { fields: ["active"], name: "products_active_idx" },
        { fields: ["category"], name: "products_category_idx" },
      ],
    }
  );
}
