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
  // Las herramientas de gestión de equipo (desempeño, dirección, productividad,
  // incidencias y bandeja) se movieron de /clinica/* a /equipo/* el 2026-07-27:
  // son de gestión de equipo, no clínicas. El equipo de Aumenta llevaba días
  // usándolas, así que las URLs viejas (marcadores, enlaces pegados en chats)
  // siguen funcionando con una redirección permanente.
  //
  // OJO: solo rutas de PÁGINA. Los endpoints /api/clinica/* NO se tocan.
  async redirects() {
    return [
      ...["mi-desempeno", "direccion", "productividad", "incidencias", "bandeja"].map((p) => ({
        source: `/clinica/${p}`,
        destination: `/equipo/${p}`,
        permanent: true,
      })),
      // El portal del paciente pasó de "Mis citas" a "Mi perfil" (2026-07-27):
      // ahora también tiene sus documentos. La URL vieja la tienen enlazada
      // desde la web y en correos ya enviados, así que sigue funcionando.
      {
        source: "/widget/c/:tenantSlug/mis-citas",
        destination: "/widget/c/:tenantSlug/mi-perfil",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
