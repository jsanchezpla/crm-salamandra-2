# Las listas copiadas a mano mienten: los módulos por cliente (y su entorno) se miran en la base de datos, no en `CLAUDE.md`

**Fecha:** 10/08/2026 (módulos) y 12/08/2026 (entorno) · **Quién:** Jorge ·
**Módulos:** transversal · **Lo que quedó en `CLAUDE.md`:** la tabla de
tenants sin columna de módulos y el aviso de dónde se mira.

## Qué pasó

`CLAUDE.md` tenía una columna con los módulos de cada cliente y **mentía en 5
de los 8 clientes**, además de faltarle dos enteros. Decía que Aumenta tenía 13
cuando tenía 20, y que la demo tenía `support` «solo en local» cuando lo tenía
en producción. De esa tabla salieron **dos tareas falsas del backlog en el
mismo día**.

No es que nadie la actualizara: es que una lista copiada a mano de algo que
cambia cada semana **siempre** acaba mintiendo, y aquí miente en silencio.

Dos días después se vio que **la columna «Entorno» también se había desviado**:
decía «solo producción» de `retorika`, `healim` y `salamandra_solutions`, y los
tres estaban además en local. Mismo problema en pequeño.

## Qué se decidió

La verdad está en `master.tenant_modules` y se mira en:

- **`/admin/modulos`** en el back-office — quién tiene qué y qué lleva a medida
  (existe desde el 08/08/2026, `app/api/admin/modulos/route.js`).
- **`/admin/integraciones`** — por dónde se tocan esos módulos entre sí.
- `scripts/inspect-tenant-modules.js <slug>` (solo lectura) desde la terminal.

Y la lista de tenants de un entorno se comprueba en un segundo, **antes de
fiarse**:

```bash
node --env-file=.env.local -e "import('./lib/db/masterDb.js').then(async({getMasterDb})=>{const d=getMasterDb();console.log((await d.query('SELECT slug FROM master.tenants ORDER BY slug'))[0].map(t=>t.slug).join(', '));await d.close()})"
```

Lo que sí vive en `CLAUDE.md` es lo que la base de datos NO sabe: quién es cada
cliente, qué no se le puede tocar y por qué.

## Cómo se aplica hoy

- Ningún doc nuevo lista qué clientes tienen un módulo; los `## Mapa` de
  `docs/modules/*.md` (19/08/2026) lo dicen expresamente y remiten a
  `/admin/modulos`.
- Ojo: **local y producción no tienen los mismos tenants ni los mismos
  módulos por tenant** (`spain_enzymes` tiene cinco en local y solo los
  contratados en producción). Antes de apuntar una tarea o afirmar algo de un
  cliente, se mira el entorno que toque.
