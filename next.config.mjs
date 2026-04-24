/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["sequelize", "pg", "pg-hstore", "bcrypt"],
  // Standalone deshabilitado: bcrypt usa módulos nativos que no se copian bien
  // Usamos npm start directamente con node_modules completos
  transpilePackages: [
    "@fullcalendar/core",
    "@fullcalendar/react",
    "@fullcalendar/daygrid",
    "@fullcalendar/timegrid",
    "@fullcalendar/list",
    "@fullcalendar/interaction",
  ],
};

export default nextConfig;
