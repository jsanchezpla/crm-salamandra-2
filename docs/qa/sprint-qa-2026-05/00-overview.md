# Sprint QA 2026-05 — Overview

Checklist completo de testing manual para los 5 módulos implementados
del CRM Salamandra. Pensado para ejecutarse tras el reset reproducible
de `scripts/reset-demo-tenant.js`.

## Cómo lanzar el reset y partir de estado limpio

```powershell
# 1. (opcional) Dry-run para ver el plan sin tocar nada
npm run db:reset:demo:dry-run

# 2. Ejecutar el reset real
npm run db:reset:demo
```

El script imprime al final las contraseñas aleatorias generadas para
las 4 cuentas de prueba. **Cópialas inmediatamente** y rellénalas en la
tabla de la sección "Cuentas de prueba" más abajo: solo se imprimen
una vez en stdout y NO se persisten en ningún fichero del repo.

## Cuentas de prueba

| Email                       | Rol           | Módulos visibles                                                  | Password (rellenar a mano) |
| --------------------------- | ------------- | ----------------------------------------------------------------- | -------------------------- |
| `admin@demo.salamandra`     | admin         | TODOS                                                             | `__________________`       |
| `lead@demo.salamandra`      | user (no admin) | leads, team, projects, billing, training, cuestionarios          | `__________________`       |
| `observer@demo.salamandra`  | user (no admin) | leads, team                                                       | `__________________`       |
| `portal@demo.salamandra`    | user (placeholder) | ninguno (#17 Portal Cliente sin implementar)                  | `__________________`       |

> Nota sobre `portal@demo.salamandra`: el ENUM `users.role` en master no
> tiene un valor `client`. El portal cliente (módulo #17) aún no está
> implementado. La cuenta está creada como `user` con `moduleAccess` vacío
> para validar que NO puede acceder a nada del dashboard interno.

## Cómo ejecutar y rellenar el checklist

1. Tras el reset, arranca la app: `npm run dev`.
2. Abre `http://localhost:3000`.
3. Para cada TC, sigue **Pasos** literalmente. Marca **Resultado real**
   con uno de estos símbolos:
   - `OK` — funciona como en "Resultado esperado"
   - `BUG` — falla; describir 1-2 líneas en **Bug detectado** y abrir
     ticket aparte si aplica.
   - `N/A` — el caso no aplica en este entorno (anotar por qué).
4. Si un TC depende de otro (precondición), respeta el orden.
5. Cuando termines un fichero entero, pasa a hacer commit del checklist
   relleno (no del script de reset).

## Severidad esperada del bug si el TC falla

- **rojo crítico**: rompe seguridad, aislamiento entre tenants,
  correlatividad fiscal o pérdida de datos.
- **naranja importante**: rompe un flujo principal del módulo (alta,
  edición, listado), permite enumeración de datos, o devuelve códigos
  HTTP equivocados.
- **amarillo cosmético**: UI desalineada, badges con color erróneo,
  texto truncado, etc.

## Distribución de TCs por fichero

| Fichero          | Módulo                   | TCs       |
| ---------------- | ------------------------ | --------- |
| 01-team.md       | Equipo & RRHH            | TC-001 a TC-013 |
| 02-billing.md    | Facturación              | TC-014 a TC-040 |
| 03-leads.md      | Leads / Comercial        | TC-041 a TC-052 |
| 04-training.md   | Formación                | TC-053 a TC-066 |
| 05-projects.md   | Proyectos (Sprint 1)     | TC-067 a TC-085 |
| 06-cross-module.md | Cross-module           | TC-086 a TC-095 |
| 07-security.md   | Seguridad y aislamiento  | TC-096 a TC-107 |
| **Total**        |                          | **107 TCs** |

## Índice de ficheros

- [01-team.md](./01-team.md) — Módulo Equipo
- [02-billing.md](./02-billing.md) — Módulo Facturación
- [03-leads.md](./03-leads.md) — Módulo Leads
- [04-training.md](./04-training.md) — Módulo Formación
- [05-projects.md](./05-projects.md) — Módulo Proyectos (Sprint 1)
- [06-cross-module.md](./06-cross-module.md) — Cross-module
- [07-security.md](./07-security.md) — Seguridad y aislamiento

## Estructura uniforme de cada TC

```markdown
### TC-XXX. Título corto del caso

**Módulo**: billing | team | leads | training | projects | cross-module | security
**Severidad esperada del bug si falla**: 🔴 crítico | 🟠 importante | 🟡 cosmético
**Rol necesario**: admin | lead | observer | portal | público

**Precondiciones**:
- Listar qué debe estar dado de alta antes.
- Si depende de un test anterior, indicar TC-XXX precondición.

**Pasos**:
1. Acción 1.
2. Acción 2.
3. Verificación.

**Resultado esperado**:
- Qué debe ocurrir exactamente.

**Resultado real**: ⏳
**Bug detectado**: ⏳
```
