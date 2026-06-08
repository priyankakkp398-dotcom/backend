const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) {
    console.warn('[Mailer] SMTP not configured — emails will not be sent. Set SMTP_HOST, SMTP_USER, SMTP_PASS in .env');
    return null;
  }
  transporter = nodemailer.createTransport({
    host,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_PORT === '465',
    auth: { user, pass },
  });
  return transporter;
}

async function sendOtpEmail(to, otp) {
  const t = getTransporter();
  if (!t) return false;
  const siteName = process.env.SITE_NAME || 'Paisa Hi Paisa';
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  try {
    await t.sendMail({
      from: `"${siteName}" <${from}>`,
      to,
      subject: `Password Reset OTP — ${siteName}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#0a0a0a;color:#fff;border-radius:12px">
          <div style="text-align:center;margin-bottom:24px">
            <h1 style="color:#39FF14;font-size:22px;margin:0">${siteName}</h1>
            <p style="color:#888;font-size:13px;margin:4px 0 0">Password Reset</p>
          </div>
          <div style="background:#141516;border-radius:10px;padding:24px;text-align:center;border:1px solid rgba(57,255,20,0.08)">
            <p style="color:#aaa;font-size:14px;margin:0 0 12px">Your OTP for password reset</p>
            <div style="font-size:36px;font-weight:700;letter-spacing:8px;color:#39FF14;font-family:monospace;padding:12px;background:#000;border-radius:8px;display:inline-block">${otp}</div>
            <p style="color:#666;font-size:12px;margin:16px 0 0">This OTP is valid for <strong style="color:#fff">10 minutes</strong></p>
          </div>
          <p style="color:#555;font-size:11px;text-align:center;margin-top:20px">If you did not request this, please ignore this email.</p>
        </div>
      `,
    });
    return true;
  } catch (err) {
    console.error('[Mailer] Failed to send email:', err.message);
    return false;
  }
}

module.exports = { sendOtpEmail };
