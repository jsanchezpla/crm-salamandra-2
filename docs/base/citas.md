# Módulo base: `citas`

> Ficha técnica del **base**. Generada del código el 2026-08-07 (commit `030a35e`).
> Detalle funcional y de negocio en [`docs/modules/citas.md`](../modules/citas.md).

---

## Resumen

Reservas con calendario, lista de espera, alta manual con buscador de clientes, enlace cita↔ficha y asignación de profesional y paciente. Incluye portal público de reserva (`/widget/c/{slug}`), bonos, pagos y política de reembolso.

## De un vistazo

| | |
| --- | --- |
| **moduleKey** | `citas` |
| **Tenants que lo usan** | aumenta, demo, healim, nutri_laura |
| **Tamaño** | 31 ficheros · 8771 LOC |
| **Overrides hoy** | Ninguno. El mapa está vacío **a propósito**: en 2026-07-22 se fundieron el override de nutri_laura y el módulo simple del resto en un solo default. |

## Ficheros que componen el base

Esto es lo que hay que clonar en una iteración de F2.

### Páginas (5)

```
 1027  app/(dashboard)/citas/tipos/page.jsx
  322  app/(dashboard)/citas/disponibilidad/page.jsx
  239  app/(dashboard)/citas/sin-profesional/page.jsx
  111  app/(dashboard)/mi-horario/page.jsx
   42  app/(dashboard)/citas/page.jsx
```

### Endpoints (23)

```
  679  app/api/citas/bookings/[id]/route.js
  361  app/api/citas/bookings/route.js
  358  app/api/citas/bookings/[id]/confirm/route.js
  299  app/api/citas/event-types/[id]/route.js
  226  app/api/citas/bloqueos/route.js
  213  app/api/citas/event-types/route.js
  203  app/api/citas/packs/route.js
  190  app/api/citas/avisos/route.js
  182  app/api/citas/bookings/[id]/pedir-tarjeta/route.js
  162  app/api/citas/informe-ocupacion/route.js
  156  app/api/citas/sin-profesional/route.js
  149  app/api/citas/bookings/calendar/route.js
  149  app/api/citas/bookings/[id]/suggest-slots/route.js
  141  app/api/citas/blocked-days/route.js
  134  app/api/citas/availability/[id]/route.js
  132  app/api/citas/bookings/[id]/reject/route.js
  131  app/api/citas/availability/route.js
  118  app/api/citas/availability/bulk/route.js
  113  app/api/citas/bookings/[id]/reschedule-request/route.js
  109  app/api/citas/reschedule-requests/[id]/route.js
   89  app/api/citas/clientes/route.js
   76  app/api/citas/packs/[id]/route.js
   36  app/api/citas/reschedule-requests/route.js
```

### Componentes (2)

```
  257  components/citas/PanelVacaciones.jsx
  157  components/citas/BuscadorPaciente.jsx
```

### Módulos UI (1)

```
 2210  modules/default/CitasModule.jsx
```

## Puntos de extensión

El mapa existe y está vacío. Añadir una entrada es de una línea. Aumenta pidió a futuro lista de espera POR SECTORES.

## Antes de tocar este módulo

1. Leer [`routing-overrides.md`](routing-overrides.md) — el mecanismo tiene trampas (clave con underscore, carpeta con guión).
2. `hasModule("citas")` en todo endpoint nuevo.
3. Un cambio aquí llega a **todos** los tenants de la lista de arriba, a la vez.
4. El detalle de negocio está en [`docs/modules/citas.md`](../modules/citas.md); si el código y el doc discrepan, **manda el código**: actualiza el doc.
