const mongoose = require('mongoose');

const motivationalMessageSchema = new mongoose.Schema({
  week: { type: Number, required: true },
  day: { type: Number, required: true },
  message: { type: String, required: true }
});

module.exports = mongoose.model('MotivationalMessage', motivationalMessageSchema);
