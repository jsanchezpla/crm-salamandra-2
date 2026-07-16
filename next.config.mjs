/** @type {import('next').NextConfig} */
const nextConfig = {
  // pdfkit/archiver: paquetes con assets propios (fuentes .afm de pdfkit) que se
  // rompen al bundlearse (ENOENT de Helvetica.afm). Se cargan desde node_modules.
  serverExternalPackages: ["sequelize", "pg", "pg-hstore", "bcrypt", "pdfkit", "archiver"],
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
