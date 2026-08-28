// @prueba ligera — funciones puras de /lib; sin base, sin servidor, sin .env.
/**
 * _smoke-busqueda-nombre.mjs — buscar a alguien por su nombre COMPLETO
 * (28/08/2026).
 *
 *   node scripts/_smoke-busqueda-nombre.mjs
 *   node --test-name-pattern="apellido" scripts/_smoke-busqueda-nombre.mjs
 *
 * ── DE QUÉ FALLO REAL NACE ─────────────────────────────────────────────────
 *
 * Jorge, el 28/08/2026, con dos capturas de Clínica → Pacientes de Aumenta: al
 * escribir «hugo» salía la lista de Hugos; al escribir «hugo castro», nada — y
 * «Hugo Castro Díaz» estaba en la primera lista, tres filas más arriba.
 *
 * El buscador metía la frase ENTERA dentro de cada columna por separado
 * (`first_name ILIKE '%hugo castro%' OR last_name ILIKE '%hugo castro%'`), y esa
 * cadena no está entera en ninguna de las dos. Medido en producción antes de
 * tocar nada: de los 1.174 pacientes de Aumenta, los 1.174 eran imposibles de
 * encontrar escribiendo su propio nombre y su primer apellido.
 *
 * Lo que esta prueba fija es la REGLA, no el SQL: todas las palabras, cada una
 * en cualquier campo, sin importar el orden ni las tildes. Si alguien vuelve a
 * la frase entera, aquí se entera antes de que lo note un centro.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Op } from "sequelize";
// La regla pura y la mitad que habla con Sequelize viven en ficheros
// distintos: `busqueda.js` no importa nada para que la pueda usar el
// navegador. Si algún día vuelven a juntarse, esta prueba deja de compilar.
import {
  palabrasDe,
  escaparLike,
  sinTildes,
  coincidePorNombre,
  MAX_PALABRAS,
} from "../lib/utils/busqueda.js";
import { condicionPorPalabras } from "../lib/utils/busquedaDb.js";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (p) => readFileSync(join(RAIZ, p), "utf8");

// Un paciente de verdad de Aumenta tiene esta forma: el nombre en una columna y
// los DOS apellidos juntos en la otra. Es lo que hace imposible buscar la frase
// entera en una sola.
const HUGO = ["Hugo", "Castro Díaz"];

describe("palabrasDe — partir lo que ha escrito una persona", () => {
  it("parte por espacios y baja a minúsculas", () => {
    assert.deepEqual(palabrasDe("Hugo CASTRO"), ["hugo", "castro"]);
  });

  it("aguanta los espacios de más, que es lo que se teclea de verdad", () => {
    assert.deepEqual(palabrasDe("  Hugo   Castro  "), ["hugo", "castro"]);
  });

  it("no se rompe con lo que no es texto", () => {
    assert.deepEqual(palabrasDe(null), []);
    assert.deepEqual(palabrasDe(undefined), []);
    assert.deepEqual(palabrasDe(42), []);
    assert.deepEqual(palabrasDe(""), []);
    assert.deepEqual(palabrasDe("   "), []);
  });

  it("pone tope a las palabras: 400 palabras no montan 400 condiciones", () => {
    const muchas = Array.from({ length: 50 }, (_, i) => `p${i}`).join(" ");
    assert.equal(palabrasDe(muchas).length, MAX_PALABRAS);
  });

  it("NO quita las tildes: de eso se encarga Postgres, en los dos lados a la vez", () => {
    assert.deepEqual(palabrasDe("Díaz"), ["díaz"]);
  });
});

describe("escaparLike — el comodín escrito a mano no se lleva la lista entera", () => {
  it("escapa % y _", () => {
    assert.equal(escaparLike("100%"), "100\\%");
    assert.equal(escaparLike("a_b"), "a\\_b");
  });

  it("escapa la propia barra invertida", () => {
    assert.equal(escaparLike("a\\b"), "a\\\\b");
  });

  it("deja en paz un nombre normal", () => {
    assert.equal(escaparLike("castro"), "castro");
  });
});

describe("sinTildes — las dos orillas normalizan igual", () => {
  it("quita tildes", () => {
    assert.equal(sinTildes("Díaz"), "Diaz");
  });

  // `unaccent` de Postgres convierte la eñe en ene. Si el navegador no hiciera
  // lo mismo, «munoz» encontraría a Muñoz en el servidor y no en una lista ya
  // descargada: la misma búsqueda daría dos resultados distintos.
  it("convierte la eñe en ene, como hace unaccent", () => {
    assert.equal(sinTildes("Muñoz"), "Munoz");
  });

  it("no se rompe con vacío", () => {
    assert.equal(sinTildes(null), "");
    assert.equal(sinTildes(undefined), "");
  });
});

describe("coincidePorNombre — la regla, tal y como busca una persona", () => {
  it("EL FALLO: nombre + primer apellido encuentra a la persona", () => {
    assert.equal(coincidePorNombre("hugo castro", HUGO), true);
  });

  it("el nombre suelto sigue funcionando, que es lo único que iba antes", () => {
    assert.equal(coincidePorNombre("hugo", HUGO), true);
  });

  it("el nombre completo, con los dos apellidos", () => {
    assert.equal(coincidePorNombre("hugo castro diaz", HUGO), true);
  });

  it("da igual el orden: «castro hugo» también lo encuentra", () => {
    assert.equal(coincidePorNombre("castro hugo", HUGO), true);
  });

  it("saltarse el apellido de en medio vale: «hugo diaz»", () => {
    assert.equal(coincidePorNombre("hugo diaz", HUGO), true);
  });

  it("sin tildes: «diaz» encuentra a «Díaz»", () => {
    assert.equal(coincidePorNombre("diaz", HUGO), true);
  });

  it("con tildes también, por si alguien las escribe", () => {
    assert.equal(coincidePorNombre("díaz", HUGO), true);
  });

  it("exige TODAS las palabras: una que no está lo deja fuera", () => {
    assert.equal(coincidePorNombre("hugo lopez", HUGO), false);
  });

  it("sin nada escrito, entra todo el mundo", () => {
    assert.equal(coincidePorNombre("", HUGO), true);
    assert.equal(coincidePorNombre("   ", HUGO), true);
  });

  it("una ficha sin ningún campo no casa con una búsqueda con texto", () => {
    assert.equal(coincidePorNombre("hugo", [null, ""]), false);
  });

  it("busca por trozos, no solo por el principio de la palabra", () => {
    assert.equal(coincidePorNombre("cast", HUGO), true);
  });
});

describe("condicionPorPalabras — la cláusula que va a Sequelize", () => {
  const COLS = ["Patient.first_name", "Patient.last_name"];

  it("sin texto no devuelve cláusula: quien la llama no añade nada al where", () => {
    assert.equal(condicionPorPalabras("", COLS), null);
    assert.equal(condicionPorPalabras("   ", COLS), null);
    assert.equal(condicionPorPalabras(null, COLS), null);
  });

  it("sin columnas tampoco", () => {
    assert.equal(condicionPorPalabras("hugo", []), null);
    assert.equal(condicionPorPalabras("hugo", null), null);
  });

  it("una condición por palabra, colgando de Op.and (todas obligatorias)", () => {
    const c = condicionPorPalabras("hugo castro", COLS);
    assert.equal(c[Op.and].length, 2);
  });

  // Esto es EL arreglo: cada palabra puede caer en cualquiera de las dos
  // columnas. Si esto se convirtiera en un Op.and por columna, «hugo castro»
  // exigiría que las dos palabras estén en el nombre Y en el apellido, y
  // volveríamos al fallo por el otro lado.
  it("cada palabra vale en CUALQUIERA de las columnas (Op.or por dentro)", () => {
    const c = condicionPorPalabras("hugo castro", COLS);
    for (const porPalabra of c[Op.and]) {
      assert.equal(porPalabra[Op.or].length, COLS.length);
    }
  });

  it("una sola palabra sigue siendo un Op.and de uno, no un caso aparte", () => {
    const c = condicionPorPalabras("hugo", COLS);
    assert.equal(c[Op.and].length, 1);
  });

  it("con y sin unaccent devuelve la misma FORMA (una palabra, dos columnas)", () => {
    const con = condicionPorPalabras("hugo", COLS, { unaccent: true });
    const sin = condicionPorPalabras("hugo", COLS, { unaccent: false });
    assert.equal(con[Op.and].length, sin[Op.and].length);
    assert.equal(con[Op.and][0][Op.or].length, sin[Op.and][0][Op.or].length);
  });
});

// ── Que el arreglo siga puesto donde hacía falta ────────────────────────────
// Aquí el texto SÍ es la prueba: lo que se vigila es que nadie vuelva a la
// versión de la frase entera, ni deshaga el mensaje del listado vacío.

describe("Pacientes usa el buscador nuevo", () => {
  const ruta = leer("app/api/pacientes/route.js");

  it("ya no busca la frase entera dentro de cada columna", () => {
    assert.ok(
      !/firstName:\s*\{\s*\[Op\.iLike\]/.test(ruta),
      "ha vuelto el `firstName: { [Op.iLike]: '%q%' }`: «hugo castro» no encuentra a «Hugo Castro Díaz»"
    );
  });

  it("llama a filtroPorNombre con las dos columnas del nombre", () => {
    assert.match(ruta, /filtroPorNombre\(\s*ctx\.tenantSequelize/);
    assert.match(ruta, /Patient\.first_name/);
    assert.match(ruta, /Patient\.last_name/);
  });

  // Las columnas van cualificadas con el alias del modelo a propósito: la
  // consulta lleva un include de TeamMember, y una columna suelta que exista en
  // las dos tablas saldría ambigua y devolvería un 500.
  it("las columnas van con el alias del modelo por delante", () => {
    assert.ok(
      !/filtroPorNombre\([^)]*["']first_name["']/.test(ruta),
      "columna sin cualificar: con el include puede salir ambigua"
    );
  });

  it("la búsqueda cuelga de Op.and, no de where[Op.or]", () => {
    assert.ok(
      !/where\[Op\.or\]\s*=/.test(ruta),
      "un where[Op.or] se pisa con el del filtro por terapeuta, en silencio"
    );
  });
});

describe("El listado vacío no dice que el centro no tiene pacientes", () => {
  const pagina = leer("app/(dashboard)/pacientes/page.jsx");

  it("decide el mensaje por si hay filtro, no por si la lista está vacía", () => {
    assert.match(pagina, /const hayFiltro\s*=/);
    assert.ok(
      !/patients\.length === 0 \? "Aún no hay pacientes/.test(pagina),
      "vuelve a mirar patients.length: como filtra el servidor, eso es 0 en cuanto una búsqueda no encuentra nada"
    );
  });

  it("sigue existiendo el mensaje de «sin resultados»", () => {
    assert.match(pagina, /Sin resultados para esos filtros/);
  });
});

describe("Formación busca igual: es la otra tabla con el nombre partido", () => {
  // `patients` y `training_users` son las DOS únicas tablas del CRM que
  // guardan el nombre en dos columnas. Comprobado recorriendo models/: no hay
  // ninguna más, así que este fallo no puede existir en ningún otro sitio.
  const LISTAS = [
    ["app/api/training/users/route.js", "Alumnos"],
    ["app/api/training/users/export/route.js", "el Excel de Alumnos"],
  ];
  const MATRICULAS = [
    ["app/api/training/enrollments/route.js", "Matrículas"],
    ["app/api/training/enrollments/export/route.js", "el Excel de Matrículas"],
  ];

  for (const [ruta, quien] of [...LISTAS, ...MATRICULAS]) {
    it(`${quien} ya no busca la frase entera en cada columna`, () => {
      const src = leer(ruta);
      assert.ok(
        !src.includes("name: { [Op.iLike]"),
        `${ruta}: ha vuelto la frase entera; nombre + apellido no encontrará a nadie`
      );
      assert.ok(src.includes("filtroPorNombre("), `${ruta}: ya no llama al buscador nuevo`);
    });

    it(`${quien} busca también por el apellido`, () => {
      assert.match(leer(ruta), /last_name/);
    });
  }

  // El filtro de Matrículas viaja DENTRO del include, y ahí la columna se
  // cualifica con el alias de la ASOCIACIÓN. Con el del modelo, Postgres
  // contesta «falta una entrada para la tabla en la cláusula FROM»: un 500 en
  // cuanto alguien escribe algo. Probado contra la base el 28/08/2026.
  for (const [ruta, quien] of MATRICULAS) {
    it(`${quien} cualifica con el alias de la asociación, no con el del modelo`, () => {
      const src = leer(ruta);
      assert.ok(src.includes('"trainingUser.name"'), `${ruta}: falta el alias de la asociación`);
      assert.ok(
        !src.includes('"TrainingUser.name"'),
        `${ruta}: dentro de un include, «TrainingUser.name» es un 500`
      );
    });
  }

  it("el endpoint que consume la web de Retorika también busca por apellido", () => {
    const src = leer("app/api/external/retorika/alumnos/route.js");
    assert.ok(src.includes("filtroPorNombre("), "ya no llama al buscador nuevo");
    assert.ok(src.includes("TrainingUser.last_name"), "sigue sin buscar por el apellido");
  });
});

describe("El nombre partido solo está en dos tablas", () => {
  // Si algún día una tabla nueva parte el nombre, esta prueba la caza y obliga
  // a mirar si su buscador tiene el mismo agujero.
  it("solo Patient y TrainingUser tienen nombre y apellido en columnas distintas", () => {
    const dir = join(RAIZ, "models", "tenant");
    const conApellido = readdirSync(dir).filter((f) =>
      readFileSync(join(dir, f), "utf8").includes("lastName:")
    );
    assert.deepEqual(
      conApellido.sort(),
      ["Patient.model.js", "TrainingUser.model.js"],
      "hay una tabla nueva con el nombre partido: mira si su buscador junta las dos columnas"
    );
  });
});

describe("El buscador de Matrículas llega a aplicarse", () => {
  /*
   * Fallo aparte, y peor, encontrado el 28/08/2026 al probar el arreglo: el
   * filtro se montaba bien pero nunca se colgaba de la consulta. El include
   * decidía si ponerlo con `Object.keys(userWhere).length`, y las claves de
   * Sequelize (`Op.and`, `Op.or`) son SYMBOLS: `Object.keys` no las ve, así que
   * eso valía 0 SIEMPRE y el `where` se quedaba en `undefined`. Resultado: el
   * buscador de Formación → Matrículas devolvía la lista entera escribieras lo
   * que escribieras. Comprobado contra la base: 12 matrículas para todo, hasta
   * para un texto inventado; con el arreglo, 12 sin buscar y 0 con el inventado.
   */
  const CON_INCLUDE = [
    "app/api/training/enrollments/route.js",
    "app/api/training/enrollments/export/route.js",
    "app/api/external/retorika/alumnos/route.js",
  ];

  for (const ruta of CON_INCLUDE) {
    it(`${ruta} no decide con Object.keys sobre un where con symbols`, () => {
      const src = leer(ruta);
      assert.ok(
        !/Object.keys([a-zA-Z]*[Ww]here)/.test(src),
        `${ruta}: Object.keys no ve Op.and/Op.or, el filtro no se aplicaría nunca`
      );
      assert.ok(src.includes("Reflect.ownKeys"), `${ruta}: falta el Reflect.ownKeys`);
    });
  }
});

