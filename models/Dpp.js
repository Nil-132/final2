const mongoose = require('mongoose');

const QuestionSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true
  },
  type: {
    type: String,
    default: 'multiple-choice',
    enum: ['multiple-choice', 'single-choice', 'text']
  },
  questionText: {
    type: String,
    required: true
  },
  options: [{
    type: String
  }],
  correctAnswer: {
    type: Number, // index of correct option (0-based)
    required: true
  },
  explanation: {
    type: String,
    default: ''
  }
}, { _id: false });

const DppSchema = new mongoose.Schema({
  lectureId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  lectureName: {
    type: String,
    required: true
  },
  subject: {
    type: String,
    default: 'General'
  },
  questions: [QuestionSchema]
}, { timestamps: true });

module.exports = mongoose.model('Dpp', DppSchema);
