const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret_key_change_in_production';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/learning_platform', {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
.then(() => console.log('MongoDB connected'))
.catch(err => console.error('MongoDB connection error:', err));

// User Schema
const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});

// Subject Schema
const subjectSchema = new mongoose.Schema({
    name: { type: String, required: true },
    description: { type: String, default: '' },
    icon: { type: String, default: '📚' },
    order: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
});

// Lecture Schema
const lectureSchema = new mongoose.Schema({
    subjectId: { type: mongoose.Schema.Types.ObjectId, ref: 'Subject', required: true },
    title: { type: String, required: true },
    content: { type: String, default: '' },
    videoUrl: { type: String, default: '' },
    order: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
});

// Progress Schema
const progressSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    lecture: { type: mongoose.Schema.Types.ObjectId, ref: 'Lecture', required: true },
    completed: { type: Boolean, default: false },
    lastAccessed: { type: Date, default: Date.now }
});

// Models
const User = mongoose.model('User', userSchema);
const Subject = mongoose.model('Subject', subjectSchema);
const Lecture = mongoose.model('Lecture', lectureSchema);
const Progress = mongoose.model('Progress', progressSchema);

// Authentication Middleware
const authenticate = async (req, res, next) => {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
        return res.status(401).json({ success: false, msg: 'No token, authorization denied' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findById(decoded.userId).select('-password');
        if (!user) {
            return res.status(401).json({ success: false, msg: 'User not found' });
        }
        req.user = user;
        next();
    } catch (err) {
        res.status(401).json({ success: false, msg: 'Token is not valid' });
    }
};

// ========== AUTH ROUTES ==========

// Register
app.post('/api/auth/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;

        // Check if user exists
        let user = await User.findOne({ email });
        if (user) {
            return res.status(400).json({ success: false, msg: 'User already exists' });
        }

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Create user
        user = new User({
            name,
            email,
            password: hashedPassword
        });

        await user.save();

        // Create token
        const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '7d' });

        res.json({
            success: true,
            token,
            user: {
                id: user._id,
                name: user.name,
                email: user.email
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, msg: 'Server error' });
    }
});

// Login
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // Check if user exists
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({ success: false, msg: 'Invalid credentials' });
        }

        // Check password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ success: false, msg: 'Invalid credentials' });
        }

        // Create token
        const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '7d' });

        res.json({
            success: true,
            token,
            user: {
                id: user._id,
                name: user.name,
                email: user.email
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, msg: 'Server error' });
    }
});

// Get current user
app.get('/api/auth/me', authenticate, (req, res) => {
    res.json({
        success: true,
        user: {
            id: req.user._id,
            name: req.user.name,
            email: req.user.email
        }
    });
});

// ========== SUBJECT ROUTES ==========

// Get all subjects
app.get('/api/subjects', async (req, res) => {
    try {
        const subjects = await Subject.find().sort({ order: 1 });
        res.json(subjects);
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, msg: 'Server error' });
    }
});

// Get all subjects with aggregated progress for the logged-in user
app.get('/api/subjects/progress', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;

        // 1. Fetch all subjects, sorted by order
        const subjects = await Subject.find().sort({ order: 1 }).lean();

        // 2. For each subject, count total lectures and completed lectures
        const subjectsWithProgress = await Promise.all(
            subjects.map(async (subject) => {
                // Count total lectures belonging to this subject
                const totalLectures = await Lecture.countDocuments({ subjectId: subject._id });

                // Count completed lectures for this user & subject
                const completedLectures = await Progress.countDocuments({
                    user: userId,
                    completed: true,
                    lecture: { $in: await Lecture.find({ subjectId: subject._id }).distinct('_id') }
                });

                const progressPercent = totalLectures > 0
                    ? Math.round((completedLectures / totalLectures) * 100)
                    : 0;

                return {
                    ...subject,
                    totalLectures,
                    completedLectures,
                    progressPercent
                };
            })
        );

        res.json(subjectsWithProgress);
    } catch (err) {
        console.error('Error fetching subjects with progress:', err);
        res.status(500).json({ success: false, msg: 'Failed to load subjects' });
    }
});

// Get single subject
app.get('/api/subjects/:id', async (req, res) => {
    try {
        const subject = await Subject.findById(req.params.id);
        if (!subject) {
            return res.status(404).json({ success: false, msg: 'Subject not found' });
        }
        res.json(subject);
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, msg: 'Server error' });
    }
});

// Create subject (admin only - you might want to add admin check)
app.post('/api/subjects', authenticate, async (req, res) => {
    try {
        const { name, description, icon, order } = req.body;
        
        const subject = new Subject({
            name,
            description,
            icon,
            order
        });

        await subject.save();
        res.json({ success: true, subject });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, msg: 'Server error' });
    }
});

