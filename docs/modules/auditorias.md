# Módulo de Auditorías de desempeño (`auditorias`)

## Mapa

> Escrito el 09/09/2026, el día que se hizo el módulo. **Quién lo tiene NO se
> lista aquí** (una lista a mano se queda vieja): `/admin/modulos` en el
> back-office o `node scripts/inspect-tenant-modules.js <slug>`.

| | |
| --- | --- |
| **moduleKey** | `auditorias` · requiere `team` (toda auditoría es de alguien de la plantilla; la columna del auditado es NOT NULL con FK a `team_members`). **NO requiere `team_avanzado`** a propósito: lo compra cualquier centro con varias personas y alguien que dirige, tenga o no las pantallas de gestión clínica. |
| **Reina** | `aumenta` — lo pidió Isabel Alberca (dirección) el 09/09/2026 (AV-0100 del Buzón). |
| **Pantallas** | `/equipo/auditorias` → `app/(dashboard)/equipo/auditorias/page.jsx` (gate en el SERVIDOR con `notFound()`) + `AuditoriasClient.jsx`. Entrada de menú dentro del grupo Equipo, `moduleKey: "auditorias"` a secas y **sin `adminOnly`**: cada persona entra a ver las suyas ya cerradas. |
| **Endpoints** | `app/api/equipo/auditorias/route.js` (GET lista, POST abre una) y `app/api/equipo/auditorias/[id]/route.js` (GET con contexto, PATCH escribe, DELETE solo borradores). Públicos: ninguno. |
| **Lógica** | `lib/team/auditoriaDesempeno.js` — puro, sin base ni fetch: las cuatro áreas y sus criterios, el recuento, los avisos del cierre, lo que quedó pendiente de la anterior, las rachas de «no apto» y quién puede ver qué. `lib/team/auditoriasStore.js` — lo que toca Sequelize: la puerta del módulo, quién es dirección y el serializador. |
| **Modelos** | `AuditoriaDesempeno` (`auditorias_desempeno`). Dos FKs a `team_members`: el auditado (CASCADE) y quien audita (SET NULL). Las áreas y los criterios se guardan en la fila (`areas`, JSONB). |
| **Interruptores y parámetros** | ninguno. Lo que decide es el rol, leído fresco de BD por `withTenant`. |
| **Scripts** | activar: `node scripts/enable-module.js <slug> auditorias` · migración: `scripts/migrate-auditorias-module.js` (declarada en `MODULES.auditorias` de `scripts/_module-migrations.js`) · seeds: ninguna. |
| **Pruebas** | `scripts/_smoke-auditoria-desempeno.mjs` (`node:test`, 18 casos, en `npm test`): que un «no apto» NO decida el resultado, que las rachas sean CONSECUTIVAS, que normalizar conserve los rótulos guardados y que un borrador no lo lea la persona auditada. |

---

## De qué petición nace

Isabel Alberca, dirección de Aumenta, 09/09/2026 (AV-0100):

- Cabecera: terapeuta, mes auditado, responsable y fecha.
- **Cuatro áreas** con sus criterios —gestión documental, preparación y
  seguimiento de casos, calidad de la intervención, y familias y
  coordinación—, cada criterio valorado solo como **APTO / NO APTO / NO APLICA**
  y con su campo de observaciones. **Nada de puntuaciones** ni categorías
  intermedias.
- Un «no apto» **no hace desfavorable toda la auditoría**: queda como aspecto a
  mejorar. Si el mismo incumplimiento se repite mes a mes, tiene que verse.
- Cierre: fortalezas, aspectos a mejorar, acción acordada, plazo de revisión,
  observaciones y resultado global (favorable / requiere seguimiento).
- **Histórico por terapeuta**, y al abrir una auditoría nueva ver lo pendiente
  de la anterior.
- **Pacientes revisados** durante la auditoría, enlazados a su ficha.

---

## Por qué es un módulo y no una pantalla de `team_avanzado`

La pregunta de la regla 16 es «¿se lo venderíamos a un segundo cliente?», y aquí
la respuesta es que sí: cualquier centro con varias profesionales y alguien que
dirige hace esto, hoy en un Word. Así que va como módulo propio, con su clave,
que se vende aparte — no como un regalo dentro de Equipo.

