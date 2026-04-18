// seed.js
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');

mongoose.connect(process.env.MONGO_URI)
.then(async () => {
    console.log('✅ Connected to MongoDB');

    // Delete any old users
    await User.deleteMany({});

    // Create Admin
    const admin = new User({
        name: "Project02 Admin",
        email: "admin@project02.com",
        password: "Admin@12345",
        role: "admin"
    });
    await admin.save();
    console.log("✅ Admin created → admin@project02.com / Admin@12345");

    // Create Student
    const student = new User({
        name: "Test Student",
        email: "student@project02.com",
        password: "Student@12345",
        role: "student"
    });
    await student.save();
    console.log("✅ Student created → student@project02.com / Student@12345");

    console.log("\n🎉 Seed completed! You can now login.");
    process.exit(0);
})
.catch(err => {
    console.error("❌ Seed Error:", err.message);
    process.exit(1);
});
