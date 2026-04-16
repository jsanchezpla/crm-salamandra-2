import { DataTypes } from "sequelize";

export function defineCourse(sequelize) {
  return sequelize.define(
    "Course",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      wpCourseId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      wcProductId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
      },
    },
    {
      tableName: "courses",
    }
  );
}
