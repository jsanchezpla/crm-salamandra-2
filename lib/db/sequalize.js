import { Sequelize } from "sequelize";

export function createSequelizeInstance(schema) {
  return new Sequelize(process.env.DATABASE_URL, {
    dialect: "postgres",
    schema,
    searchPath: schema,
    define: {
      underscored: true,
      timestamps: true,
      schema,
    },
    pool: {
      max: 5,
      min: 0,
      acquire: 30000,
      idle: 10000,
    },
    logging: process.env.NODE_ENV === "development" ? console.log : false,
  });
}