describe("El selector de cliente de un ticket llega a TODAS las fichas", () => {
  /*
   * 28/08/2026. No es un fallo de búsqueda: era un TECHO. La caja «Buscar
   * cliente…» de Soporte → «Nuevo ticket» no preguntaba al servidor: se bajaba
   * una lista al abrir el modal y filtraba encima. La lista venía cortada a 200
   * fichas, y el endpoint corta en 200 por su cuenta, así que subir el número no
   * arreglaba nada.
   *
   * En Aumenta, con 1.083 fichas y Soporte encendido, eso dejaba a 883 familias
   * —el 82%— fuera del alcance ESCRIBIERAS LO QUE ESCRIBIERAS. Y lo peor: la
   * caja contestaba «Sin resultados», exactamente lo mismo que si esa familia no
   * existiera. Un techo callado se lee como una ausencia.
   */
  const modal = leer("modules/support/NewTicketModal.jsx");

  it("no se baja una lista entera para filtrarla en el navegador", () => {
    assert.ok(
      !modal.includes("/api/clients?limit=200"),
      "ha vuelto la lista de 200: en Aumenta deja 883 familias sin alcanzar"
    );
  });

  it("le pasa lo escrito al servidor", () => {
    // Desde el 28/08/2026 la dirección la arma `lib/clients/buscarFichas.js`,
    // compartida con el desplegable de las otras once pantallas. Lo que se
    // vigila aquí es que el modal SIGA preguntando con lo tecleado; que esa
    // dirección esté bien montada lo prueba `_smoke-selector-fichas.mjs`.
    assert.ok(
      modal.includes("urlDeFichas(texto)"),
      "la búsqueda ya no viaja al servidor: vuelve a filtrar sobre lo descargado"
    );
  });

  it("no filtra por su cuenta la lista que le devuelve el servidor", () => {
    assert.ok(
      !/clientes\.filter\(/.test(modal),
      "filtrar en el navegador lo que ya viene filtrado reintroduce el techo"
    );
  });

  // Si hay más fichas que las que caben, hay que DECIRLO. Que la caja enseñe lo
  // que le cabe y calle el resto es lo que hacía que «no está» y «no cabe» se
  // vieran igual.
  it("avisa cuando hay más coincidencias que sitio", () => {
    assert.ok(modal.includes("coincidencias > clientes.length"));
    assert.ok(modal.includes("coinciden"));
  });

  // La ficha prefijada puede no estar entre las que se han traído, así que se
  // pide por su id. Antes se buscaba dentro de la lista descargada y salía como
  // «sin elegir» aunque el ticket sí fuera a nacer con ella.
  it("la ficha prefijada se pide por su id, no se busca en la lista", () => {
    assert.ok(modal.includes("/api/clients/${clientePrefijado}"));
  });
});

describe("La regla se puede usar también en el navegador", () => {
  /*
   * `lib/utils/busqueda.js` NO puede importar nada. La misma regla hace falta
   * en las dos orillas —el servidor cuando la lista sale de una consulta, el
   * navegador cuando ya está descargada y se filtra encima— y si buscar
   * significara una cosa en cada sitio, la misma palabra daría resultados
   * distintos según quién la resolviera.
   *
   * Como los desplegables con buscador son componentes de cliente, un import de
   * Sequelize aquí arrastraría Sequelize al paquete del navegador. Es el mismo
   * reparto que `lib/auth/contrasena.js` (pura) y `correoCuentaDb.js`, y se
   * rompió una vez: nació junto y hubo que partirlo al ir a usarlo en
   * `components/ui/`.
   */
  it("busqueda.js no importa NADA", () => {
    const src = leer("lib/utils/busqueda.js");
    const imports = src.split(/\r?\n/).filter((l) => /^\s*import\s/.test(l));
    assert.deepEqual(
      imports,
      [],
      "un import aquí mete esa dependencia en el paquete del navegador: llévalo a busquedaDb.js"
    );
  });

  it("y la mitad de Sequelize está en busquedaDb.js", () => {
    const db = leer("lib/utils/busquedaDb.js");
    assert.match(db, /from "sequelize"/);
    assert.match(db, /export async function filtroPorNombre/);
  });
});
