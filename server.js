// server.js - FINAL HIGH-SECURITY VERSION (All features + Maximum Security)
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

// ====================== HIGH SECURITY SETUP ======================
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://cdn.tailwindcss.com"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
    },
  },
  crossOriginResourcePolicy: { policy: "cross-origin" },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true }
}));

// CORS - Only your domains (Render + localhost)
app.use(cors({
  origin: [
    'http://localhost:3000',
    'https://final-djbd.onrender.com',
    'https://final-1-2h61.onrender.com',
    process.env.FRONTEND_URL
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '10kb' })); // Prevent large attacks
app.use(express.static('public'));
app.use(cookieParser());

// Rate limiting
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  message: { success: false, msg: "Too many requests. Try again later." }
});

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});

app.use('/api/send-otp', authLimiter);
app.use('/api/signup', authLimiter);
app.use('/api/login', authLimiter);
app.use('/api/forgot-password', authLimiter);
app.use('/api/', generalLimiter);

// MongoDB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB Connected Successfully'))
  .catch(err => console.error('❌ MongoDB Error:', err));

const User = require('./models/User');
const Lecture = require('./models/Lecture');
const Chapter = require('./models/Chapter');
const Progress = require('./models/Progress');
const LiveSchedule = require('./models/LiveSchedule');
const Subject = require('./models/Subject');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("❌ JWT_SECRET is missing in .env file");

// Nodemailer
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

const otpStore = new Map();

// ====================== MIDDLEWARE ======================
const authenticate = (req, res, next) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ success: false, msg: "Please login" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    res.status(401).json({ success: false, msg: "Session expired" });
  }
};

const isAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') return res.status(403).json({ success: false, msg: "Admin access only" });
  next();
};

// ====================== SEEDING (Always runs) ======================
const seedAdmin = async () => {
  try {
    const adminEmail = "niles25521@gmail.com";
    const adminPassword = "nilesh2003";
    const existingAdmin = await User.findOne({ email: adminEmail });
    if (!existingAdmin) {
      await User.create({
        name: "Nilesh Admin",
        email: adminEmail,
        password: adminPassword,
        role: "admin"
      });
      console.log(`✅ Admin account created: ${adminEmail}`);
    } else {
      console.log(`✅ Admin already exists`);
    }
  } catch (e) {
    console.error("Admin seed error:", e.message);
  }
};

const seedSubjects = async () => {
  try {
    const defaultSubjects = [
      { name: "Quantitative Aptitude", icon: "📊", color: "blue", order: 1 },
      { name: "Reasoning Ability", icon: "🧠", color: "purple", order: 2 },
      { name: "English Language", icon: "📖", color: "pink", order: 3 },
      { name: "Banking Awareness", icon: "🏦", color: "emerald", order: 4 },
      { name: "Current Affairs", icon: "📰", color: "orange", order: 5 }
    ];

    for (let sub of defaultSubjects) {
      const exists = await Subject.findOne({ name: sub.name });
      if (!exists) {
        await Subject.create(sub);
        console.log(`✅ Added default subject: ${sub.name}`);
      }
    }
    console.log("✅ All 5 default subjects are now in the database");
  } catch (e) {
    console.error("Subject seed error:", e.message);
  }
};

mongoose.connection.once('open', async () => {
  await seedAdmin();
  await seedSubjects();
});

// ====================== ROUTES (All your features kept) ======================

// Live Today
app.get('/api/live/today', authenticate, async (req, res) => {
  try {
    const { date } = req.query;
    const today = date || new Date().toISOString().split('T')[0];
    const lives = await LiveSchedule.find({ date: today });
    res.json(lives);
  } catch (err) {
    res.status(500).json([]);
  }
});

// Get single lecture
app.get('/api/lectures/:id', authenticate, async (req, res) => {
  try {
    const lecture = await Lecture.findById(req.params.id);
    if (!lecture) return res.status(404).json({ success: false, msg: "Lecture not found" });
    res.json(lecture);
  } catch (err) {
    res.status(500).json({ success: false, msg: "Failed to fetch lecture" });
  }
});

