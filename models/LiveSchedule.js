const mongoose = require('mongoose');

const liveScheduleSchema = new mongoose.Schema({
  title: { type: String, required: true },
  date: { type: String, required: true },
  time: { type: String, required: true },
  duration: { type: Number, default: 45 },
  category: { type: String, enum: ['quant', 'english', 'reasoning', 'banking', 'current'], required: true },
  youtubeId: { type: String },
  status: { type: String, enum: ['upcoming', 'live', 'completed'], default: 'upcoming' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('LiveSchedule', liveScheduleSchema);
