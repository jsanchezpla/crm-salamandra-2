import { DataTypes } from "sequelize";

/**
 * Un aviso que un cliente nos manda A NOSOTROS (Salamandra).
 *
 * ── LAS TRES COSAS QUE SUENAN IGUAL Y NO LO SON ─────────────────────────────
 *   · `Ticket` (módulo Soporte) — del cliente hacia SUS clientes.
 *   · `Incidencia` (módulo Clínica) — se queda dentro del centro, asignada a
 *     alguien de su propio equipo. En el sidebar de Aumenta ya existe con ese
 *     nombre.
 *   · `ClientNotice` — «Aviso al cliente», del centro hacia el paciente.
 *   · esto — del usuario de cualquier cliente hacia nosotros.
 * Por eso ni el modelo ni la tabla se llaman «incidencia» ni «aviso» a secas.
 *
 * ── POR QUÉ VIVE EN MASTER, Y POR QUÉ ES UNA EXCEPCIÓN ──────────────────────
 * `lib/utils/auditoria.js` y `docs/base/db-conventions.md` §6.2 dicen que en
 * master NUNCA se duplican datos personales del schema de un cliente, porque
 * master la comparten todos. Esto se salta esa regla, y hay que saber por qué:
 *
 *   · El texto NO es una copia de ninguna ficha. Lo escribe una persona, a
 *     propósito, y dirigido a nosotros.
 *   · Tiene que sobrevivir a la baja del cliente (el 12/08 se purgaron tres
 *     schemas) y funcionar aunque su base esté rota, que es cuando escriben.
 *
 * La excepción se paga con tres frenos, no con uno: el formulario pide que no
 * se escriban nombres de pacientes, `auditar()` guarda solo el número y el
 * cliente —nunca el texto, o acabaría duplicado en `master.audit_logs`, que es
 * justo la tabla que la regla protege—, y `scripts/podar-buzon.js` lo caduca.
 *
 * ── SIN CLAVES AJENAS, Y CON FOTOS DE TEXTO ─────────────────────────────────
 * `tenantId` y `usuarioId` NO son FK, y al lado se guardan `tenantSlug`,
 * `tenantNombre`, `usuarioEmail` y `usuarioNombre` como texto. Hay prueba de qué
 * pasa si no: `master.audit_logs` sí tiene FK con ON DELETE SET NULL, y por eso
 * `scripts/borrar-tenant.js` necesita una sección entera para que el histórico
 * no se quede sin atribución. El UUID se guarda igualmente (suelto) porque hace
 * falta para `auditar({ tenantId })` mientras el cliente exista.
 *
 * ── LA PRIORIDAD LA PONEMOS NOSOTROS ────────────────────────────────────────
 * `prioridad` y `asignadoA` son NUESTROS; el cliente no los ve ni los toca. Un
 * desplegable de urgencia en manos de quien reporta se satura en «alta» en dos
 * semanas y deja de ordenar nada. Lo que sí decide el cliente es `bloquea`, que
 * no es una opinión: o puede seguir trabajando, o no.
 *
 * El único que escribe aquí es `lib/buzon/buzonStore.js`, que valida contra
 * `lib/buzon/buzon.js`. Por eso las listas cerradas son STRING y no ENUM: la
 * validación vive en un solo sitio y añadir un estado no pide una migración.
 */
export function defineBuzonAviso(sequelize) {
  return sequelize.define(
    "BuzonAviso",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },

      /**
       * Correlativo GLOBAL (una sola bandeja para todos los clientes). Se enseña
       * como «AV-0042». Lo pone la BD con `nextval`, nunca la app: dos avisos a
       * la vez no pueden pelearse por el número. Se lee de vuelta con RETURNING,
       * igual que `Ticket.number`.
       */
      numero: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },

      // ── Quién escribe, congelado en el momento de escribir ────────────────
      tenantId: { type: DataTypes.UUID, allowNull: true },
      tenantSlug: { type: DataTypes.STRING(63), allowNull: false },
      tenantNombre: { type: DataTypes.STRING(255), allowNull: true },
      usuarioId: { type: DataTypes.UUID, allowNull: true },
      usuarioEmail: { type: DataTypes.STRING(255), allowNull: true },
      usuarioNombre: { type: DataTypes.STRING(255), allowNull: true },
      usuarioRol: { type: DataTypes.STRING(40), allowNull: true },

      // ── Lo que escribe el cliente ─────────────────────────────────────────
      /** "error" | "duda" | "mejora" */
      tipo: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "error" },
      asunto: { type: DataTypes.STRING(200), allowNull: false },
      cuerpo: { type: DataTypes.TEXT, allowNull: false },
      /** «No puedo seguir trabajando». Un hecho, no una opinión. */
      bloquea: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },

      // ── Lo que ponemos nosotros ───────────────────────────────────────────
      /** "nuevo" | "en_curso" | "esperando" | "resuelto" */
      estado: { type: DataTypes.STRING(20), allowNull: false, defaultValue: "nuevo" },
      /** "baja" | "normal" | "alta" */
      prioridad: { type: DataTypes.STRING(10), allowNull: false, defaultValue: "normal" },
      /** "jorge" | "rodrigo" | null — la misma lista cerrada que el Registro. */
      asignadoA: { type: DataTypes.STRING(40), allowNull: true },

      // ── Contexto que se captura solo ──────────────────────────────────────
      /** La ruta desde la que escribió. Ahorra la mitad de las repreguntas. */
      pantalla: { type: DataTypes.STRING(500), allowNull: true },
      /** Navegador y tamaño de ventana. Nada de datos personales. */
      contexto: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },

      /** Cuándo lo abrimos NOSOTROS. */
      leidoAt: { type: DataTypes.DATE, allowNull: true },
      /**
       * Cuándo lo abrió ÉL. Es lo único que permite encender un punto en su menú
       * cuando le hemos contestado y aún no lo ha visto, y apagarlo cuando entra.
       * Sin esta columna el punto se quedaría encendido para siempre.
       */
      vistoClienteAt: { type: DataTypes.DATE, allowNull: true },
      respondidoAt: { type: DataTypes.DATE, allowNull: true },
      resueltoAt: { type: DataTypes.DATE, allowNull: true },
      /** Ordena nuestra bandeja: lo que se ha movido hace menos, arriba. */
      ultimoMensajeAt: { type: DataTypes.DATE, allowNull: true },
    },
    {
      tableName: "buzon_avisos",
    }
  );
}
