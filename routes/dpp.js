const express = require('express');
const router = express.Router();
const Dpp = require('../models/Dpp');
const DppResult = require('../models/DppResult');
const { ensureAuthenticated } = require('../config/auth'); // Adjust path to your auth middleware

// @desc    Get list of all lectures that have a DPP
// @route   GET /api/dpp/lectures
router.get('/lectures', async (req, res) => {
  try {
    const dpps = await Dpp.find({}, 'lectureId lectureName subject');
    res.json(dpps);
  } catch (error) {
    console.error('Error fetching DPP lectures:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// @desc    Get a specific DPP by lectureId
// @route   GET /api/dpp/:lectureId
router.get('/:lectureId', async (req, res) => {
  try {
    const dpp = await Dpp.findOne({ lectureId: req.params.lectureId });
    if (!dpp) {
      return res.status(404).json({ error: 'DPP not found' });
    }
    res.json(dpp);
  } catch (error) {
    console.error('Error fetching DPP:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// @desc    Upload/update a DPP via JSON (used by management UI)
// @route   POST /api/dpp/upload
router.post('/upload', async (req, res) => {
  try {
    const dppData = req.body;
    
    // Basic validation
    if (!dppData.lectureId || !dppData.lectureName || !Array.isArray(dppData.questions)) {
      return res.status(400).json({ error: 'Invalid DPP format' });
    }

    // Use upsert to create or update
    const dpp = await Dpp.findOneAndUpdate(
      { lectureId: dppData.lectureId },
      dppData,
      { upsert: true, new: true, runValidators: true }
    );
    res.json({ success: true, dpp });
  } catch (error) {
    console.error('Error uploading DPP:', error);
    res.status(400).json({ error: 'Invalid JSON format or database error' });
  }
});

// @desc    Update a DPP via form data (used by question editor)
// @route   PUT /api/dpp/:lectureId
router.put('/:lectureId', async (req, res) => {
  try {
    const updatedDpp = await Dpp.findOneAndUpdate(
      { lectureId: req.params.lectureId },
      req.body,
      { new: true, runValidators: true }
    );
    if (!updatedDpp) {
      return res.status(404).json({ error: 'DPP not found' });
    }
    res.json({ success: true, dpp: updatedDpp });
  } catch (error) {
    console.error('Error updating DPP:', error);
    res.status(400).json({ error: error.message });
  }
});

// @desc    Submit DPP answers and calculate score
// @route   POST /api/dpp/submit
// @access  Private (requires authentication)
router.post('/submit', ensureAuthenticated, async (req, res) => {
  try {
    const { lectureId, lectureName, answers } = req.body;
    const userId = req.user._id; // Assuming Passport sets req.user

    // Fetch the DPP to get correct answers
    const dpp = await Dpp.findOne({ lectureId });
    if (!dpp) {
      return res.status(404).json({ error: 'DPP not found' });
    }

    let correctCount = 0;
    const processedAnswers = answers.map(ans => {
      const question = dpp.questions.find(q => q.id === ans.questionId);
      const isCorrect = question && ans.selectedOption === question.correctAnswer;
      if (isCorrect) correctCount++;
      return {
        questionId: ans.questionId,
        selectedOption: ans.selectedOption !== undefined ? ans.selectedOption : -1,
        isCorrect,
        timeSpent: ans.timeSpent || 0
      };
    });

    const totalQuestions = dpp.questions.length;
    const score = totalQuestions > 0 ? (correctCount / totalQuestions) * 100 : 0;

    const result = new DppResult({
      userId,
      lectureId,
      lectureName: lectureName || dpp.lectureName,
      totalQuestions,
      correctAnswers: correctCount,
      score,
      answers: processedAnswers,
      submittedAt: new Date()
    });
    await result.save();

    res.json({
      success: true,
      result: {
        id: result._id,
        score,
        correctCount,
        totalQuestions
      }
    });
  } catch (error) {
    console.error('Error submitting DPP:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// @desc    Get user's DPP history (all attempts)
// @route   GET /api/dpp/results/:userId?
// @access  Private (returns own results if no userId, or admin)
router.get('/results/:userId?', ensureAuthenticated, async (req, res) => {
  try {
    const targetUserId = req.params.userId || req.user._id;
    // Optional: add admin check to allow viewing others' results
    
    const results = await DppResult.find({ userId: targetUserId })
      .sort({ submittedAt: -1 })
      .select('lectureId lectureName score correctAnswers totalQuestions submittedAt');
    res.json(results);
  } catch (error) {
    console.error('Error fetching results:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// @desc    Get analytics for a specific lecture across attempts
// @route   GET /api/dpp/analytics/:lectureId
// @access  Private
router.get('/analytics/:lectureId', ensureAuthenticated, async (req, res) => {
  try {
    const userId = req.user._id;
    const { lectureId } = req.params;

    const results = await DppResult.find({ userId, lectureId })
      .sort({ submittedAt: 1 })
      .select('score correctAnswers totalQuestions submittedAt');

    const dpp = await Dpp.findOne({ lectureId }).select('lectureName');

    res.json({
      attempts: results,
      lectureName: dpp?.lectureName || lectureId,
      totalAttempts: results.length
    });
  } catch (error) {
    console.error('Error fetching analytics:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
