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

## Lo que NO se ha tocado

Hay unos quince buscadores más que comparten el fondo del problema pero **no el
síntoma**: los que miran una sola columna con el nombre completo (`clients.name`,
`team_members.display_name`, `bookings.client_name`, `leads.name`…). Ahí «hugo
castro» **sí** encuentra a «Hugo Castro Díaz», porque esa frase está entera
dentro de la columna. Lo que falla es escribirlo al revés («castro hugo»),
saltarse un apellido («hugo díaz») o escribirlo sin tildes.

No se han tocado, y es una decisión, no un olvido: son quince pantallas de seis
módulos, no es lo que se rompió, y cambiarlas todas a la vez sin que nadie lo
haya pedido es mucho más riesgo del que resuelve. Queda apuntado en el Registro
con la lista exacta para decidirlo con calma. Cuando se haga, la pieza ya está
escrita: es una línea por endpoint.

Dos cosas que salieron del barrido y **tampoco** son esto, apuntadas para no
perderlas:

- **Soporte → Nuevo ticket** solo descarga las 200 primeras fichas de cliente,
  así que en Aumenta (1.083) la mayoría de la gente no aparece **escribas lo que
  escribas**. Eso no es un problema de búsqueda, es un techo.
- **Correo → destinatarios** junta el nombre de la familia, su correo, los
  tutores y los pacientes en una sola cadena antes de buscar, así que puede dar
  **falsos positivos**: una búsqueda casa a caballo entre dos campos pegados.

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
| La regla | `lib/utils/busqueda.js` |
| Pacientes | `app/api/pacientes/route.js` |
| El listado vacío | `app/(dashboard)/pacientes/page.jsx` |
| Formación | `app/api/training/users/route.js` (+ `export/`), `app/api/training/enrollments/route.js` (+ `export/`), `app/api/external/retorika/alumnos/route.js` |
| La prueba (49 casos) | `scripts/_smoke-busqueda-nombre.mjs` |
| Detectar `unaccent` | vivía en `lib/nutricion/foods.js`; se ha mudado a `lib/utils/busqueda.js` y se sigue exportando desde allí |
