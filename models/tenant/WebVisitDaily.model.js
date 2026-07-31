import { DataTypes } from "sequelize";

/**
 * WebVisitDaily — la foto diaria de las visitas de la web, guardada por
 * nosotros.
 *
 * POR QUÉ EXISTE: Cloudflare Web Analytics solo conserva **los últimos 7 días**
 * (medido en producción el 2026-07-31; ver `MAX_DIAS_RUM` en
 * lib/analytics/cloudflareRum.js). Pasada esa ventana el dato desaparece para
 * siempre: no hay forma de pedirle a Cloudflare el mes pasado. Si el CRM quiere
 * enseñar meses, trimestres o años, tiene que ir copiando cada día lo que
 * Cloudflare da, mientras lo da.
 *
 * Consecuencia que hay que tener presente al leer estas tablas: **el histórico
 * empieza el día que se enciende la captura**, no antes. Lo anterior no se
 * puede recuperar.
 *
 * ── Forma de la tabla ──────────────────────────────────────────────────────
 *
 * Una fila por (fecha, dimensión, valor). En vez de una fila por día con los
 * desgloses metidos en JSON, se guarda desnormalizado por dimensión para que
 * los rangos largos se resuelvan con un GROUP BY normal y corriente:
 *
 *   fecha        dimension    valor              visitas  vistas
 *   2026-07-31   total        ''                 5        5
 *   2026-07-31   pais         GB                 3        3
 *   2026-07-31   pais         ES                 1        1
 *   2026-07-31   pagina       /leather-line      2        2
 *   2026-07-31   referrer     google.com         1        1
 *
 * `valor` es cadena vacía —no NULL— en la dimensión `total`: en PostgreSQL dos
 * NULL no chocan en un índice único, así que un `valor` nulo permitiría filas
 * duplicadas para el mismo día y rompería la idempotencia de la captura.
 *
 * La captura (scripts/capturar-visitas-web.js) reescribe los últimos días en
 * cada pasada, así que volver a lanzarla corrige huecos y no duplica.
 */
export function defineWebVisitDaily(sequelize) {
  return sequelize.define(
    "WebVisitDaily",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      fecha: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },
      // Qué corte representa la fila. `total` es el agregado del día.
      dimension: {
        type: DataTypes.STRING(20),
        allowNull: false,
        validate: {
          isIn: [["total", "pais", "pagina", "referrer", "dispositivo", "navegador"]],
        },
      },
      // Código de país (ISO-2), ruta, host del referrer… Cadena vacía en `total`.
      valor: {
        type: DataTypes.STRING(255),
        allowNull: false,
        defaultValue: "",
      },
      // Sesiones.
      visitas: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      // Páginas vistas (un evento de carga por página).
      vistas: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
    },
    {
      tableName: "web_visits_daily",
      indexes: [
        // Lo que hace idempotente a la captura.
        { unique: true, fields: ["fecha", "dimension", "valor"], name: "web_visits_daily_unique" },
        // El acceso normal: "dame los países del último trimestre".
        { fields: ["dimension", "fecha"] },
      ],
    }
  );
}
