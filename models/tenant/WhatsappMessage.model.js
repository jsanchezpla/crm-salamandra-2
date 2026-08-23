import { DataTypes } from "sequelize";

/**
 * WhatsappMessage — el hilo de WhatsApp de cada cliente, dentro del CRM.
 *
 * Existe porque **la Cloud API no guarda conversaciones**. No hay bandeja al
 * otro lado: Meta empuja cada mensaje al webhook en el momento y se olvida. Lo
 * que no guardemos aquí no está en ningún sitio.
 *
 * Recoge las cuatro cosas que llegan por el webhook:
 *   · lo que escribe el paciente                        (direction "in")
 *   · lo que manda el CRM automáticamente               (direction "out", origin "api")
 *   · lo que escribe el cliente DESDE SU MÓVIL          (direction "out", origin "app")
 *   · los 180 días de historial de la coexistencia      (origin "history")
 *
 * Ese tercer caso es la coexistencia: el número sigue vivo en la app de
 * WhatsApp Business del cliente y Meta nos hace eco de lo que manda desde ahí.
 * Por eso `origin` no es cosmético — distingue lo que hemos hecho nosotros de
 * lo que ha hecho una persona, y sin él no se puede saber si un recordatorio
 * salió del CRM o lo escribió el propio cliente a mano.
 *
 * ── `wamId` ES UNIQUE, Y ESO ES LA IDEMPOTENCIA ──────────────────────────────
 * Meta garantiza entrega "al menos una vez" y reintenta lo que no reciba un
 * 200. El identificador de mensaje (`wamid.…`) es el ancla: el segundo intento
 * de insertar el mismo revienta contra el índice y el webhook lo trata como ya
 * visto. Se apoya en la base de datos y no en un `if` previo porque dos
 * reintentos simultáneos pasarían los dos esa comprobación (mismo razonamiento
 * que `StripeWebhookEvent`).
 *
 * ── `clientId` PUEDE SER NULL, A PROPÓSITO ───────────────────────────────────
 * El mensaje se guarda ENCUENTRE O NO a quién pertenece. Un WhatsApp de alguien
 * que no está en la ficha —un familiar, un número nuevo, alguien que aún no es
 * paciente— sigue siendo un mensaje que hay que leer. Descartarlo por no saber
 * de quién es sería el mismo fallo que este modelo viene a arreglar.
 */
export function defineWhatsappMessage(sequelize) {
  return sequelize.define(
    "WhatsappMessage",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      // Identificador de Meta (`wamid.HBgLMzQ2…`). El ancla de todo.
      wamId: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
      },
      // "in" (lo recibimos) | "out" (salió del número del cliente)
      direction: {
        type: DataTypes.STRING(8),
        allowNull: false,
      },
      // "api" (lo mandó el CRM) | "app" (lo mandó la persona desde su móvil)
      // | "history" (sincronización inicial de la coexistencia)
      origin: {
        type: DataTypes.STRING(16),
        allowNull: false,
        defaultValue: "api",
      },
      // El teléfono del OTRO lado, siempre en dígitos y con prefijo de país
      // (34689628353), que es como lo manda Meta en `wa_id`.
      phone: {
        type: DataTypes.STRING(32),
        allowNull: false,
      },
      // Ficha a la que pertenece. Nullable: ver la cabecera.
      clientId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      // text, image, audio, document, template, interactive…
      type: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: "text",
      },
      // El texto. En los mensajes con adjunto queda el pie de foto o una
      // descripción: los ficheros NO se descargan aquí (habría que pedírselos a
      // Meta con el token del cliente y guardarlos en disco, y eso es otro
      // trabajo). `raw` conserva el id del medio para poder ir a por él.
      body: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      // sent | delivered | read | failed. Null en los entrantes: un mensaje que
      // nos llega no tiene estado de entrega, ya está aquí.
      status: {
        type: DataTypes.STRING(16),
        allowNull: true,
      },
      // Por qué falló, en las palabras de Meta. Es lo que hay que poder enseñar
      // cuando alguien pregunte por qué no le llegó el recordatorio.
      errorMessage: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      // La marca de tiempo de META, no la nuestra. En el historial de la
      // coexistencia son mensajes de hace meses: ordenarlos por `created_at`
      // los pondría todos hoy y el hilo saldría del revés.
      sentAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      // El trozo de payload original. Para depurar sin volver a Meta y para
      // recuperar lo que hoy no interpretamos (ids de medios, botones,
      // respuestas a plantillas).
      raw: {
        type: DataTypes.JSONB,
        allowNull: true,
      },
    },
    {
      tableName: "whatsapp_messages",
      indexes: [
        { fields: ["phone"] },
        { fields: ["client_id"] },
        { fields: ["sent_at"] },
      ],
    }
  );
}
