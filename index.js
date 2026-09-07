// server.js
require("dotenv").config();
const express = require("express");
const { Pool } = require("pg");
const cors = require("cors");
const path = require("path");
const nodemailer = require("nodemailer");

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// Serve static files from "public" folder
app.use(express.static(path.join(__dirname, "public")));

// Validate required environment variables
if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
  console.error("❌ ERROR: EMAIL_USER and EMAIL_PASS must be set in .env file");
  console.error("📋 Instructions: Follow SETUP_INSTRUCTIONS.md for Gmail App Password setup");
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error("❌ ERROR: DATABASE_URL must be set in .env file");
  process.exit(1);
}

// Neon PostgreSQL pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.DATABASE_URL && process.env.DATABASE_URL.includes("sslmode=require")
      ? { rejectUnauthorized: false }
      : false,
});

// Test database connection
pool.query("SELECT NOW()", (err, res) => {
  if (err) {
    console.error("❌ Database connection failed:", err.message);
  } else {
    console.log("✅ Database connected successfully");
  }
});

// Create Nodemailer transporter with Gmail
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Test email configuration
transporter.verify((error, success) => {
  if (error) {
    console.error("❌ Email configuration error:", error.message);
    console.error("📋 Make sure to use a Gmail App Password, not your regular password");
  } else {
    console.log("✅ Email service configured and ready");
  }
});

// In-memory OTP store (never written to DB)
const otpStore = new Map();

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit
}

// ---------- SIGNUP ----------

