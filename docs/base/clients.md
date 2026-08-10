# Módulo base: `clients`

> Ficha técnica del **base**. Generada del código el 2026-08-07 (commit `030a35e`).
> Detalle funcional y de negocio en [`docs/modules/clients.md`](../modules/clients.md).

---

## Resumen

Fichas de clientes (individuales y empresas), contactos por rol, notas, adjuntos y acceso al portal. El alta se adapta al cliente por MÓDULOS (perfil `salud` vs `comercial`, `lib/clients/formularioAlta.js`), y el propio rótulo del módulo cambia a «Pacientes» donde el cliente ES el paciente (`lib/clients/vocabulario.js`).

## De un vistazo

| | |
| --- | --- |
| **moduleKey** | `clients` |
| **Tenants que lo usan** | aumenta, demo, nutri_laura, spain_enzymes |
| **Tamaño** | 43 ficheros · 6779 LOC |
| **Overrides hoy** | `nutri-laura/ClientDetailModule.jsx` (+ 6 paneles de la ficha). Mapa en `app/(dashboard)/clientes/[id]/page.jsx`. |

## Ficheros que componen el base

Esto es lo que hay que clonar en una iteración de F2.

### Páginas (7)

```
  781  app/(dashboard)/clientes/ClientesClient.jsx
  338  app/(dashboard)/clientes/lista-espera/ListaEsperaClient.jsx
  249  app/(dashboard)/clientes/urgentes/FichasACompletarClient.jsx
   59  app/(dashboard)/clientes/page.jsx
   49  app/(dashboard)/clientes/urgentes/page.jsx
   49  app/(dashboard)/clientes/[id]/page.jsx
   42  app/(dashboard)/clientes/lista-espera/page.jsx
```

### Endpoints (26)

```
  333  app/api/clients/[id]/contract/route.js
  249  app/api/clients/[id]/route.js
  220  app/api/clients/route.js
  207  app/api/clients/waitlist/route.js
  177  app/api/clients/[id]/contact-methods/[methodId]/route.js
  171  app/api/clients/[id]/attachments/route.js
  141  app/api/clients/[id]/module-assignments/route.js
  140  app/api/clients/[id]/portal-months/route.js
  138  app/api/clients/[id]/portal-user/route.js
  124  app/api/clients/[id]/contact-methods/route.js
  123  app/api/clients/waitlist/[id]/route.js
  117  app/api/clients/[id]/guardians/route.js
  111  app/api/clients/[id]/comunicaciones/route.js
   97  app/api/clients/export/route.js
   97  app/api/clients/import/route.js
   91  app/api/clients/[id]/attachments/[attachmentId]/route.js
   86  app/api/clients/[id]/notes/route.js
   79  app/api/clients/[id]/plans/route.js
   72  app/api/clients/[id]/contract/firmado/[documentoId]/route.js
   71  app/api/clients/urgentes/route.js
   54  app/api/clients/[id]/attachments/[attachmentId]/download/route.js
   53  app/api/clients/[id]/contract/download/route.js
   47  app/api/clients/[id]/interactions/route.js
   43  app/api/clients/[id]/notes/[noteId]/route.js
   33  app/api/clients/[id]/projects/route.js
   24  app/api/clients/[id]/billing-summary/route.js
```

### Componentes (9)

```
  278  components/clients/ClientPatientsSection.jsx
  260  components/clients/ClientGuardiansSection.jsx
  259  components/clients/ClientContractSection.jsx
  245  components/clients/ClientContactMethodsSection.jsx
  134  components/clients/ClientPortalMonthsSection.jsx
  125  components/clients/ClientModulesSection.jsx
  123  components/clients/PacientesDelAlta.jsx
  116  components/clients/ClientComunicacionesSection.jsx
  103  components/clients/ClientCitasSection.jsx
```

### Módulos UI (1)

```
  471  modules/default/ClientDetailModule.jsx
```

## Puntos de extensión

La ficha (`ClientDetailModule`) es el punto natural: nutri_laura ya la sobreescribe entera con sus propios paneles. El listado `/clientes` no tiene mecanismo de override todavía.

## Antes de tocar este módulo

1. Leer [`routing-overrides.md`](routing-overrides.md) — el mecanismo tiene trampas (clave con underscore, carpeta con guión).
2. `hasModule("clients")` en todo endpoint nuevo.
3. Un cambio aquí llega a **todos** los tenants de la lista de arriba, a la vez.
4. El detalle de negocio está en [`docs/modules/clients.md`](../modules/clients.md); si el código y el doc discrepan, **manda el código**: actualiza el doc.
