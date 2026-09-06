import { DataTypes } from "sequelize";

/**
 * MailingSequence — un correo que sale SOLO cuando pasa algo en el CRM
 * (sprint 2 del módulo, 06/09/2026): la bienvenida al alta, el cumpleaños,
 * «hace seis meses de tu última cita». Es donde el mailing gana a cualquier
 * herramienta genérica: la herramienta no sabe cuándo fue la última cita; el
 * CRM sí.
 *
 * `evento` (lib/mailing/secuencias.js, catálogo cerrado):
 *   alta        fichas creadas hace `dias` días (0 = el mismo día)
 *   cumpleanos  fichas cuyo `birth_date` cumple hoy (`dias` no se usa)
 *   sin_cita    fichas cuya última cita pasada (no cancelada ni falta) fue
 *               hace `dias` días
 *
 * `activada_desde` es la fecha en que se encendió por última vez: una
 * secuencia recién encendida NO barre todo el histórico (la bienvenida no
 * llega a las 1.083 familias de siempre), solo a lo que pasa a partir de ahí.
 * `hora` es la hora de Madrid a partir de la cual sale ese día.
 *
 * El contenido (asunto, preheader, bloques) tiene el mismo formato que una
 * campaña. Cada pasada del temporizador copia ese contenido a la campaña
 * AUTOMÁTICA del periodo (`mailing_campaigns.sequence_id` + `periodo`), que es
 * el contenedor de sus envíos: así las métricas, los clics y las bajas de una
 * secuencia son las mismas piezas que las de una campaña normal.
 *
 * Quién la recibe: la misma audiencia que todo el módulo —fichas con la
 * casilla de novedades y sin supresión— cruzada con el evento. Los correos
 * sueltos no tienen ficha ni citas: no entran en las secuencias.
 */
export function defineMailingSequence(sequelize) {
  return sequelize.define(
    "MailingSequence",
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      nombre: { type: DataTypes.STRING(160), allowNull: false },
      evento: { type: DataTypes.STRING(30), allowNull: false },
      activa: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      activadaDesde: { type: DataTypes.DATE, allowNull: true },
      dias: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      hora: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 10 },
      asunto: { type: DataTypes.STRING(200), allowNull: true },
      preheader: { type: DataTypes.STRING(200), allowNull: true },
      bloques: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      replyTo: { type: DataTypes.STRING(255), allowNull: true },
      createdBy: { type: DataTypes.STRING(255), allowNull: true },
    },
    {
      tableName: "mailing_sequences",
      indexes: [{ fields: ["activa", "evento"], name: "mailing_sequences_activa_idx" }],
    }
  );
}
