# «Fichas a completar»: una sola fuente para el número y las filas, y cuelga de `clients_avanzado`

**Fecha:** 03/08/2026 (la pantalla, tras migrar Aumenta) y 04/08/2026 (el
gateo, Rodrigo) · **Módulos:** clients, clients_avanzado · **Lo que quedó en
`CLAUDE.md`:** la fila de `/clientes/urgentes` en la tabla del sprint Aumenta
y la regla de las tres puertas.

## Qué es

`/clientes/urgentes` sale de `lib/clients/urgentes.js`, que define las
CARPETAS y sus consultas en un solo sitio: **el total de la carpeta y las filas
que se ven al abrirla TIENEN que salir de la misma fuente, o nadie se fía del
número**. Dos bloques —lo que bloquea el trabajo (decenas) y la ficha
incompleta (miles)— porque una lista que no se puede terminar deja de mirarse.
Las filas se archivan con `data_reviews` («esto ya lo he mirado y está bien»):
sin eso no llega a cero nunca, porque hay huecos correctos —un paciente en
lista de espera no tiene terapeuta—. Las carpetas no se solapan a propósito.

## Por qué cuelga de `clients_avanzado` y no de `clients`

Nació con `clients` a secas y por eso le salió a TODOS los clientes con fichas,
incluido `nutri_laura`, que no lo había pedido. La pantalla resuelve el
problema de un centro que importó 1.083 familias y arrastra miles de huecos,
no el de una consulta de una persona que conoce a sus pacientes por el nombre.

## Las tres puertas

Gatean las TRES: el menú (`Sidebar.jsx`), la página —server component que hace
`notFound()`, como Lista de espera— y el endpoint. **Solo el menú no basta**:
con la URL guardada se seguiría sacando el listado entero.

## Cómo se aplica hoy

Es el patrón para cualquier pantalla que sea de un tipo de cliente y no de
todos: se cuelga del módulo «avanzado» que la justifica (aquí
`clients_avanzado`, igual que `team_avanzado` o `documents_avanzado`), y se
gatea en las tres puertas.
