# Buscar a alguien por su nombre y sus apellidos

**28/08/2026 · Jorge, con dos capturas de Aumenta**

> «Al buscar por nombre en Clínica → Pacientes sí sale cuando pongo el nombre,
> pero con los apellidos no sale.»

Y luego, sobre la marcha: «supongo que el error está en todos los módulos de
clínica».

---

## Lo que pasaba

El nombre de un paciente vive **partido en dos columnas**: `first_name` es
«Hugo» y `last_name` es «Castro Díaz». El buscador hacía esto:

```js
if (q) where[Op.or] = [{ firstName: { [Op.iLike]: `%${q}%` } },
                       { lastName:  { [Op.iLike]: `%${q}%` } }];
```

Buscaba la **frase entera** dentro de **cada columna por separado**. Con «hugo»
funciona, porque «hugo» sí está entero dentro de `first_name`. Con «hugo castro»
no puede funcionar **nunca**: esa cadena no está entera en `first_name` («Hugo»)
ni en `last_name` («Castro Díaz»).

Por eso pasó desapercibido tanto tiempo: quien lo probó escribió un nombre
suelto, y con un nombre suelto va bien.

## Lo que se midió antes de tocar nada

Contado sobre `crm_aumenta.patients` en producción, aplicando la misma regla que
usaba el buscador:

| | |
| --- | --- |
| Pacientes de Aumenta | **1.174** |
| Que NO se encontraban escribiendo su nombre y su primer apellido | **1.174** — el 100% |
| Con dos apellidos (cuando más apetece teclear los dos) | 1.080 |
| Con tilde o eñe en el nombre | 671 |

No era un caso raro ni un paciente con el nombre mal escrito: **no había ni uno
solo al que le funcionara**.

## Lo que se hizo

Una pieza sola, `lib/utils/busqueda.js`, que **parte lo escrito en palabras y
las exige todas, cada una en cualquiera de las columnas**. «hugo castro» pide
«hugo» en algún sitio Y «castro» en algún sitio. Consecuencias, todas buscadas:

- da igual el **orden** («castro hugo» también lo encuentra);
- da igual **saltarse el apellido de en medio** («hugo díaz»);
- dan igual los **espacios de más**;
- y dan igual las **tildes**, con `unaccent` de Postgres.

Lo de las tildes no es un capricho ni un cambio de alcance: sin ello, el arreglo
se quedaba a medias para 671 de los 1.174 pacientes, porque quien escribe «hugo
castro diaz» seguiría sin encontrar a «Hugo Castro **Díaz**».

### La propiedad que hace seguro el cambio

**La búsqueda nueva solo puede AÑADIR resultados, nunca quitar.** Si una frase
cabía entera dentro de una columna, entonces todas sus palabras están en esa
columna, así que la regla nueva también la encuentra. Formalmente: lo que
encontraba antes es un subconjunto de lo que encuentra ahora.

La única excepción es a propósito: `%` y `_` se escapan, así que escribir `%` ya
no devuelve la lista entera. Eso es el arreglo, no una pérdida.

Esto es lo que permitió aplicarlo también al endpoint que consume la web de
Retorika sin miedo: lo que su web encuentra hoy, lo seguirá encontrando.

### Por qué las columnas se piden con su nombre de base de datos

Para envolver la columna en `unaccent(lower(...))` hay que usar `fn`/`col` de
Sequelize, y `col()` escribe lo que le des tal cual en el SQL. Así que se pasa
`"Patient.first_name"`, no `"firstName"`.

**Y el alias importa, mucho más de lo que parece.** Cuál hay que poner depende de
dónde viaje el filtro, y equivocarse es un 500 en cuanto alguien escribe algo:

| Dónde va el filtro | Alias | Ejemplo |
| --- | --- | --- |
| En el `where` del modelo raíz | el del **modelo** | `"TrainingUser.name"` |
| Dentro del `where` de un `include` | el de la **asociación** (`as`) | `"trainingUser.name"` |

Probado contra la base: con `TrainingUser.name` dentro del include, Postgres
contesta «falta una entrada para la tabla "TrainingUser" en la cláusula FROM».
Por eso hay una prueba que lo vigila fichero a fichero.

## Dónde estaba el fallo de verdad (y dónde no)

La sospecha de Jorge era razonable, y resultó **falsa por un lado y corta por
otro**. El barrido, comprobado fichero a fichero:

