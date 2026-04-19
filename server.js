// server.js - Production Ready for Render
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

// Dynamic CORS for production
const allowedOrigins = [
  'http://localhost:3000',
  process.env.BASE_URL,
  'https://your-app-name.onrender.com'  // Replace with your actual Render URL
].filter(Boolean);
app.use(cors({
  origin: function(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(cookieParser());

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
app.use('/api/', limiter);

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB Connected'))
  .catch(err => console.error('❌ MongoDB Error:', err));

// Models
const User = require('./models/User');
const Lecture = require('./models/Lecture');
const Chapter = require('./models/Chapter');
const Progress = require('./models/Progress');
const LiveSchedule = require('./models/LiveSchedule');
const Subject = require('./models/Subject');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-change-me';

// Email transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

const otpStore = new Map();

// ========== MIDDLEWARE ==========
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

// ========== SEEDING ==========
const seedAdmin = async () => {
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminEmail || !adminPassword) {
    console.log('⏩ Skipping admin seed');
    return;
  }
  const existing = await User.findOne({ email: adminEmail });
  if (!existing) {
    await User.create({ name: "Admin", email: adminEmail, password: adminPassword, role: "admin" });
    console.log(`✅ Admin created: ${adminEmail}`);
  } else {
    console.log(`✅ Admin already exists`);
  }
};

const seedSubjects = async () => {
  const defaultSubjects = [
    { name: "Quantitative Aptitude", icon: "📊", color: "blue", order: 1 },
    { name: "Reasoning Ability", icon: "🧠", color: "purple", order: 2 },
    { name: "English Language", icon: "📖", color: "pink", order: 3 },
    { name: "Banking Awareness", icon: "🏦", color: "emerald", order: 4 },
    { name: "Current Affairs", icon: "📰", color: "orange", order: 5 }
  ];
  for (let sub of defaultSubjects) {
    const exists = await Subject.findOne({ name: sub.name });
    if (!exists) await Subject.create(sub);
  }
  console.log("✅ Default subjects seeded");
};

mongoose.connection.once('open', async () => {
  await seedAdmin();
  await seedSubjects();
});

// ========== API ROUTES ==========

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

app.get('/api/lectures/:id', authenticate, async (req, res) => {
  try {
    const lecture = await Lecture.findById(req.params.id);
    if (!lecture) return res.status(404).json({ success: false, msg: "Not found" });
    res.json(lecture);
  } catch (err) {
    res.status(500).json({ success: false, msg: "Failed to fetch lecture" });
  }
});

app.post('/api/send-otp', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.json({ success: false, msg: "Email required" });
  if (await User.findOne({ email })) return res.json({ success: false, msg: "Email already registered" });

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  otpStore.set(email, { otp, expires: Date.now() + 10 * 60 * 1000 });

  try {
    await transporter.sendMail({
      from: `"My PW" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Your Signup OTP - My PW",
      html: `<div style="font-family: Arial; max-width:500px; margin:auto; padding:20px; background:#f8fafc; border-radius:12px;">
              <h2 style="color:#1e40af; text-align:center;">My PW</h2>
              <div style="background:white; padding:20px; border-radius:10px; text-align:center;">
                <h1 style="font-size:42px; letter-spacing:8px; color:#1e40af;">${otp}</h1>
              </div>
              <p style="text-align:center;">Valid for 10 minutes.</p>
             </div>`
    });
    res.json({ success: true, msg: "OTP sent" });
  } catch (err) {
    console.error("Email error:", err);
    res.json({ success: false, msg: "Failed to send OTP. Check email configuration." });
  }
});

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

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user || !(await user.comparePassword(password))) {
      return res.json({ success: false, msg: "Invalid email or password" });
    }
    const token = jwt.sign({ id: user._id, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('token', token, {
      httpOnly: true,
      maxAge: 7*24*60*60*1000,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production'
    });
    res.json({ success: true, msg: "Login successful", user: { name: user.name, role: user.role } });
  } catch (err) {
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

app.post('/api/forgot-password', async (req, res) => {
  const { email } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) return res.json({ success: false, msg: "No account found" });

    const resetToken = crypto.randomBytes(32).toString('hex');
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = Date.now() + 3600000;
    await user.save();

    const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;
    const resetLink = `${baseUrl}/reset-password.html?token=${resetToken}`;

    await transporter.sendMail({
      from: `"My PW" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Reset Your Password",
      html: `<h2>Reset Password</h2>
             <p>Click <a href="${resetLink}">here</a> to reset your password.</p>
             <p>This link expires in 1 hour.</p>`
    });
    res.json({ success: true, msg: "Reset link sent to your email." });
  } catch (err) {
    res.status(500).json({ success: false, msg: "Failed to send reset email" });
  }
});

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

app.post('/api/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true });
});

app.get('/api/me', authenticate, (req, res) => {
  res.json({ success: true, user: { name: req.user.name, role: req.user.role } });
});

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
    res.status(500).json({ success: false, msg: "Failed to load lectures" });
  }
});

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
    res.status(500).json({ success: false });
  }
});

app.get('/api/subjects', authenticate, async (req, res) => {
  try {
    const subjects = await Subject.find().sort({ order: 1 });
    res.json(subjects);
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

app.post('/api/subjects', authenticate, isAdmin, async (req, res) => {
  try {
    const subject = await Subject.create(req.body);
    res.json({ success: true, subject });
  } catch (err) {
    res.status(500).json({ success: false, msg: err.message });
  }
});

app.delete('/api/subjects/:id', authenticate, isAdmin, async (req, res) => {
  try {
    await Subject.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

app.post('/api/chapters', authenticate, isAdmin, async (req, res) => {
  try { res.json(await Chapter.create(req.body)); } catch (e) { res.status(500).json({ success: false }); }
});
app.post('/api/lectures', authenticate, isAdmin, async (req, res) => {
  try { res.json(await Lecture.create(req.body)); } catch (e) { res.status(500).json({ success: false }); }
});
app.delete('/api/chapters/:id', authenticate, isAdmin, async (req, res) => {
  await Chapter.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});
app.delete('/api/lectures/:id', authenticate, isAdmin, async (req, res) => {
  await Lecture.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});
app.put('/api/lectures/:id', authenticate, isAdmin, async (req, res) => {
  const lecture = await Lecture.findByIdAndUpdate(req.params.id, req.body, { new: true });
  res.json(lecture || { success: false });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, msg: 'Internal server error' });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
