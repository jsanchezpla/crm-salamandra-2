/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["sequelize", "pg", "pg-hstore", "bcrypt"],
  // Standalone deshabilitado: bcrypt usa módulos nativos que no se copian bien
  // Usamos npm start directamente con node_modules completos
};

export default nextConfig;
