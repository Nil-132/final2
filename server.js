require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const path = require('path');
const { body, validationResult } = require('express-validator');

const app = express();
const PORT = process.env.PORT || 3000;

// Models
const User = require('./models/User');
const Subject = require('./models/Subject');
const Lecture = require('./models/Lecture');
const Dpp = require('./models/Dpp');
const DppResult = require('./models/DppResult');
const Otp = require('./models/Otp'); // New OTP model

// Middleware
app.use(express.json());
app.use(cookieParser());
app.use(cors({
    origin: process.env.BASE_URL || 'http://localhost:3000',
    credentials: true
}));
app.use(express.static('public'));
app.set('view engine', 'ejs');

// Nodemailer setup
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// ========== AUTH MIDDLEWARE ==========
const authenticate = (req, res, next) => {
    const token = req.cookies.token;
    if (!token) {
        return res.status(401).json({ success: false, msg: "Please login" });
    }
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        // ✅ Attach full user object including id
        req.user = {
            id: decoded.id,
            role: decoded.role,
            name: decoded.name
        };
        next();
    } catch (err) {
        res.status(401).json({ success: false, msg: "Session expired" });
    }
};

const isAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ success: false, msg: "Admin access required" });
    }
    next();
};

// ========== PUBLIC ROUTES (No Auth) ==========
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Send OTP
app.post('/api/send-otp', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ success: false, msg: 'Email required' });

        const otp = Math.floor(100000 + Math.random() * 900000).toString();

        // Upsert: if an OTP already exists for this email, replace it
        await Otp.findOneAndUpdate(
            { email },
            { otp, expiresAt: new Date(Date.now() + 10 * 60 * 1000) },
            { upsert: true, new: true }
        );

        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'Your OTP for My PW Registration',
            text: `Your OTP is: ${otp}. It expires in 10 minutes.`
        };

        await transporter.sendMail(mailOptions);
        res.json({ success: true, msg: 'OTP sent successfully' });
    } catch (error) {
        console.error('Send OTP error:', error);
        res.status(500).json({ success: false, msg: 'Failed to send OTP' });
    }
});

// Verify OTP
app.post('/api/verify-otp', async (req, res) => {
    try {
        const { email, otp } = req.body;
        if (!email || !otp) return res.status(400).json({ success: false, msg: 'Email and OTP required' });

        const record = await Otp.findOne({ email });
        if (!record) return res.status(400).json({ success: false, msg: 'Invalid or expired OTP' });

        if (record.otp !== otp) {
            return res.status(400).json({ success: false, msg: 'Invalid OTP' });
        }

        // OTP is valid – delete it so it can't be reused
        await Otp.deleteOne({ email });
        res.json({ success: true, msg: 'OTP verified' });
    } catch (error) {
        console.error('Verify OTP error:', error);
        res.status(500).json({ success: false, msg: 'Verification failed' });
    }
});

// Signup (with validation)
app.post('/api/signup', [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
    }

    try {
        const { name, email, password } = req.body;

        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ success: false, msg: 'Email already registered' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const user = await User.create({
            name,
            email,
            password: hashedPassword,
            isVerified: true // You may change to false and require email verification
        });

        const token = jwt.sign(
            { id: user._id, role: user.role, name: user.name },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            maxAge: 7 * 24 * 60 * 60 * 1000
        });

        res.json({ success: true, msg: 'Account created', user: { id: user._id, name, email, role: user.role } });
    } catch (error) {
        console.error('Signup error:', error);
        res.status(500).json({ success: false, msg: 'Server error' });
    }
});

// Login
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({ success: false, msg: 'Invalid credentials' });
        }

        const validPass = await bcrypt.compare(password, user.password);
        if (!validPass) {
            return res.status(400).json({ success: false, msg: 'Invalid credentials' });
        }

        const token = jwt.sign(
            { id: user._id, role: user.role, name: user.name },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            maxAge: 7 * 24 * 60 * 60 * 1000
        });

        res.json({ success: true, msg: 'Logged in', user: { id: user._id, name: user.name, email: user.email, role: user.role } });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, msg: 'Server error' });
    }
});

// Logout
app.post('/api/logout', (req, res) => {
    res.clearCookie('token');
    res.json({ success: true, msg: 'Logged out' });
});

