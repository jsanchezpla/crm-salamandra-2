# Sprint 9 — Home "Tu día" (portada con widgets por módulo)

- **Fecha:** 2026-07-15
- **Riesgo:** 🟢 Bajo. Puramente aditivo: no toca modelos, ni migraciones, ni
  endpoints existentes. Un agregador de solo-lectura + un componente de UI + un
  cableado en la portada. Degrada con gracia (nunca da 500) y no muestra nada
  para tenants/usuarios sin los módulos.
- **Estado:** implementado y verificado en `demo` (local). Sin desplegar.

---

## Qué se construye

La portada del dashboard (`/`) pasa de ser un hero + accesos rápidos estáticos a
una portada "Tu día" que resume, de un vistazo, lo que está pasando hoy en cada
módulo que el usuario tiene activo.

Ficheros:
- `lib/home/summary.js` — **agregador server-side** `buildHomeSummary(ctx)`.
- `components/home/HomeSummary.jsx` — **server component** que pinta una tarjeta
  por bloque presente (estética editorial, paleta `--ink-*`).
- `app/(dashboard)/page.jsx` — resuelve el contexto de tenant en el RSC y compone.

---

## Decisiones (coordinadas antes de construir)

| # | Decisión | Elegido | Motivo |
|---|----------|---------|--------|
| D1 | Alcance del sprint 1 | **Reuse-only** | Solo widgets que reutilizan endpoints/libs existentes; cero agregaciones nuevas → a producción rápido y de bajo riesgo. Embudos/listas nuevas (leads por stage, lista de vencidas) quedan para Fase 2. |
| D2 | Ámbito de los datos | **Tenant-wide** | Todos los widgets muestran datos de todo el negocio. Hoy `Booking`/`CalendarTask` NO tienen FK a usuario, así que "lo mío" es inviable sin cambio de modelo. En nutri_laura (mono-profesional) tenant-wide ≡ personal. |
| D3 | Arquitectura | **Agregador server-side** | La home (RSC) compone todo en el servidor vía `buildHomeSummary`, gateando por módulo+rol y lanzando queries en `Promise.all`. Sin N+1, un punto central para el guard de schema parcial, sin cascada de spinners. |
| D4 | Datos sensibles de finanzas | **Solo admin** | Cobrado, margen y EBITDA se gatean por rol `admin`/`superadmin` (paralelo a `monthlySalary` en Equipo). Un usuario con billing ve KPIs operativos (facturado, vencido) pero no rentabilidad. |

## Arquitectura

- **Contexto en el RSC**: la home construye un shim `{ headers:{get}, cookies:{get} }`
  sobre los headers que el middleware ya inyecta (`x-tenant`, `x-user-id`) y llama
  a `getTenantContext(shim)`. Así obtiene `ctx.hasModule` (que ya cruza módulo del
  tenant ∩ `user.moduleAccess`), `ctx.user` (rol) y `ctx.tenantModels` — sin
  duplicar la resolución multi-tenant ni pegar por HTTP.
- **Gating**: cada bloque se activa con `ctx.hasModule(key)`. La rentabilidad se
  gatea además por `isAdmin(user)`. `admin` se calcula UNA vez en el agregador y
  se devuelve — el componente no recalcula el rol.
- **Tolerancia a schema parcial**: cada bloque corre dentro de `safeBlock`, que
  degrada a `null` (bloque omitido) ante `42P01` o cualquier fallo. Se evita
  deliberadamente `TeamMember` (ausente en nutri_laura). Ningún camino da 500 en
  la home; un fallo global degrada a solo el hero.

## Bloques (reuse-only)

`agenda` (citas), `tareas` (calendar), `salud` (clinica/pacientes, espeja
`/api/clinica/overview`), `finance` (billing), `clientes`, `leads`/`sales`,
`outreach`, `nutricion`, `formacion` (training), `pedidos` (orders). Cada tenant
ve solo los suyos: nutri_laura → agenda+comercial+clientes+nutrición+formación;
aumenta → home rica con salud+finanzas+agenda+comercial; un tenant solo-leads →
una tarjeta.

## Nota sobre el bloque Finanzas (tras la review)

El operativo visible para cualquier usuario con billing es **facturado del mes**
(base imponible) + **vencido** (cartera vencida efectiva, mismo cálculo que
`/api/billing/operations`). **No se muestra un "pendiente del mes"** por dos
motivos: (1) junto al "vencido" (cartera histórica, no acotada al mes) se leería
como contradictorio, porque vencido ⊆ pendiente y ocultaría deuda real; (2)
exponer facturado + pendiente permitiría deducir el "cobrado" por resta
(`cobrado = facturado − pendiente`), que es sensible y se reserva a admin. Para
admin se usan las cifras canónicas de `getKpisForPeriod` (cobrado proporcional en
base + márgenes); los no-admin corren solo 2 queries (facturado + vencido).

## Revisión adversarial

Revisión multi-agente (4 ángulos → verificación 1-voto). 10 hallazgos
confirmados, todos corregidos antes del commit: mezcla de escalas mes/histórico
en finanzas (F1), fuga aritmética de "cobrado" a no-admin (F2), fallback del
`catch` que podía dar 500 (F3), reúso ineficiente de `getKpisForPeriod` para
no-admin (F4), "hoy" en UTC vs local en Calendario (F5), etapa terminal
`paciente` no contada como cerrada en el embudo nutricional (F6), `hasModule`
fail-open con usuario nulo (F7), sobre-degradación del bloque Formación ante
error transitorio de `lastSync` (F8), predicado admin duplicado (F9), y
divergencia de gating en el fallback (F10). Un candidato (tolerancia de 0.0049 en
el estado de factura) fue REFUTADO correctamente: imposible con `DECIMAL(12,2)`.

## Pendiente (Fase 2+)

- Widgets "build-new": embudo de leads por stage, lista de facturas vencidas.
- "Mi día" personal (requiere FK usuario en Booking/CalendarTask, cambio de modelo).
- Posible cache del resumen (hoy cada carga corre ~30 queries; aceptable para una portada).
