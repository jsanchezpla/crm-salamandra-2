import { DataTypes } from "sequelize";

export function defineCompanyCourse(sequelize) {
  return sequelize.define(
    "CompanyCourse",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      companyId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "companies", key: "id" },
      },
      courseId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "courses", key: "id" },
      },
    },
    {
      tableName: "company_courses",
      indexes: [
        {
          unique: true,
          fields: ["company_id", "course_id"],
        },
      ],
    }
  );
}
