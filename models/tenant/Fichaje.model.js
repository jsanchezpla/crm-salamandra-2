import { DataTypes } from "sequelize";

/**
 * Fichaje — UN TRAMO TRABAJADO de una persona en un día.
 *
 * El grano es el tramo y no el día ni el marcaje suelto, y eso no es un
 * capricho: aguanta los dos formatos que puede traer un control horario —el que
 * da entrada y salida y el que da solo el total del día— sin rehacer la tabla.
 * Si un día tiene mañana y tarde, son dos filas.
 *
 * ── LO QUE MANDA SOBRE ESTE MODELO ──────────────────────────────────────────
 * Un fichaje mal importado es una nómina mal pagada. De ahí las cuatro reglas:
 *
 * 1. `minutos` es LO ÚNICO obligatorio. Las horas de entrada y salida pueden
 *    faltar (hay máquinas que solo dan el total) y el módulo tiene que seguir
 *    sirviendo.
 * 2. `minutosOriginal` NUNCA se pisa. Guarda lo que decía el Excel para poder
 *    enseñar «el fichero decía 480 y alguien lo dejó en 420», que es la
 *    diferencia entre una corrección y un dato manipulado.
 * 3. `origen` decide qué sobrevive a un re-volcado. Volver a subir el mes
 *    borra (soft) las filas `import` de ese periodo y **respeta** las `manual`
 *    y `corregido`: quien arregló algo a mano no puede perderlo porque otro
 *    suba el Excel otra vez.
 * 4. Nunca se borra de verdad (`deletedAt`). Un registro de jornada es un
 *    documento laboral.
 *
 * La FK a `team_members` va con **RESTRICT**, no CASCADE: que alguien pase a
 * inactivo no puede llevarse por delante su histórico de jornadas. (El CRM ya
 * tiene ese problema en `team_blocks`, ver la revisión de Aumenta 4.10.)
 *
 * NO se guardan totales ni saldos. Se cuentan al leer, en `lib/fichaje/totales.js`,
 * igual que el stock del inventario se suma de sus movimientos: un contador
 * guardado se desincroniza y entonces nadie se fía de ningún número.
 */
export function defineFichaje(sequelize) {
  return sequelize.define(
    "Fichaje",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      teamMemberId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      // DATEONLY y no TIMESTAMP: el día es el día en el que la persona vino a
      // trabajar, en local. Guardarlo como instante lo haría saltar de día en
      // los meses de cambio de hora, y el CRM ya tropezó con eso en las
      // estadísticas de Clínica.
      fecha: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      // Horas de reloj, sin fecha (`08:30`). Nullable las dos: hay ficheros que
      // solo traen el total del día.
      entradaAt: { type: DataTypes.TIME, allowNull: true, field: "entrada_at" },
      salidaAt: { type: DataTypes.TIME, allowNull: true, field: "salida_at" },
      // Lo que el HORARIO decía que tenía que hacer, para poder comparar sin
      // depender de `team_member_hours`, que es el horario de HOY y cambia.
      entradaPrevistaAt: { type: DataTypes.TIME, allowNull: true, field: "entrada_prevista_at" },
      salidaPrevistaAt: { type: DataTypes.TIME, allowNull: true, field: "salida_prevista_at" },
      minutos: {
        type: DataTypes.INTEGER,
        allowNull: false,
        validate: { min: 0, max: 24 * 60 },
      },
      minutosPrevistos: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "minutos_previstos",
        validate: { min: 0, max: 24 * 60 },
      },
      minutosOriginal: {
        type: DataTypes.INTEGER,
        allowNull: true,
        field: "minutos_original",
      },
      tipo: {
        type: DataTypes.ENUM("trabajo", "pausa", "ausencia", "festivo"),
        allowNull: false,
        defaultValue: "trabajo",
      },
      origen: {
        type: DataTypes.ENUM("import", "manual", "corregido"),
        allowNull: false,
        defaultValue: "import",
      },
      importId: { type: DataTypes.UUID, allowNull: true, field: "import_id" },
      // Para poder decir «hoja 9-13, fila 45» en vez de «hubo un error».
      hojaExcel: { type: DataTypes.STRING(120), allowNull: true, field: "hoja_excel" },
      filaExcel: { type: DataTypes.INTEGER, allowNull: true, field: "fila_excel" },
      // Obligatoria cuando `origen != 'import'`. Se exige en el endpoint y no
      // aquí: el motivo lo pone una persona, y el mensaje de error tiene que
      // salir en la pantalla, no en un 500 de Sequelize.
      nota: { type: DataTypes.TEXT, allowNull: true },
      corregidoPorTeamId: { type: DataTypes.UUID, allowNull: true, field: "corregido_por_team_id" },
      corregidoAt: { type: DataTypes.DATE, allowNull: true, field: "corregido_at" },
      deletedAt: { type: DataTypes.DATE, allowNull: true, field: "deleted_at" },
    },
    {
      tableName: "fichajes",
      indexes: [
        { fields: ["team_member_id", "fecha"], name: "fichajes_persona_fecha_idx" },
        { fields: ["fecha"], name: "fichajes_fecha_idx" },
        { fields: ["import_id"], name: "fichajes_import_idx" },
      ],
    }
  );
}