// Send OTP
app.post('/api/send-otp', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.json({ success: false, msg: "Email required" });
  if (await User.findOne({ email })) return res.json({ success: false, msg: "Email already registered" });

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  otpStore.set(email, { otp, expires: Date.now() + 10 * 60 * 1000 });

  await transporter.sendMail({
    from: `"My PW - Online Classes" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "Your Signup OTP - My PW",
    html: `
    <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; background: #f8fafc; border-radius: 12px;">
    <h2 style="color: #1e40af; text-align: center;">My PW</h2>
    <p style="text-align: center; color: #374151; font-size: 16px;">Your One-Time Password for Signup</p>
    <div style="background: white; padding: 20px; border-radius: 10px; text-align: center; margin: 20px 0; border: 2px solid #bfdbfe;">
    <p style="margin: 0 0 8px 0; color: #6b7280; font-size: 14px;">Your OTP is</p>
    <h1 style="font-size: 42px; letter-spacing: 8px; font-weight: bold; color: #1e40af; margin: 0;">${otp}</h1>
    </div>
    <p style="text-align: center; color: #6b7280; font-size: 14px;">
    This code is valid for <strong>10 minutes</strong>.<br>
    Do not share this OTP with anyone.
    </p>
    <p style="text-align: center; color: #9ca3af; font-size: 13px; margin-top: 25px;">
    If you didn't request this, please ignore this email.
    </p>
    </div>`
  });

  res.json({ success: true, msg: "OTP sent successfully to your email" });
});

// Signup
app.post('/api/signup', async (req, res) => {
  const { name, email, password, otp } = req.body;
  const stored = otpStore.get(email);
  if (!stored || stored.otp !== otp || stored.expires < Date.now()) {
    return res.json({ success: false, msg: "Invalid or expired OTP" });
  }
  try {
    await User.create({ name, email, password, role: "student" });
    otpStore.delete(email);
    res.json({ success: true, msg: "Account created! You can now login." });
  } catch (err) {
    res.status(500).json({ success: false, msg: "Registration failed" });
  }
});

// Login with secure cookie
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user || !(await user.comparePassword(password))) {
      return res.json({ success: false, msg: "Invalid email or password" });
    }
    const token = jwt.sign({ id: user._id, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: '24h' });
    
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000
    });
    
    res.json({ success: true, msg: "Login successful", user: { name: user.name, role: user.role } });
  } catch (err) {
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

// Forgot Password
app.post('/api/forgot-password', async (req, res) => {
  const { email } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) return res.json({ success: false, msg: "No account found with this email" });

    const resetToken = crypto.randomBytes(32).toString('hex');
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = Date.now() + 3600000;
    await user.save();

    const resetLink = `https://final-djbd.onrender.com/reset-password.html?token=${resetToken}`;

    await transporter.sendMail({
      from: `"My PW" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Reset Your My PW Password",
      html: `
      <h2>Reset Your Password</h2>
      <p>Click the button below to reset your password:</p>
      <a href="${resetLink}" style="display:inline-block; padding:12px 24px; background:#3b82f6; color:white; text-decoration:none; border-radius:8px; font-weight:600;">
      Reset Password
      </a>
      <p style="margin-top:20px; color:#666;">This link expires in 1 hour.</p>`
    });

    res.json({ success: true, msg: "Reset link sent to your email. Check your inbox." });
  } catch (err) {
    res.status(500).json({ success: false, msg: "Failed to send reset email" });
  }
});

// Reset Password
app.post('/api/reset-password', async (req, res) => {
  const { token, newPassword } = req.body;
  try {
    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() }
    });
    if (!user) return res.json({ success: false, msg: "Invalid or expired reset link" });

    user.password = newPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();
    res.json({ success: true, msg: "Password reset successful!" });
  } catch (err) {
    res.status(500).json({ success: false, msg: "Failed to reset password" });
  }
});

// Logout
app.post('/api/logout', (req, res) => {
  res.clearCookie('token', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' });
  res.json({ success: true });
});

app.get('/api/me', authenticate, (req, res) => {
  res.json({ success: true, user: { name: req.user.name, role: req.user.role } });
});

// Chapters
app.get('/api/chapters', async (req, res) => {
  try {
    const { subjectId } = req.query;
    const filter = subjectId ? { subjectId } : {};
    const chapters = await Chapter.find(filter).sort({ order: 1 });
    res.json(chapters);
  } catch (err) {
    res.status(500).json([]);
  }
});

// Lectures with progress
app.get('/api/lectures', authenticate, async (req, res) => {
  try {
    const { chapterId, subjectId } = req.query;
    let filter = {};
    if (chapterId) filter.chapterId = chapterId;
    else if (subjectId) filter.subjectId = subjectId;

    const lectures = await Lecture.find(filter);
    const progress = await Progress.find({ user: req.user.id });
    const completedMap = new Map(progress.map(p => [p.lecture.toString(), true]));

    const result = lectures.map(lec => ({
      ...lec.toObject(),
      completed: !!completedMap.get(lec._id.toString())
    }));

    res.json(result);
  } catch (err) {
    console.error("Lectures fetch error:", err);
    res.status(500).json({ success: false, msg: "Failed to load lectures" });
  }
});

// Mark lecture complete
app.post('/api/lectures/:id/complete', authenticate, async (req, res) => {
  try {
    await Progress.findOneAndUpdate(
      { user: req.user.id, lecture: req.params.id },
      { completed: true, completedAt: new Date() },
      { upsert: true }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// Live schedule routes
app.post('/api/live', authenticate, isAdmin, async (req, res) => {
  try {
    const live = await LiveSchedule.create(req.body);
    res.json({ success: true, live });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

app.delete('/api/live/:id', authenticate, isAdmin, async (req, res) => {
  try {
    await LiveSchedule.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, msg: "Failed to delete" });
  }
});

// Subjects routes
app.get('/api/subjects', authenticate, async (req, res) => {
  try {
    const subjects = await Subject.find().sort({ order: 1 });
    res.json(subjects);
  } catch (err) {
    res.status(500).json({ success: false, msg: "Failed to load subjects" });
  }
});

app.post('/api/subjects', authenticate, isAdmin, async (req, res) => {
  try {
    const subject = await Subject.create(req.body);
    res.json({ success: true, subject });
  } catch (err) {
    res.status(500).json({ success: false, msg: err.message || "Failed to create subject" });
  }
});

app.delete('/api/subjects/:id', authenticate, isAdmin, async (req, res) => {
  try {
    await Subject.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, msg: "Failed to delete subject" });
  }
});

// Admin CRUD routes
app.post('/api/chapters', authenticate, isAdmin, async (req, res) => {
  try { res.json(await Chapter.create(req.body)); } catch (e) { res.status(500).json({success:false}); }
});

app.post('/api/lectures', authenticate, isAdmin, async (req, res) => {
  try { res.json(await Lecture.create(req.body)); } catch (e) { res.status(500).json({success:false}); }
});

app.delete('/api/chapters/:id', authenticate, isAdmin, async (req, res) => {
  await Chapter.findByIdAndDelete(req.params.id);
  res.json({success:true});
});

app.delete('/api/lectures/:id', authenticate, isAdmin, async (req, res) => {
  await Lecture.findByIdAndDelete(req.params.id);
  res.json({success:true});
});

app.put('/api/lectures/:id', authenticate, isAdmin, async (req, res) => {
  const lecture = await Lecture.findByIdAndUpdate(req.params.id, req.body, { new: true });
  res.json(lecture || {success:false});
});

app.listen(PORT, () => {
  console.log(`🚀 Secure server running on port ${PORT}`);
});