// ========== PROTECTED USER ROUTES ==========
app.get('/api/me', authenticate, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('-password');
        res.json({ success: true, user });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, msg: 'Server error' });
    }
});

app.get('/api/subjects', authenticate, async (req, res) => {
    try {
        const subjects = await Subject.find();
        res.json({ success: true, subjects });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, msg: 'Server error' });
    }
});

app.get('/api/lectures/:subjectId', authenticate, async (req, res) => {
    try {
        const lectures = await Lecture.find({ subject: req.params.subjectId });
        res.json({ success: true, lectures });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, msg: 'Server error' });
    }
});

app.get('/api/dpp/:lectureId', authenticate, async (req, res) => {
    try {
        const dpp = await Dpp.findOne({ lecture: req.params.lectureId });
        res.json({ success: true, dpp });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, msg: 'Server error' });
    }
});

app.post('/api/dpp/submit', authenticate, async (req, res) => {
    try {
        const { dppId, answers } = req.body;
        const dpp = await Dpp.findById(dppId);
        if (!dpp) return res.status(404).json({ success: false, msg: 'DPP not found' });

        let score = 0;
        const total = dpp.questions.length;
        dpp.questions.forEach((q, idx) => {
            if (answers[idx] === q.correctAnswer) score++;
        });

        const result = await DppResult.create({
            user: req.user.id,
            dpp: dppId,
            answers,
            score,
            total
        });

        res.json({ success: true, result: { score, total } });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, msg: 'Server error' });
    }
});

// Progress page (EJS)
app.get('/progress', authenticate, async (req, res) => {
    try {
        const results = await DppResult.find({ user: req.user.id })
            .populate({ path: 'dpp', populate: { path: 'lecture', populate: 'subject' } })
            .sort({ createdAt: -1 });
        res.render('progress', { user: req.user, results });
    } catch (error) {
        console.error(error);
        res.status(500).send('Error loading progress');
    }
});

// ========== ADMIN ROUTES ==========
app.get('/api/admin/users', authenticate, isAdmin, async (req, res) => {
    try {
        const users = await User.find().select('-password');
        res.json({ success: true, users });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, msg: 'Server error' });
    }
});

app.post('/api/admin/lectures', authenticate, isAdmin, async (req, res) => {
    try {
        const { title, subject, videoUrl } = req.body;
        const lecture = await Lecture.create({ title, subject, videoUrl });
        res.json({ success: true, lecture });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, msg: 'Server error' });
    }
});

app.post('/api/admin/dpp', authenticate, isAdmin, async (req, res) => {
    try {
        const { lecture, questions } = req.body;
        const dpp = await Dpp.create({ lecture, questions });
        res.json({ success: true, dpp });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, msg: 'Server error' });
    }
});

// ========== SEEDING ==========
async function seedAdmin() {
    try {
        const existingAdmin = await User.findOne({ role: 'admin' });
        if (!existingAdmin) {
            const hashedPassword = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10);
            await User.create({
                name: 'Admin',
                email: process.env.ADMIN_EMAIL,
                password: hashedPassword,
                role: 'admin',
                isVerified: true
            });
            console.log('✅ Admin user seeded');
        } else {
            console.log('ℹ️ Admin already exists');
        }
    } catch (error) {
        console.error('⚠️ Admin seeding error:', error.message);
    }
}

async function seedSubjects() {
    try {
        const count = await Subject.countDocuments();
        if (count === 0) {
            const defaultSubjects = [
                { name: 'Physics', icon: '⚛️' },
                { name: 'Chemistry', icon: '🧪' },
                { name: 'Mathematics', icon: '📐' }
            ];
            await Subject.insertMany(defaultSubjects);
            console.log('✅ Default subjects seeded');
        } else {
            console.log('ℹ️ Subjects already exist');
        }
    } catch (error) {
        console.error('⚠️ Subject seeding error:', error.message);
    }
}

// ========== SERVER START ==========
const startServer = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ MongoDB connected');

        await Promise.allSettled([seedAdmin(), seedSubjects()]);

        app.listen(PORT, () => {
            console.log(`🚀 Server running on port ${PORT}`);
        });
    } catch (err) {
        console.error('❌ Failed to start server:', err);
        process.exit(1);
    }
};

startServer();