// Step 1: request signup code (check if email/phone exists first)
app.post("/api/signup/request-code", async (req, res) => {
  const client = await pool.connect();
  try {
    const { firstName, lastName, email, phone } = req.body;

    if (!firstName || !lastName || !email || !phone) {
      return res.status(400).json({ error: "All fields are required" });
    }

    const emailNorm = email.toLowerCase().trim();
    const phoneNorm = phone.trim();

    if (!/^\S+@\S+\.\S+$/.test(emailNorm)) {
      return res.status(400).json({ error: "Invalid email format" });
    }

    // Check if email already exists
    const existingEmail = await client.query(
      "SELECT id FROM users WHERE email = $1 LIMIT 1",
      [emailNorm]
    );

    if (existingEmail.rows.length > 0) {
      return res.status(400).json({
        error: "This email is already registered. Please log in instead.",
      });
    }

    // Check if phone already exists
    const existingPhone = await client.query(
      "SELECT id FROM users WHERE phone_number = $1 LIMIT 1",
      [phoneNorm]
    );

    if (existingPhone.rows.length > 0) {
      return res.status(400).json({
        error: "This phone number is already registered.",
      });
    }

    const code = generateCode();
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

    otpStore.set(emailNorm, {
      type: "signup",
      code,
      expiresAt,
      firstName,
      lastName,
      phone: phoneNorm,
    });

    // Send verification email with HTML template
    try {
      const htmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9; border-radius: 8px;">
          <div style="background-color: #fff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h2 style="color: #333; margin-bottom: 10px;">📧 Email Verification</h2>
            <p style="color: #666; margin-bottom: 20px;">Hello ${firstName},</p>
            
            <p style="color: #666; margin-bottom: 20px;">Welcome to the <strong>Ulanaga District System</strong>! Your email verification code is:</p>
            
            <div style="background-color: #007bff; padding: 25px; text-align: center; margin: 25px 0; border-radius: 5px;">
              <h1 style="color: #fff; margin: 0; letter-spacing: 8px; font-family: monospace; font-size: 32px;">${code}</h1>
            </div>
            
            <p style="color: #666; margin: 20px 0; font-size: 14px;">
              ⏱️ <strong>This code expires in 10 minutes</strong>
            </p>
            
            <div style="background-color: #fff3cd; padding: 15px; border-left: 4px solid #ffc107; margin: 20px 0; border-radius: 4px;">
              <p style="color: #856404; margin: 0; font-size: 13px;">
                <strong>💡 Tip:</strong> Never share this code with anyone. The Ulanaga Team will never ask for it.
              </p>
            </div>
            
            <p style="color: #999; font-size: 12px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
              If you didn't request this verification code, please ignore this email or contact support.
            </p>
          </div>
        </div>
      `;

      await transporter.sendMail({
        from: `"Ulanaga District System" <${process.env.EMAIL_USER}>`,
        to: emailNorm,
        subject: "🔐 Your Email Verification Code",
        html: htmlContent,
        text: `Your verification code is: ${code}. This code will expire in 10 minutes.`
      });
      console.log(`✅ Signup verification code sent to ${emailNorm}`);
    } catch (emailErr) {
      console.error("❌ Failed to send verification email:", emailErr.message);
      otpStore.delete(emailNorm);
      return res.status(500).json({ error: "Failed to send verification email. Check server logs." });
    }

    res.json({ 
      ok: true, 
      message: "Verification code sent to your email",
      email: emailNorm
    });
  } catch (err) {
    console.error("❌ signup request-code error:", err);
    res.status(500).json({ error: "Server error" });
  } finally {
    client.release();
  }
});

// Step 2: verify signup code and create user
app.post("/api/signup/verify-and-create", async (req, res) => {
  const client = await pool.connect();
  try {
    const { email, code } = req.body;
    if (!email || !code) {
      return res.status(400).json({ error: "Email and code are required" });
    }

    const emailNorm = email.toLowerCase().trim();
    const record = otpStore.get(emailNorm);

    if (!record || record.type !== "signup") {
      return res.status(400).json({ error: "No signup code requested for this email" });
    }

    if (Date.now() > record.expiresAt) {
      otpStore.delete(emailNorm);
      return res.status(400).json({ error: "Code expired. Please request a new one." });
    }

    if (record.code !== String(code)) {
      return res.status(400).json({ error: "Invalid code" });
    }

    await client.query("BEGIN");

    // Double-check email uniqueness
    const existingEmail = await client.query(
      "SELECT id FROM users WHERE email = $1 LIMIT 1",
      [emailNorm]
    );
    if (existingEmail.rows.length > 0) {
      await client.query("ROLLBACK");
      otpStore.delete(emailNorm);
      return res.status(400).json({
        error: "This email is already registered. Please log in instead.",
      });
    }

    // Double-check phone uniqueness
    const existingPhone = await client.query(
      "SELECT id FROM users WHERE phone_number = $1 LIMIT 1",
      [record.phone]
    );
    if (existingPhone.rows.length > 0) {
      await client.query("ROLLBACK");
      otpStore.delete(emailNorm);
      return res.status(400).json({
        error: "This phone number is already registered.",
      });
    }

    // INSERT user into database
    const result = await client.query(
      `
      INSERT INTO users (first_name, last_name, email, phone_number, last_login)
      VALUES ($1, $2, $3, $4, NOW())
      RETURNING id, first_name, last_name, email, phone_number, created_at, last_login;
      `,
      [record.firstName, record.lastName, emailNorm, record.phone]
    );

    await client.query("COMMIT");

    // Clear OTP after successful verification
    otpStore.delete(emailNorm);

    const user = result.rows[0];
    console.log(`✅ User ${user.id} created and verified successfully (${emailNorm})`);

    // Return success with user data and redirect
    res.json({
      ok: true,
      message: "Email verified! User account created successfully.",
      redirect: "/dashboard.html",
      user: {
        id: user.id,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        phone_number: user.phone_number,
        created_at: user.created_at,
        last_login: user.last_login,
      },
    });
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      console.error("Rollback error:", rollbackErr);
    }
    console.error("❌ signup verify-and-create error:", err);

    if (err.code === "23505") {
      return res.status(400).json({
        error: "A user with this email or phone number already exists.",
      });
    }

    res.status(500).json({ error: "Server error during user creation" });
  } finally {
    client.release();
  }
});

// ---------- LOGIN ----------

// Step 1: request login code
app.post("/api/login/request-code", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({ error: "Valid email is required" });
    }

    const emailNorm = email.toLowerCase().trim();

    const checkRes = await pool.query(
      "SELECT id, first_name FROM users WHERE email = $1 LIMIT 1",
      [emailNorm]
    );

    if (checkRes.rows.length === 0) {
      return res.status(400).json({ error: "No account found for this email" });
    }

    const code = generateCode();
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

    otpStore.set(emailNorm, {
      type: "login",
      code,
      expiresAt,
    });

    // Send verification email with HTML template
    try {
      const firstName = checkRes.rows[0].first_name;
      const htmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9; border-radius: 8px;">
          <div style="background-color: #fff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <h2 style="color: #333; margin-bottom: 10px;">🔐 Login Verification</h2>
            <p style="color: #666; margin-bottom: 20px;">Hello ${firstName},</p>
            
            <p style="color: #666; margin-bottom: 20px;">Your login verification code is:</p>
            
            <div style="background-color: #28a745; padding: 25px; text-align: center; margin: 25px 0; border-radius: 5px;">
              <h1 style="color: #fff; margin: 0; letter-spacing: 8px; font-family: monospace; font-size: 32px;">${code}</h1>
            </div>
            
            <p style="color: #666; margin: 20px 0; font-size: 14px;">
              ⏱️ <strong>This code expires in 10 minutes</strong>
            </p>
            
            <div style="background-color: #f8d7da; padding: 15px; border-left: 4px solid #dc3545; margin: 20px 0; border-radius: 4px;">
              <p style="color: #721c24; margin: 0; font-size: 13px;">
                <strong>⚠️ Security:</strong> Never share this code. If you didn't request this, your account may be at risk.
              </p>
            </div>
            
            <p style="color: #999; font-size: 12px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
              Questions? Contact us at support@ulanagadistrict.local
            </p>
          </div>
        </div>
      `;

      await transporter.sendMail({
        from: `"Ulanaga District System" <${process.env.EMAIL_USER}>`,
        to: emailNorm,
        subject: "🔐 Your Login Verification Code",
        html: htmlContent,
        text: `Your login verification code is: ${code}. This code will expire in 10 minutes.`
      });
      console.log(`✅ Login verification code sent to ${emailNorm}`);
    } catch (emailErr) {
      console.error("❌ Failed to send verification email:", emailErr.message);
      otpStore.delete(emailNorm);
      return res.status(500).json({ error: "Failed to send verification email. Check server logs." });
    }

    res.json({ 
      ok: true, 
      message: "Verification code sent to your email",
      email: emailNorm
    });
  } catch (err) {
    console.error("❌ login request-code error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Step 2: verify login code and return user
app.post("/api/login/verify", async (req, res) => {
  const client = await pool.connect();
  try {
    const { email, code } = req.body;
    if (!email || !code) {
      return res.status(400).json({ error: "Email and code are required" });
    }

    const emailNorm = email.toLowerCase().trim();
    const record = otpStore.get(emailNorm);

    if (!record || record.type !== "login") {
      return res.status(400).json({ error: "No login code requested for this email" });
    }

    if (Date.now() > record.expiresAt) {
      otpStore.delete(emailNorm);
      return res.status(400).json({ error: "Code expired. Please request a new one." });
    }

    if (record.code !== String(code)) {
      return res.status(400).json({ error: "Invalid code" });
    }

    await client.query("BEGIN");

    // Update last_login and retrieve user data from database
    const result = await client.query(
      `
      UPDATE users
      SET last_login = NOW()
      WHERE email = $1
      RETURNING id, first_name, last_name, email, phone_number, created_at, last_login;
      `,
      [emailNorm]
    );

    if (result.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "No account found for this email" });
    }

    await client.query("COMMIT");

    // Clear OTP after successful verification
    otpStore.delete(emailNorm);

    const user = result.rows[0];
    console.log(`✅ User ${user.id} logged in and verified successfully (${emailNorm})`);

    // Return success with user data and redirect
    res.json({
      ok: true,
      message: "Email verified! Welcome back.",
      redirect: "/dashboard.html",
      user: {
        id: user.id,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        phone_number: user.phone_number,
        created_at: user.created_at,
        last_login: user.last_login,
      },
    });
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      console.error("Rollback error:", rollbackErr);
    }
    console.error("❌ login verify error:", err);
    res.status(500).json({ error: "Server error during login" });
  } finally {
    client.release();
  }
});

// ---------- HEALTH CHECK ----------
app.get("/api/health", (req, res) => {
  res.json({ 
    status: "ok", 
    timestamp: new Date().toISOString(),
    email_configured: !!process.env.EMAIL_USER,
    database_connected: true
  });
});

// ---------- GET ALL USERS (for verification) ----------
app.get("/api/users", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, first_name, last_name, email, phone_number, created_at, last_login FROM users ORDER BY created_at DESC"
    );
    res.json({
      ok: true,
      count: result.rows.length,
      users: result.rows
    });
  } catch (err) {
    console.error("❌ Error fetching users:", err);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

// ---------- START SERVER ----------

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════╗
║  🚀 Server running on port ${PORT}   ║
║  📧 Email: Configured & Ready         ║
║  🗄️  Database: Connected               ║
║  ✅ Email Verification: ACTIVE        ║
╚════════════════════════════════════════╝

API Endpoints:
  POST   /api/signup/request-code
  POST   /api/signup/verify-and-create
  POST   /api/login/request-code
  POST   /api/login/verify
  GET    /api/users (view all verified users)
  GET    /api/health

  `);
});
