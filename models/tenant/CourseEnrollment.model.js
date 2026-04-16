import { DataTypes } from "sequelize";

export function defineCourseEnrollment(sequelize) {
  return sequelize.define(
    "CourseEnrollment",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      trainingUserId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "training_users", key: "id" },
      },
      courseId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: "courses", key: "id" },
      },
      companyId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: "companies", key: "id" },
      },
      enrolledAt: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
      },
      externalRegistrationId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      metadata: {
        type: DataTypes.JSONB,
        defaultValue: {},
      },
    },
    {
      tableName: "course_enrollments",
      indexes: [
        {
          unique: true,
          fields: ["training_user_id", "course_id"],
        },
      ],
    }
  );
}
