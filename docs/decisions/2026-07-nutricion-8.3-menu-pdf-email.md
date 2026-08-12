# Sub-sprint 8.3 — Menú en PDF + envío por email al paciente

- **Fecha:** 2026-07-16
- **Riesgo:** 🟡 Medio. Aditivo (sin migración, sin cambios de modelo): 2 endpoints
  nuevos + PDF + plantilla de email + botones en la lista de Pacientes. Toca dos
  ficheros de infraestructura compartida (`lib/email/resendClient.js`,
  `lib/email/templates/layout.js`) con cambios retrocompatibles y de
  endurecimiento (ver abajo).
- **Estado:** implementado, revisado (revisión adversarial, 9 hallazgos
  corregidos), verificado en local (demo + sandbox) y **desplegado**. Entró en
  master el 2026-07-16 con `e51f0d7` y viajó con los despliegues siguientes;
  comprobado el 12/08/2026 en el contenedor — `plans/[id]/pdf` y
  `plans/[id]/send-email` están ahí. Esta línea decía «Sin desplegar» y se quedó
  sin actualizar casi un mes.

Cierra el último trozo del plan de 9 sprints (`prompts-sprints-crm.txt`).

## Qué se construye

- `lib/nutricion/menuPdf.js` — PDF del menú con `pdfkit` (server-side, sin
  navegador): cabecera con marca del tenant, comidas → opciones (foods sueltos +
  recetas congeladas con sus ingredientes) + línea de macros por opción.
- `app/api/nutricion/plans/[id]/pdf` (GET) — descarga del PDF (asignados y
  plantillas).
- `app/api/nutricion/plans/[id]/send-email` (POST) — envía el menú al email del
  paciente con el PDF **adjunto** (el paciente no tiene acceso al dashboard, así
  que un enlace autenticado no le serviría). Solo planes `assigned`.
- `lib/email/templates/nutricion/menuEmail.js` — plantilla sobre el layout
  transversal.
- UI Pacientes (`NutricionAsignadosModule`) — botones **PDF · Enviar · Editar**
  por fila (tabla desktop + card móvil).

## Cambios en infraestructura compartida (regla #2)

- `lib/email/resendClient.js`:
  - **+`attachments`** (pass-through a Resend). Retrocompatible.
  - **Fail-fast de configuración**: en modo live, si el `from` resuelve al
    placeholder `no-reply@example.com` (falta `RESEND_FROM_EMAIL`), aborta antes
    de tocar la red (evita un 403 garantizado de Resend + trabajo desperdiciado).
    Beneficia a todos los callers (citas, outreach, nutrición).
- `lib/email/templates/layout.js`:
  - **Saneado de colores de marca**: `brand.*` se interpola crudo dentro de
    `style="…"` y el endpoint de settings los guarda sin validar → un admin del
    tenant podía inyectar HTML (phishing) en el email al paciente. Ahora cada
    color pasa por `safeColor` (solo hex / `rgb()` / keyword; si no, default).
    Endurece TODOS los emails transaccionales.

## Hallazgos de la revisión adversarial (9, todos corregidos)

| Sev | Fix |
|-----|-----|
| medium | En prod sin `RESEND_API_KEY`, el dry-run devolvía éxito → falso "enviado". Ahora en `NODE_ENV=production` un dry-run devuelve 503 y la UI no lo pinta verde. |
| medium | Conflicto de `package-lock.json` al mergear con `feat/facturacion-pdf-y-exports-xlsx` (ambas añaden `pdfkit`). Ver **Nota de merge**. |
| low | Cabecera de opción "Opción 1 · Opción 2" al borrar/reordenar → ahora ordinal por posición; el nombre solo se muestra si es personalizado. |
| low | Permitía enviar un menú vacío → guard "el plan no tiene comidas todavía". |
| low | Se filtraba el error crudo de Resend al cliente → mensaje genérico (detalle en logs). |
| low | Inyección HTML vía color de marca → `safeColor` (arriba). |
| low | Sin límite de reenvío → throttle en proceso (30 s/plan; reserva optimista anti-concurrencia). Dedup persistente = backlog (necesita columna `emailedAt`). |
| low | `RESEND_FROM_EMAIL` ausente → 403 garantizado → fail-fast (arriba). |
| low | Viudas en el PDF (cabecera de opción/receta huérfana) → `ensureSpace` antes de opciones y recetas. |

## Nota de merge (package-lock.json)

`feat/facturacion-pdf-y-exports-xlsx` y esta rama añaden **ambas** `pdfkit`
(misma versión `^0.19.1`). `package.json` y `next.config.mjs` mergean limpio
(líneas idénticas); solo `package-lock.json` conflicta.

**Resolución:** mergear **facturación primero**; al mergear 8.2/8.3 después, el
bloque de pdfkit ya estará en master (idéntico) y el conflicto desaparece o es
trivial. Si aun así conflicta el lock, resolverlo regenerándolo:
`git checkout --theirs package-lock.json && npm install && git add package-lock.json`
(regenera contra el `package.json` fusionado; garantiza que `npm ci` del deploy
no falle).

## Requisito de despliegue

El envío real necesita en `.env.production` del VPS:
- `RESEND_API_KEY` (si no está, el módulo Citas ya la usaba; verificar).
- `RESEND_FROM_EMAIL` = remitente verificado en Resend.

Sin `RESEND_API_KEY` en prod, "Enviar" devuelve 503 con aviso (no un falso
éxito). El botón "PDF" (descarga) funciona sin email configurado.

## Verificación

- PDF real generado sobre demo (magic `%PDF`, macros comprobadas a mano, recetas
  con raciones decimales, dedup de cabecera correcta) — inspección visual.
- Saneado de color: 7 asserts incl. payload de inyección → cae al default, sin
  `<a>` de phishing.
- Endpoints vía sesión sandbox: PDF 200 `application/pdf`; envío 200 dry-run;
  plantilla → 400; doble envío → **429** (throttle). ESLint limpio.
