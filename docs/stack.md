# Stack tecnológico — CRM Salamandra Solutions

Listado completo de tecnologías de la aplicación. Combina las decisiones de
`CLAUDE.md` con las dependencias reales de `package.json`. Al añadir o quitar
una dependencia relevante, actualizar también este doc.

---

## Lenguaje y runtime

| Tecnología     | Versión | Notas                                             |
| -------------- | ------- | ------------------------------------------------- |
| JavaScript     | ESM     | JS puro, SIN TypeScript (`"type": "module"`)      |
| Node.js        | 22      | Alpine en producción (Docker)                     |

## Framework principal

| Tecnología | Versión | Notas                                            |
| ---------- | ------- | ------------------------------------------------ |
| Next.js    | 16.2    | App Router + Route Handlers (frontend + backend) |
| React      | 19.2    | —                                                |
| React DOM  | 19.2    | —                                                |

## Base de datos y ORM

| Tecnología | Versión     | Notas                                     |
| ---------- | ----------- | ----------------------------------------- |
| PostgreSQL | 16-alpine   | Multi-tenant por schema (`crm_{slug}`)    |
| Sequelize  | 6.37        | ORM                                       |
| pg         | 8.20        | Driver PostgreSQL                         |
| pg-hstore  | 2.3         | Serialización hstore                      |

## Estilos / UI

| Tecnología             | Versión | Notas                                              |
| ---------------------- | ------- | -------------------------------------------------- |
| Tailwind CSS           | 4.2     | `@tailwindcss/postcss`                             |
| PostCSS                | 8.5     | —                                                  |
| autoprefixer           | 10.4    | —                                                  |
| @dnd-kit (core/sortable/utilities) | 6.3 / 10.0 / 3.2 | Drag & drop — Kanban de Proyectos     |
| FullCalendar           | 6.1     | core, react, daygrid, timegrid, list, interaction — módulo Citas |

## Autenticación y seguridad

| Tecnología | Versión | Notas                                      |
| ---------- | ------- | ------------------------------------------ |
| jose       | 6.2     | JWT en httpOnly cookies                    |
| bcrypt     | 6.0     | Hashing de passwords (mín. 12 rounds)      |

## Documentos y email

| Tecnología | Versión | Notas                                  |
| ---------- | ------- | -------------------------------------- |
| ExcelJS    | 4.4     | Exportaciones a Excel                  |
| Resend     | 4.0     | Envío de emails transaccionales        |

> Además hay skills disponibles para generación de **PDF** y **DOCX** cuando aplique.

## Servicios externos / integraciones

| Servicio             | Uso                                                      |
| -------------------- | ------------------------------------------------------- |
| n8n (instancia propia) | Motor de automatizaciones vía webhooks                |
| OpenAI API           | Módulo IA                                               |
| Facturantia API      | Verifactu / facturación                                 |
| WordPress + TutorLMS | Módulo Formación (Retorika) y SSO de Citas (nutri_laura) |

## Infraestructura y despliegue

| Tecnología      | Notas                                                       |
| --------------- | ---------------------------------------------------------- |
| Docker + Compose | Despliegue en VPS propio                                   |
| nginx           | Proxy nativo en el VPS (no dockerizado)                    |
| VPS propio      | `deploy.sh` — build en host, artefactos a Docker           |

## Tooling de desarrollo

| Tecnología | Versión | Notas                                                    |
| ---------- | ------- | -------------------------------------------------------- |
| ESLint     | 9       | Flat config + `eslint-config-next`, `-prettier`          |
| Prettier   | 3.8     | Formatter                                                |
| VS Code    | —       | Editor                                                   |
| PowerShell | —       | Terminal en local (Windows)                              |
