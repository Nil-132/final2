// routes/dpp.js
const express = require('express');
const router = express.Router();
const Dpp = require('../models/Dpp');
const DppResult = require('../models/DppResult');
const Lecture = require('../models/Lecture'); // NEW: Import Lecture model
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-change-me';

// JWT Authentication Middleware (same as in server.js)
const authenticate = (req, res, next) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Please log in' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired session' });
  }
};

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
    if (!dpp) return res.status(404).json({ error: 'DPP not found' });
    res.json(dpp);
  } catch (error) {
    console.error('Error fetching DPP:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// @desc    Upload/update a DPP via JSON (with auto lectureId lookup)
// @route   POST /api/dpp/upload
router.post('/upload', async (req, res) => {
  try {
    const dppData = req.body;

    // Validate required fields
    if (!dppData.lectureName || !Array.isArray(dppData.questions)) {
      return res.status(400).json({ error: 'lectureName and questions array are required' });
    }

    // If lectureId is not provided, try to find it by lectureName
    if (!dppData.lectureId) {
      // Search for a lecture with matching name (case-insensitive)
      const lecture = await Lecture.findOne({ 
        title: { $regex: new RegExp('^' + dppData.lectureName + '$', 'i') } 
      });

      if (!lecture) {
        return res.status(400).json({ 
          error: `No lecture found with name "${dppData.lectureName}". Please create the lecture first or provide a lectureId.` 
        });
      }

      dppData.lectureId = lecture._id.toString();
      console.log(`Auto-mapped lectureName "${dppData.lectureName}" to ID ${dppData.lectureId}`);
    }

    // Optional: verify the lectureId actually exists in Lecture collection
    const lectureExists = await Lecture.findById(dppData.lectureId);
    if (!lectureExists) {
      return res.status(400).json({ error: `Lecture with ID ${dppData.lectureId} not found` });
    }

    // Use the lecture's title if lectureName wasn't provided or to keep consistent
    if (!dppData.lectureName) {
      dppData.lectureName = lectureExists.title;
    }

    // Upsert DPP
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
    if (!updatedDpp) return res.status(404).json({ error: 'DPP not found' });
    res.json({ success: true, dpp: updatedDpp });
  } catch (error) {
    console.error('Error updating DPP:', error);
    res.status(400).json({ error: error.message });
  }
});

// @desc    Submit DPP answers and calculate score
// @route   POST /api/dpp/submit
// @access  Private (requires authentication)
router.post('/submit', authenticate, async (req, res) => {
  try {
    const { lectureId, lectureName, answers } = req.body;
    const userId = req.user.id;

    const dpp = await Dpp.findOne({ lectureId });
    if (!dpp) return res.status(404).json({ error: 'DPP not found' });

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
// @access  Private (returns own results if no userId)
router.get('/results/:userId?', authenticate, async (req, res) => {
  try {
    const targetUserId = req.params.userId || req.user.id;
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
router.get('/analytics/:lectureId', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
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
