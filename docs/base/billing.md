# Módulo base: `billing`

> Ficha técnica del **base**. Generada del código el 2026-08-07 (commit `030a35e`).
> Detalle funcional y de negocio en [`docs/modules/billing.md`](../modules/billing.md).

---

## Resumen

Facturas, presupuestos, cobros, costes, tarifas, recurrentes, proveedores, arqueo de caja y analítica (por cliente, empleado, IVA y socios). Integración Verifactu vía Facturantia.

## De un vistazo

| | |
| --- | --- |
| **moduleKey** | `billing` |
| **Tenants que lo usan** | aumenta, demo, spain_enzymes |
| **Tamaño** | 69 ficheros · 10.514 LOC |
| **Overrides hoy** | Ninguno. |

## Ficheros que componen el base

Esto es lo que hay que clonar en una iteración de F2.

### Páginas (22)

```
 1161  app/(dashboard)/facturacion/facturas/page.jsx
  539  app/(dashboard)/facturacion/cobros/page.jsx
  388  app/(dashboard)/facturacion/costes/page.jsx
  377  app/(dashboard)/facturacion/arqueo/page.jsx
  334  app/(dashboard)/facturacion/presupuestos/page.jsx
  297  app/(dashboard)/facturacion/proveedores/page.jsx
  285  app/(dashboard)/facturacion/presupuestos/[id]/page.jsx
  270  app/(dashboard)/facturacion/recurrentes/page.jsx
  249  app/(dashboard)/facturacion/configuracion/page.jsx
  211  app/(dashboard)/facturacion/analitica/iva/page.jsx
  205  app/(dashboard)/facturacion/resumen/page.jsx
  185  app/(dashboard)/facturacion/analitica/empleados/page.jsx
  158  app/(dashboard)/facturacion/page.jsx
  156  app/(dashboard)/facturacion/_components/PeriodPicker.jsx
  155  app/(dashboard)/facturacion/analitica/clientes/page.jsx
  134  app/(dashboard)/facturacion/analitica/socios/page.jsx
  128  app/(dashboard)/facturacion/cumplimiento/page.jsx
  127  app/(dashboard)/facturacion/_components/tableSort.jsx
   83  app/(dashboard)/facturacion/layout.jsx
   68  app/(dashboard)/facturacion/_components/Kpi.jsx
   43  app/(dashboard)/facturacion/analitica/page.jsx
   31  app/(dashboard)/facturacion/_components/StatusBadge.jsx
```

### Endpoints (42)

```
  247  app/api/billing/invoices/[id]/rectify/route.js
  174  app/api/billing/invoices/route.js
  168  app/api/arqueo/cierres/route.js
  160  app/api/billing/analytics/employees/route.js
  157  app/api/billing/recurring/[id]/route.js
  155  app/api/billing/invoices/[id]/send/route.js
  151  app/api/billing/payments/route.js
  147  app/api/billing/quotes/route.js
  132  app/api/billing/invoices/[id]/route.js
  126  app/api/billing/analytics/iva/export/route.js
  126  app/api/billing/costs/route.js
  125  app/api/billing/morosidad/route.js
  124  app/api/billing/quotes/[id]/route.js
  123  app/api/billing/invoices/[id]/issue/route.js
  113  app/api/billing/analytics/clients/route.js
  111  app/api/billing/analytics/partners/route.js
  111  app/api/proveedores/[id]/route.js
  110  app/api/billing/costs/[id]/route.js
  110  app/api/billing/operations/route.js
  101  app/api/billing/exports/by-employee/route.js
  101  app/api/billing/payments/[id]/route.js
   92  app/api/billing/exports/by-client/route.js
   91  app/api/billing/quotes/[id]/convert/route.js
   90  app/api/billing/rates/[id]/route.js
   88  app/api/billing/exports/expenses/route.js
   80  app/api/billing/invoices/bulk-pdf/route.js
   80  app/api/billing/settings/route.js
   78  app/api/billing/exports/payments/route.js
   76  app/api/billing/exports/by-partner/route.js
   75  app/api/billing/recurring/route.js
   73  app/api/proveedores/route.js
   71  app/api/billing/exports/quotes/route.js
   69  app/api/billing/series/[id]/route.js
   61  app/api/billing/invoices/[id]/cancel/route.js
   60  app/api/billing/rates/route.js
   51  app/api/billing/exports/recurring/route.js
   51  app/api/billing/invoices/[id]/pdf/route.js
   45  app/api/billing/series/route.js
   36  app/api/arqueo/cajas/route.js
   29  app/api/billing/analytics/route.js
   29  app/api/billing/quotes/[id]/accept/route.js
   24  app/api/billing/analytics/iva/route.js
```

### Componentes (5)

```
  218  components/billing/PatientReparto.jsx
  190  components/billing/PatientBillingSection.jsx
  110  components/billing/ClientBillingSection.jsx
  103  components/billing/ExportButtons.jsx
   88  components/billing/EmployeeBillingSection.jsx
```

## Puntos de extensión

Sin mecanismo hoy. 69 ficheros y 14 páginas: es el módulo más caro de clonar de todo el CRM.

## Antes de tocar este módulo

1. Leer [`routing-overrides.md`](routing-overrides.md) — el mecanismo tiene trampas (clave con underscore, carpeta con guión).
2. `hasModule("billing")` en todo endpoint nuevo.
3. Un cambio aquí llega a **todos** los tenants de la lista de arriba, a la vez.
4. El detalle de negocio está en [`docs/modules/billing.md`](../modules/billing.md); si el código y el doc discrepan, **manda el código**: actualiza el doc.