// ========== LECTURE ROUTES ==========

// Get lectures for a subject
app.get('/api/subjects/:subjectId/lectures', async (req, res) => {
    try {
        const lectures = await Lecture.find({ subjectId: req.params.subjectId })
            .sort({ order: 1 });
        res.json(lectures);
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, msg: 'Server error' });
    }
});

// Get lectures with progress for a subject (authenticated)
app.get('/api/subjects/:subjectId/lectures/progress', authenticate, async (req, res) => {
    try {
        const lectures = await Lecture.find({ subjectId: req.params.subjectId })
            .sort({ order: 1 })
            .lean();

        // Get progress for each lecture
        const lecturesWithProgress = await Promise.all(
            lectures.map(async (lecture) => {
                const progress = await Progress.findOne({
                    user: req.user._id,
                    lecture: lecture._id
                });
                
                return {
                    ...lecture,
                    completed: progress?.completed || false
                };
            })
        );

        res.json(lecturesWithProgress);
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, msg: 'Server error' });
    }
});

// Get single lecture
app.get('/api/lectures/:id', async (req, res) => {
    try {
        const lecture = await Lecture.findById(req.params.id);
        if (!lecture) {
            return res.status(404).json({ success: false, msg: 'Lecture not found' });
        }
        res.json(lecture);
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, msg: 'Server error' });
    }
});

// Create lecture
app.post('/api/lectures', authenticate, async (req, res) => {
    try {
        const { subjectId, title, content, videoUrl, order } = req.body;
        
        const lecture = new Lecture({
            subjectId,
            title,
            content,
            videoUrl,
            order
        });

        await lecture.save();
        res.json({ success: true, lecture });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, msg: 'Server error' });
    }
});

// ========== PROGRESS ROUTES ==========

// Mark lecture as completed
app.post('/api/progress/:lectureId/complete', authenticate, async (req, res) => {
    try {
        const lectureId = req.params.lectureId;
        
        // Verify lecture exists
        const lecture = await Lecture.findById(lectureId);
        if (!lecture) {
            return res.status(404).json({ success: false, msg: 'Lecture not found' });
        }

        // Update or create progress record
        let progress = await Progress.findOne({
            user: req.user._id,
            lecture: lectureId
        });

        if (progress) {
            progress.completed = true;
            progress.lastAccessed = Date.now();
        } else {
            progress = new Progress({
                user: req.user._id,
                lecture: lectureId,
                completed: true
            });
        }

        await progress.save();
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, msg: 'Server error' });
    }
});

// Toggle lecture completion
app.post('/api/progress/:lectureId/toggle', authenticate, async (req, res) => {
    try {
        const lectureId = req.params.lectureId;
        
        // Verify lecture exists
        const lecture = await Lecture.findById(lectureId);
        if (!lecture) {
            return res.status(404).json({ success: false, msg: 'Lecture not found' });
        }

        // Find existing progress
        let progress = await Progress.findOne({
            user: req.user._id,
            lecture: lectureId
        });

        if (progress) {
            progress.completed = !progress.completed;
            progress.lastAccessed = Date.now();
        } else {
            progress = new Progress({
                user: req.user._id,
                lecture: lectureId,
                completed: true
            });
        }

        await progress.save();
        res.json({ success: true, completed: progress.completed });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, msg: 'Server error' });
    }
});

// Get overall progress for dashboard
app.get('/api/progress/overall', authenticate, async (req, res) => {
    try {
        const totalLectures = await Lecture.countDocuments();
        const completedLectures = await Progress.countDocuments({
            user: req.user._id,
            completed: true
        });

        const subjects = await Subject.find().sort({ order: 1 }).lean();
        const subjectProgress = await Promise.all(
            subjects.map(async (subject) => {
                const total = await Lecture.countDocuments({ subjectId: subject._id });
                const completed = await Progress.countDocuments({
                    user: req.user._id,
                    completed: true,
                    lecture: { $in: await Lecture.find({ subjectId: subject._id }).distinct('_id') }
                });

                return {
                    subject: subject.name,
                    total,
                    completed,
                    percentage: total > 0 ? Math.round((completed / total) * 100) : 0
                };
            })
        );

        res.json({
            totalLectures,
            completedLectures,
            overallPercentage: totalLectures > 0 
                ? Math.round((completedLectures / totalLectures) * 100) 
                : 0,
            subjectProgress
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, msg: 'Server error' });
    }
});

// Serve HTML pages
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'register.html'));
});

app.get('/subjects', (req, res) => {
    res.sendFile(path.join(__dirname, 'subjects.html'));
});

app.get('/lecture', (req, res) => {
    res.sendFile(path.join(__dirname, 'lecture.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