Y no se solapa con lo que ya hay. **Desempeño y Productividad son NÚMEROS** que
salen solos de las citas y los cobros. Esto es lo contrario: una valoración a
mano, cualitativa, con histórico y seguimiento. Meterlo dentro de Desempeño
mezclaría dos cosas que se leen distinto.

---

## Las tres decisiones que están en el código

### 1. El «no apto» no decide el resultado

Es literal de la petición y es lo primero que un refactor rompería sin querer.
`lib/team/auditoriaDesempeno.js` **no tiene ninguna función que calcule el
resultado**: lo escribe quien audita. Lo único que hay es `avisosDelCierre`, que
señala incoherencias —un «requiere seguimiento» sin acción acordada, criterios
sin valorar— y **no impide nada**.

`recuentoDeAuditoria` devuelve cuántos aptos, no aptos, no aplica y sin valorar,
y **ni nota ni porcentaje**: un «3 de 16» invita a comparar personas, y esto no
es una clasificación.

### 2. Lo que se repite, se ve

`criteriosQueSeRepiten` mira el histórico de esa persona y devuelve los criterios
que salen «no apto» en meses **consecutivos**. Consecutivos y no acumulados: un
no apto en marzo y otro en septiembre son dos hechos, no una pauta, y tratarlos
igual convertiría el aviso en ruido. Sale en rojo arriba de la auditoría.

Y al lado, `loQuePendiaDeLaAnterior`: los aspectos, la acción acordada, el plazo
y los no aptos del mes anterior, con un campo para decir qué ha pasado con
aquello. Es lo que convierte una pila de meses sueltos en un seguimiento.

### 3. Quién ve una auditoría

Es material laboral sobre una persona, la misma conversación que tuvieron las
incidencias en agosto (AV-0018):

- **Dirección** (`admin` / `superadmin`) ve, escribe y cierra todas.
- **La persona auditada** ve LAS SUYAS y solo cuando están **cerradas**. Un
  borrador a medio escribir no es una valoración, es una nota de quien audita.
- Nadie más ve nada. Sin ficha de equipo, tampoco.

Que la auditada vea la suya cerrada no es un extra: una auditoría que no puede
leer no le sirve para mejorar, que es para lo que se hace.

---

## La plantilla se guarda dentro de cada auditoría

Como los apartados del informe clínico: al abrirla se copian las áreas y los
criterios EN LA FILA (`areas`, JSONB). Si mañana se añade un criterio, las
auditorías ya firmadas no cambian —firmaron lo que firmaron— y las nuevas salen
con la lista nueva. Una auditoría que cambiara sola después de firmada no
valdría para nada laboral.

`normalizarAreas` conserva los rótulos tal como vienen de la fila y **no los
relee** de la plantilla, por lo mismo. Y deja pasar criterios que no estén en la
plantilla: quien audita puede añadir los suyos y se guardan con la auditoría.

Lo que **no** hay todavía es una pantalla para que el centro edite la plantilla
de criterios. Se puede añadir el día que un segundo cliente quiera otros: el
formato ya lo aguanta, y el sitio natural es Configuración → Módulos, junto a
las plantillas de informe.

---

## Lo que queda registrado en auditoría (master)

Solo dos acciones, y solo con contadores:

- `auditorias.auditoria.cerrada` — al firmar. Lleva el mes y el resultado.
- `auditorias.auditoria.deleted` — al borrar un borrador. Lleva el mes.

**Ni una observación viaja a master.** El schema `master` lo comparten todos los
clientes, y una valoración laboral escrita sobre una persona no se duplica ahí.
Escribir la auditoría no se audita: sería una fila por tecla.

Una auditoría **cerrada no se borra** (409). Se puede volver a borrador y
reescribir, que deja rastro; borrarla dejaría el histórico sin ser un histórico.

---

## Una persona, un mes, una auditoría

Índice único `(team_member_id, mes)`. Dos auditorías del mismo mes serían dos
versiones de la misma conversación y nadie sabría cuál vale. El POST lo comprueba
antes para poder decirlo con palabras en vez de con un error de base de datos.
