const mongoose = require('mongoose');

const progressSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    lecture: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Lecture',
        required: true
    },
    completed: {
        type: Boolean,
        default: false
    },
    completedAt: {
        type: Date,
        default: Date.now
    }
}, { timestamps: true });

// Prevent duplicate progress entries for same user + lecture
progressSchema.index({ user: 1, lecture: 1 }, { unique: true });

// Index for quickly counting completed lectures per user
progressSchema.index({ user: 1, completed: 1 });

const Progress = mongoose.model('Progress', progressSchema);
module.exports = Progress;