**En el resto del módulo clínico, NO.** Sesiones, informes, coordinaciones,
bandeja, incidencias y derivaciones no tienen el fallo porque **no tienen
buscador de personas**: filtran por desplegable de paciente y de terapeuta, por
estado y por fecha. Que no lo tengan es otra conversación, pero no es esta.

**En Formación, SÍ.** `training_users` es la **otra** tabla del CRM que parte el
nombre en dos (`name` es el nombre de pila y `last_name` los apellidos), y sus
cinco buscadores tenían lo mismo: Alumnos y su Excel, Matrículas y su Excel, y el
endpoint que consume la web de Retorika. En los tres últimos, además, **el
apellido no se buscaba en absoluto**, ni escribiéndolo solo — mientras la tabla
sí lo pintaba en pantalla.

Que sean exactamente esas dos tablas no es una impresión: en `models/tenant/`
solo `Patient.model.js` y `TrainingUser.model.js` declaran un `lastName`. **Ningún
otro buscador del CRM puede tener este fallo, por construcción**, y hay una
prueba que se rompe el día que aparezca una tercera tabla con el nombre partido.

## El fallo que apareció al probar el arreglo

Al comprobar Matrículas contra la base, el filtro devolvía **12 de 12
matrículas para todo**, incluso para un texto inventado. No era el arreglo: era
esto, que llevaba ahí desde siempre.

```js
where: Object.keys(userWhere).length ? userWhere : undefined,
```

Las claves de Sequelize (`Op.and`, `Op.or`) son **symbols**, y `Object.keys` no
ve los symbols. Como el filtro del buscador es justo un `Op.*`, eso valía `0`
**siempre** y el `where` se quedaba en `undefined`.

O sea: **el buscador de Formación → Matrículas no ha filtrado nunca nada**.
Escribieras lo que escribieras, salía la lista entera. Se arregla con
`Reflect.ownKeys`, que sí ve los symbols, y hay una prueba que impide que
`Object.keys` vuelva a decidir sobre un `where` de Sequelize.

Se cuenta aquí porque es la moraleja de la tarde: **el arreglo no estaba
probado hasta que se probó contra la base**. Leído, el código de Matrículas
parecía correcto.

## La segunda tanda: los quince que quedaban

El mismo día, Jorge: «ponte a hacerlas». Los quince buscadores que se habían
dejado fuera **no tenían el síntoma** —miran una sola columna con el nombre
completo, así que «hugo castro» sí encontraba a «Hugo Castro Díaz»— pero sí el
fondo: había que escribirlo **en el mismo orden que la ficha y con las tildes
puestas**. Ya están todos con la misma regla.

En el **servidor** (`filtroPorNombre`): Clientes y su Excel, Leads y su Excel,
Equipo, Proveedores, Citas (la lista de reservas y el selector del alta
manual), Soporte, Correo → destinatarios (sus cuatro fuentes), Facturas,
Presupuestos y su Excel, y Cuestionarios por sus tres puertas.

En el **navegador** (`coincidePorNombre`): el desplegable con buscador que
comparte todo el CRM (`components/ui/Select.jsx`), el filtro de profesional de
la agenda (`MultiSelect.jsx`), las Pautas de Laura y las cinco pantallas de
Facturación.

### Lo que obligó a partir la pieza en dos

`lib/utils/busqueda.js` nació importando Sequelize. En cuanto tocó usarla en
`components/ui/Select.jsx` —un componente de cliente— eso habría metido
Sequelize en el paquete del navegador. Se partió en el acto:

| Fichero | Qué lleva | Regla |
| --- | --- | --- |
| `lib/utils/busqueda.js` | la regla pura: `palabrasDe`, `coincidePorNombre`, `sinTildes` | **no importa NADA**, y hay una prueba que lo vigila |
| `lib/utils/busquedaDb.js` | `filtroPorNombre`, `condicionPorPalabras`, `hasUnaccentSupport` | aquí vive Sequelize |

Es el mismo reparto que `lib/auth/contrasena.js` y `correoCuentaDb.js`, y por el
mismo motivo. Que las dos orillas normalicen IGUAL no es un detalle: si el
servidor quitara tildes y el navegador no, la misma búsqueda daría resultados
distintos según quién la resolviera.

### Tres cosas que aparecieron al hacerlo, y no eran de búsqueda

