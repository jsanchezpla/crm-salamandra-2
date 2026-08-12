/**
 * lib/provisioning/paquetesStore.js — el ÚNICO sitio que lee la tabla de
 * paquetes.
 *
 * (Fichero nuevo en /lib, regla #2: lo comparten el alta de clientes y la
 * pantalla que los gestiona. Si cada uno leyera la tabla por su cuenta, el
 * degradado de abajo estaría escrito dos veces y se desincronizaría.)
 *
 * ── EL DEGRADADO, QUE ES LA RAZÓN DE QUE ESTO EXISTA ────────────────────────
 * `deploy.sh` NO ejecuta migraciones: se despliega el código y la tabla se crea
 * después, a mano, con un `docker exec`. O sea que existe una ventana —minutos
 * o días, según quién se acuerde— en la que el código nuevo corre contra una
 * base sin `master.paquetes_modulos`.
 *
 * Durante esa ventana el alta de clientes NO puede reventar: es el endpoint que
 * da de alta a los clientes. Así que si la tabla no está, se devuelven los dos
 * paquetes de siempre —los que hasta hoy estaban escritos en `catalogo.js`—
 * marcados como `soloLectura`. El alta sigue exactamente igual que ayer y la
 * pantalla de gestión avisa de que falta correr la migración.
 *
 * ⚠️ Y una distinción que importa: **tabla que no existe ≠ tabla vacía**. Si la
 * tabla está y no tiene filas, se devuelve vacío y el alta se queda sin
 * botones. Eso NO es un fallo: es que alguien borró los paquetes, y resucitarle
 * los del código sería deshacerle el trabajo. Un borrado que no borra es peor
 * que no poder borrar.
 */

import { getMasterModels } from "../db/masterDb.js";
import { PAQUETES_SEMILLA } from "./catalogo.js";
import { serializarPaquete } from "./paquetes.js";

/** ¿El error es «esa tabla todavía no existe»? (Postgres 42P01) */
function faltaLaTabla(err) {
  const código = err?.parent?.code ?? err?.original?.code;
  return código === "42P01";
}

/**
 * Los paquetes que se le ofrecen al alta: solo los activos, en su orden.
 *
 * @returns {Promise<{paquetes: object[], soloLectura: boolean}>}
 */
export async function leerPaquetesActivos() {
  try {
    const { PaqueteModulos } = getMasterModels();
    const filas = await PaqueteModulos.findAll({
      where: { activo: true },
      order: [
        ["orden", "ASC"],
        ["nombre", "ASC"],
      ],
    });
    return { paquetes: filas.map(serializarPaquete), soloLectura: false };
  } catch (err) {
    if (!faltaLaTabla(err)) throw err;
    return { paquetes: PAQUETES_SEMILLA.map(serializarPaquete0), soloLectura: true };
  }
}

/**
 * Todos, activos o no, para la pantalla que los gestiona.
 *
 * @returns {Promise<{paquetes: object[], soloLectura: boolean}>}
 */
export async function leerTodosLosPaquetes() {
  try {
    const { PaqueteModulos } = getMasterModels();
    const filas = await PaqueteModulos.findAll({
      order: [
        ["orden", "ASC"],
        ["nombre", "ASC"],
      ],
    });
    return { paquetes: filas.map(serializarPaquete), soloLectura: false };
  } catch (err) {
    if (!faltaLaTabla(err)) throw err;
    return { paquetes: PAQUETES_SEMILLA.map(serializarPaquete0), soloLectura: true };
  }
}

/**
 * La semilla tiene la forma vieja (`key`, `nombre`, `desc`, `modulos`) y no
 * lleva ni id ni orden. Se le da la misma forma que a una fila para que quien
 * consume no tenga que saber de dónde vino.
 */
function serializarPaquete0(p) {
  return {
    id: null,
    key: p.key,
    nombre: p.nombre,
    desc: p.desc ?? "",
    modulos: [...(p.modulos ?? [])],
    orden: 0,
    activo: true,
    tocadoPor: null,
  };
}
