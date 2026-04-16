import { DataTypes } from "sequelize";

export function defineQuizAttempt(sequelize) {
  return sequelize.define(
    "QuizAttempt",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      // ID del intento en TutorLMS (WordPress)
      wpAttemptId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        unique: true,
      },
      wpQuizId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      wpCourseId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      wpUserId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      studentName: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      studentEmail: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      quizTitle: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      courseTitle: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      // Campo libre para agrupar por empresa/centro si procede
      empresa: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      attemptDate: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      totalQuestions: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      totalPoints: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
      },
      earnedPoints: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
      },
      passingPoints: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
      },
      correctAnswers: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      incorrectAnswers: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      // Tiempo en segundos
      quizTime: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      attemptTime: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      result: {
        type: DataTypes.ENUM("pass", "fail"),
        allowNull: true,
      },
      // Array JSONB con el detalle pregunta a pregunta
      answers: {
        type: DataTypes.JSONB,
        defaultValue: [],
      },
    },
    {
      tableName: "quiz_attempts",
    }
  );
}
