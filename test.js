const readline = require("readline");
const nodemailer = require("nodemailer");
require("dotenv").config();

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function question(text) {
    return new Promise((resolve) => {
        rl.question(text, resolve);
    });
}

// Create email transporter
const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// Generate a 6-digit verification code
function generateCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

async function main() {
    try {
        console.log("\n================================");
        console.log("      EMAIL VERIFICATION");
        console.log("================================\n");

        // Ask for email
        const email = await question("Enter your email: ");

        // Generate verification code
        const verificationCode = generateCode();

        console.log("\nSending verification code...");

        // Send email
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: email,
            subject: "Your Verification Code",
            text: `Your verification code is: ${verificationCode}\n\nThis code will be used to verify your email.`
        });

        console.log("Verification code sent successfully!");
        console.log("Check your email.\n");

        // Ask user for code
        const enteredCode = await question("Enter the verification code: ");

        // Verify
        if (enteredCode.trim() === verificationCode) {
            console.log("\n✓ Email verified successfully!");
        } else {
            console.log("\n✗ Invalid verification code.");
        }

    } catch (error) {
        console.error("\nError sending email:");
        console.error(error.message);
    } finally {
        rl.close();
    }
}

main();