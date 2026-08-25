import { DataTypes } from "sequelize";

/**
 * ProductVariant — la talla, el color, la capacidad.
 *
 * ── POR QUÉ HACE FALTA ─────────────────────────────────────────────────────
 * Sin esto no se puede vender una camiseta, que es el caso que motivó la
 * tienda (25/08/2026). Y no es solo ropa: un congelador industrial viene en
 * 300, 500 y 800 litros, y son el mismo producto con tres precios y tres
 * stocks. Meterlos como tres productos sueltos parte la ficha, la foto y la
 * descripción en tres, y obliga a mantenerlas a mano.
 *
 * ── LO QUE SE DECIDIÓ Y POR QUÉ ────────────────────────────────────────────
 *
 * **Un solo eje, no una matriz.** Talla × color daría doce variantes de una
 * camiseta y una pantalla de administración que nadie rellena. Aquí una
 * variante es una línea con su nombre («Talla M», «Azul · L», «500 litros»),
 * y quien necesite combinar dos ejes escribe el nombre completo. Es menos
 * elegante y muchísimo más fácil de usar; si algún día hace falta la matriz,
 * se añade un `axis` y estas siguen valiendo.
 *
 * **`salePrice` nullable = hereda el del producto.** Una camiseta con cuatro
 * tallas al mismo precio se define UNA vez; la XXL que cuesta dos euros más se
 * resuelve rellenando un campo. Obligar a repetir el precio en cada variante
 * es garantizar que un día tres digan 18 € y una diga 15 €.
 *
 * **El stock es de la VARIANTE, no del producto.** `stock_movements.variant_id`
 * (nullable) lo permite: un producto sin variantes mueve stock con `variant_id`
 * a NULL, exactamente como antes. Nada de lo que ya funcionaba cambia.
 */
export function defineProductVariant(sequelize) {
  return sequelize.define(
    "ProductVariant",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      productId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: "product_id",
      },
      /** Lo que ve quien compra: «Talla M», «500 litros», «Azul · L». */
      name: {
        type: DataTypes.STRING(120),
        allowNull: false,
      },
      /** Referencia propia, si el almacén las distingue. */
      sku: {
        type: DataTypes.STRING(80),
        allowNull: true,
      },
      /** Vacío = el precio del producto. Ver la cabecera. */
      salePrice: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        field: "sale_price",
      },
      sortOrder: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        field: "sort_order",
      },
      /**
       * Una talla agotada de temporada se desactiva, no se borra: los pedidos
       * viejos siguen apuntando a ella y su nombre tiene que poder leerse.
       */
      active: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
    },
    {
      tableName: "product_variants",
      indexes: [{ fields: ["product_id"], name: "product_variants_product_idx" }],
    }
  );
}
