import { DataTypes } from "sequelize";

export function defineProject(sequelize) {
  const Project = sequelize.define(
    "Project",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      // Código corto del proyecto. Generado automático tipo "PRY-2026-0001"
      // o editable. La unicidad real vive en BD como índice UNIQUE PARCIAL
      // (`projects_code_unique` WHERE code IS NOT NULL — ver migrate-projects-
      // sprint-1.js). Aquí dejamos `unique: false` para que `sync({alter:true})`
      // no intente recrearlo como UNIQUE total (rompería con múltiples
      // proyectos `code=NULL`). Backlog: reflejar el índice parcial con
      // `indexes:[{ unique: true, fields: ['code'], where: { code: { [Op.ne]: null } } }]`.
      code: {
        type: DataTypes.STRING(32),
        allowNull: true,
        unique: false,
      },
      clientId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      name: {
        type: DataTypes.STRING(200),
        allowNull: false,
        validate: { len: [1, 200] },
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      status: {
        type: DataTypes.ENUM("draft", "active", "paused", "completed", "cancelled"),
        allowNull: false,
        defaultValue: "draft",
      },
      priority: {
        type: DataTypes.ENUM("low", "medium", "high", "urgent"),
        allowNull: false,
        defaultValue: "medium",
      },
      startDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      // Fecha límite acordada (cuándo debería terminar). Distinta de
      // `completedAt` (cuándo realmente terminó).
      dueDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },
      completedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      // Presupuesto cerrado del proyecto. Solo admin/superadmin o lead del
      // proyecto pueden verlo (filtrado en `lib/projects/serializeProject.js`).
      budgetAmount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: true,
        validate: { min: 0 },
      },
      budgetCurrency: {
        type: DataTypes.STRING(3),
        allowNull: false,
        defaultValue: "EUR",
      },
      estimatedHours: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
        validate: { min: 0 },
      },
      tags: {
        type: DataTypes.JSONB,
        defaultValue: [],
      },
      customFields: {
        type: DataTypes.JSONB,
        defaultValue: {},
      },
      // Soft delete operativo. Ortogonal a `status='cancelled'`. Por defecto
      // los listados filtran `archivedAt IS NULL`.
      archivedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      tableName: "projects",
      hooks: {
        beforeUpdate(project) {
          if (
            project.changed("status") &&
            project.status === "completed" &&
            !project.completedAt
          ) {
            project.completedAt = new Date();
          }
        },
        beforeCreate(project) {
          if (project.status === "completed" && !project.completedAt) {
            project.completedAt = new Date();
          }
        },
      },
      validate: {
        dueDateAfterStartDate() {
          if (this.startDate && this.dueDate && this.dueDate < this.startDate) {
            throw new Error("dueDate debe ser >= startDate");
          }
        },
      },
    }
  );

  return Project;
}