**El Excel de Clientes se saltaba dos filtros que la pantalla sí aplica.** No
respetaba «consultas externas» —la regla de Rodrigo del 07/08/2026: esos
pacientes solo los ven admin y quien los lleva— así que era una puerta lateral
a un permiso. Medido antes de tocar nada: **cero fichas marcadas como externas
en toda la producción**, o sea que no se ha escapado nada; se cierra antes de
que la haya. Y tampoco leía el filtro por tipo de contratante, que la pantalla
sí le manda — con un comentario en la pantalla que avisaba de que «bajar
festivales y recibir los 183 sería una sorpresa cara». La sorpresa estaba
pasando.

**En Gastos y en Recurrentes el buscador contradecía a su propia tabla.** La
tabla pinta «Alquiler», «Fijo», «Mensual»; el buscador solo miraba `salary`,
`fixed`, `monthly`. Escribir exactamente lo que se está viendo no devolvía
nada, y en Recurrentes la caja promete literalmente «Buscar por cliente,
frecuencia, estado…». Ahora se busca por la etiqueta **y** por la clave.

**El buscador de Correo podía escribirle a quien no era.** Pegaba en una sola
cadena el nombre de la familia, su correo, los tutores y los pacientes, y
buscaba dentro. Eso deja que una búsqueda case a caballo entre el final de un
campo y el principio del siguiente. En una pantalla desde la que se manda
correo, un falso positivo no es «no sale nadie»: es marcar la casilla de quien
no era. Pasando los campos como LISTA, cada palabra tiene que caber dentro de
uno.

### Y el techo del selector de Soporte

«Nuevo ticket» se bajaba 200 fichas al abrir y filtraba encima. Con las 1.083
de Aumenta eso dejaba a **883 familias** fuera del alcance escribieras lo que
escribieras — y la caja contestaba «Sin resultados», lo mismo que si no
existieran. **Un techo callado se lee como una ausencia.** Ahora pregunta al
servidor según se escribe y, cuando hay más coincidencias que sitio, lo dice.
Detalle en `docs/modules/support.md`.

## La red que faltaba: `no-undef`

Al aplicar los quince se olvidaron **dos imports** —Soporte y el Excel de
Presupuestos—. Lint verde, build verde, `npm test` verde, y los dos daban 500
en cuanto alguien escribía en la caja. Salieron solo al llamar a los endpoints
uno a uno.

El motivo: `eslint-config-next` **no lleva `no-undef`** (esa red la da
TypeScript, y aquí no hay) y el build de Next tampoco. Así que se añadió una
config aparte que hace una sola cosa:

```bash
npm run lint:undef
```

Once segundos sobre todo el repo. Y lo primero que encontró al pasarlo entero
fue un fallo que llevaba semanas: `app/api/public/c/[tenantSlug]/registro-web`
tenía dos `void nombre; void wpUserId;` señalando a variables que ya no
existían. En un módulo ESM eso lanza `ReferenceError`, lo recoge el `catch` y
el endpoint contestaba **500** — cuando la única razón por la que esa ruta
sigue viva es responder 200 para que el WordPress que la llama no registre
errores en cada alta. Es de WordPress a servidor, así que nadie lo veía.
## Y de paso: el listado vacío mentía

En la segunda captura de Jorge, la búsqueda sin resultados contestaba:

> «Aún no hay pacientes. Crea el primero con «Nuevo paciente».»

O sea que el centro parecía **vacío** teniendo 1.174 fichas. El mensaje se
elegía con `patients.length === 0`, y como el filtrado lo hace el **servidor**,
eso es 0 en cuanto una búsqueda no encuentra nada: la rama de «sin resultados»
no se pintaba nunca. Ahora se decide por si hay algún filtro puesto.

## Dónde está

| Qué | Dónde |
| --- | --- |
| La regla, con Sequelize | `lib/utils/busquedaDb.js` |
| Pacientes | `app/api/pacientes/route.js` |
| El listado vacío | `app/(dashboard)/pacientes/page.jsx` |
| Formación | `app/api/training/users/route.js` (+ `export/`), `app/api/training/enrollments/route.js` (+ `export/`), `app/api/external/retorika/alumnos/route.js` |
| La prueba | `scripts/_smoke-busqueda-nombre.mjs` |
| La regla pura (también para el navegador) | `lib/utils/busqueda.js` — sin un solo import |
| La red de identificadores sin importar | `eslint.undef.mjs` · `npm run lint:undef` |
| Detectar `unaccent` | vivía en `lib/nutricion/foods.js`; se ha mudado a `lib/utils/busqueda.js` y se sigue exportando desde allí |
