const mongoose = require('mongoose');

const lectureSchema = new mongoose.Schema({
  subjectId: { type: String, required: true, index: true },
  chapterId: { type: String, required: true, index: true },
  title: { type: String, required: true },
  date: String,
  duration: String,
  youtubeId: String,
  imageUrl: String,

  // Notes & DPP Features
  pdfLink: String,
  dppLink: String
}, { timestamps: true });

// Compound index for queries that filter by both subjectId and chapterId
lectureSchema.index({ subjectId: 1, chapterId: 1 });

// Index for sorting by order (if you add an 'order' field later)
// lectureSchema.index({ order: 1 });

module.exports = mongoose.model('Lecture', lectureSchema);
