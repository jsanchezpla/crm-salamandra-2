# Patrones vivos del proyecto

> Soluciones ya probadas. Antes de inventar una, mira si está aquí.
> Verificado contra código el 2026-08-07.

---

## 1. Smoke test

El patrón más usado del repo: **56 scripts** `scripts/_smoke-*.mjs`. Llaman a
la API real con un token firmado en local y comprueban el **cuerpo del JSON**,
sin pasar por ninguna pantalla.

```js
import { getMasterDb, getMasterModels } from "../lib/db/masterDb.js";
import { signAccessToken } from "../lib/auth/jwt.js";

const SLUG = process.argv[2] || "nutri_laura";
const BASE = process.env.SMOKE_BASE_URL || "http://localhost:3000";

let fallos = 0;
const ok   = (m) => process.stdout.write(`  ✓ ${m}\n`);
const mal  = (m) => { fallos++; process.stderr.write(`  ✗ ${m}\n`); };
const esperar = (c, m) => (c ? ok(m) : mal(m));

const cabecerasDe = async (rol, u) => ({
  "Content-Type": "application/json",
  "x-tenant": SLUG,
  Cookie: `access_token=${await signAccessToken({
    userId: u.id, email: u.email, role: rol, tenantSlug: SLUG,
  })}`,
});
```

**Por qué mira el JSON y no la pantalla**: el precio de los tipos de cita se
escondió en la interfaz el 06/08 y el endpoint lo siguió devolviendo — se veía
desde el inspector del navegador. Esconder ≠ no enviar.

Ejecución: `node --env-file=.env.local scripts/_smoke-x.mjs [slug]`, con el
servidor de desarrollo levantado. Sale con código ≠ 0 si algo falla.

## 2. Personalizar por MÓDULOS, no por slug

La preferencia del proyecto (CLAUDE.md, 01/08/2026): un centro nuevo tiene que
salir bien de fábrica sin tocar código.

```js
// lib/clients/vocabulario.js — «Pacientes» donde el cliente ES el paciente
const esConsultaDePaciente = tiene("nutricion") && !tiene("pacientes") && !tiene("clinica");
```

⚠️ **La condición negativa es lo importante.** En un centro clínico el cliente
es la familia que paga y los pacientes son los hijos, que ya tienen su tabla y
su entrada de menú. Sin ella, Aumenta tendría **dos «Pacientes» distintos en
el mismo sidebar**.

Mismo patrón en `lib/clients/formularioAlta.js`: perfil `salud` si tiene
`pacientes`/`clinica`/`nutricion`, `comercial` en el resto.

## 3. Una sola fuente para el total y para las filas

`lib/clients/urgentes.js` define las carpetas **y** sus consultas en un solo
sitio: el número de la carpeta y las filas que se ven al abrirla salen de la
misma función. Si divergen, nadie se fía del número.

Corolario: si una lista no se puede terminar nunca, deja de mirarse. Por eso
se separó lo que bloquea el trabajo (decenas) de la ficha incompleta (miles),
y por eso existe el archivado (`data_reviews`): sin él no llega a cero jamás,
porque hay huecos correctos —un paciente en lista de espera no tiene
terapeuta—.

## 4. Guard de demo

La demo es **pública** y da sesión de **admin** a visitantes anónimos.

```js
import { esDemo } from "../../../lib/demo/isDemo.js";
if (esDemo(tenantContext)) return forbidden("No disponible en la demo");
```

Obligatorio en todo endpoint que **envíe correo, gaste IA o escriba en
master**. En la auditoría del 2026-07-28 apareció el envío de facturas por
correo, que salía con la clave global de Resend desde nuestro dominio
verificado: cualquiera con el enlace podía usar el CRM como relé.

## 5. Webhook con HMAC por tenant

El secreto es **por tenant**, así que hay que resolver a qué tenant dice ir la
petición **antes** de tocar la BD:

```js
import { resolveRequestSlug } from "../lib/tenant/tenantResolver.js";
```

⚠️ Tiene que ser **exactamente la misma resolución** que usa
`getTenantContext`. Si divergieran, se podría firmar como un tenant y acabar
escribiendo en otro.

## 6. Falla en cerrado

Dos precedentes reales, ambos de la misma familia de error:

- `loadUserAccess` tragaba errores y devolvía `null` → `hasModule` concedía
  **todos** los módulos. Un fallo transitorio de BD daba *más* acceso.
- Sin `ADMIN_HOST` configurado, el back-office no se sirve en **ningún** sitio.

**Una variable ausente o un error nunca deben abrir una puerta.**

## 7. Lista blanca en una frontera, no lista negra

Al separar el back-office se empezó quitando la superficie anónima (widgets,
portal, webhooks, demo) y se dio por hecho que quedaba el panel. Quedaba el
**CRM entero**.

> Una lista negra en una frontera es una promesa de acordarse de todo lo que
> venga después.

Ver `SOLO_ESTO_EN_BACKOFFICE` en `middleware.js:62`.

## 8. Decodificar antes de comparar

```js
// middleware.js:111 — slugDeWidget
let crudo = partes[2];
try { crudo = decodeURIComponent(crudo); } catch { return null; }
return /^[a-z0-9_]+$/.test(crudo) ? crudo : null;
```

Next decodifica el segmento dinámico antes de dárselo a la página. Comparando
el pathname **crudo**, pedir `/widget/c/nutri%5Flaura` servía el widget
mientras el candado del regex se caía a `*`. **Percent-codificar una letra era
todo lo que hacía falta para saltárselo.**

## 9. Proxy para cambiar una cabecera sin romper el cuerpo

`lib/tenant/withTenant.js:33`. Clonar el request obligaría a arrastrar
`json`/`formData` y rompería los handlers que lo leen. El Proxy delega todo en
el request real y solo sustituye `headers`; los métodos se re-atan al original
porque atados al proxy perderían su estado interno.

## 10. Backfill determinista y reversible

`scripts/backfill-patients-client.js`: dry-run por defecto, deduce el dato de
las **propias** pruebas del registro, enlaza **solo si todas coinciden**, lista
los ambiguos para revisión humana y deja un `.rollback.sql` con las filas
exactas.

**No cruza por nombre a propósito**: el cliente es el tutor que paga, y
confundir familias sería una fuga de datos clínicos.

## 11. Migración filtrada por módulo

```sql
JOIN master.tenant_modules tm ON tm.tenant_id = t.id
 AND tm.module_key = 'citas' AND tm.enabled = true
```

Los schemas se leen de `master.tenants` en tiempo de ejecución. Nunca
hardcodear slugs.

## 12. Reorder sin huecos

Al mover una tarjeta de Kanban, reescribir el orden **de toda la columna**
(0,1,2,3…) en una transacción, en vez de parchear el índice de la movida.
Evita empates y huecos que se acumulan.

## 13. Multi-asignados: reemplazo completo

Al guardar los asignados de algo, **borrar todos y reinsertar** los que
vienen, en una transacción. Los diffs incrementales dejan filas fantasma
cuando dos personas guardan a la vez.
