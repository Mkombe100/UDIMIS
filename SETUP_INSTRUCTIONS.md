# Ulanaga District System - Email Setup Guide

## Prerequisites
- Node.js (v14 or higher)
- PostgreSQL database (or Neon PostgreSQL)
- Gmail account (for email verification)

## Step 1: Install Dependencies

```bash
npm install
```

## Step 2: Create a Gmail App Password

1. Go to your Google Account: https://myaccount.google.com/
2. Click **Security** in the left menu
3. Enable **2-Step Verification** if not already enabled
4. Scroll down to **App passwords** section
5. Select **Mail** and **Windows Computer** (or your device)
6. Google will generate a **16-character password** - copy it

## Step 3: Configure Environment Variables

1. Create a `.env` file in the root directory (copy from `.env.example`):

```bash
cp .env.example .env
```

2. Open `.env` and update with your credentials:

```
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=xxxx xxxx xxxx xxxx
DATABASE_URL=postgresql://your-db-connection-string
PORT=4000
```

**Important Notes:**
- `EMAIL_PASS` is the **16-character app password** from Google, NOT your Gmail password
- Remove spaces if Google added them
- `DATABASE_URL` should be your PostgreSQL connection string

## Step 4: Create Database Tables

Connect to your PostgreSQL database and run:

```sql
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  phone_number VARCHAR(20) UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_login TIMESTAMP
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_phone ON users(phone_number);
```

## Step 5: Start the Server

```bash
node index.js
```

You should see:
```
Server running on http://localhost:4000
```

## Step 6: Test Email Verification

### Signup Flow:
```bash
# Request signup code
curl -X POST http://localhost:4000/api/signup/request-code \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "John",
    "lastName": "Doe",
    "email": "your-email@gmail.com",
    "phone": "1234567890"
  }'

# Verify code (check email for the code)
curl -X POST http://localhost:4000/api/signup/verify-and-create \
  -H "Content-Type: application/json" \
  -d '{
    "email": "your-email@gmail.com",
    "code": "123456"
  }'
```

### Login Flow:
```bash
# Request login code
curl -X POST http://localhost:4000/api/login/request-code \
  -H "Content-Type: application/json" \
  -d '{"email": "your-email@gmail.com"}'

# Verify code
curl -X POST http://localhost:4000/api/login/verify \
  -H "Content-Type: application/json" \
  -d '{
    "email": "your-email@gmail.com",
    "code": "123456"
  }'
```

## Troubleshooting

### "Failed to send verification email"
- Check that `EMAIL_USER` and `EMAIL_PASS` are correct in `.env`
- Verify you're using the **App Password**, not your Gmail password
- Ensure 2-Step Verification is enabled on your Google Account

### "Invalid email format" or "No account found"
- Make sure email is valid format
- For signup, the email shouldn't already exist in the database
- For login, the email must exist

### Database connection error
- Verify `DATABASE_URL` is correct
- Check PostgreSQL is running
- For Neon PostgreSQL, ensure you've added `?sslmode=require` to the connection string

## Security Best Practices

1. **Never commit `.env` file** - it's in `.gitignore`
2. Use strong, unique app passwords
3. Rotate credentials regularly
4. Keep Node.js and dependencies updated: `npm audit`
5. Store OTP codes in-memory (not database) as implemented

## Additional Features

- **OTP Expiration**: 10 minutes (adjustable in code)
- **6-digit verification codes**: Random and secure
- **Email normalization**: Lowercase and trimmed
- **Duplicate prevention**: Checks for existing email/phone before signup
- **Transaction safety**: Uses database transactions for consistency
