const sgMail = require('@sendgrid/mail');

let initialized = false;

function init() {
  if (initialized) return true;
  const apiKey = process.env.SMTP_PASS;
  if (!apiKey || !apiKey.startsWith('SG.')) {
    console.warn('[Mailer] SendGrid API key not found in SMTP_PASS');
    return false;
  }
  sgMail.setApiKey(apiKey);
  initialized = true;
  return true;
}

async function sendOtpEmail(to, otp) {
  if (!init()) return false;
  const siteName = process.env.SITE_NAME || 'Paisa Hi Paisa';
  const from = process.env.SMTP_FROM || 'paisahipaisa034@gmail.com';
  try {
    await sgMail.send({
      to,
      from,
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
    console.log(`[Mailer] Email sent to ${to} via SendGrid`);
    return true;
  } catch (err) {
    console.error('[Mailer] SendGrid error:', err.message);
    if (err.response && err.response.body) {
      console.error('[Mailer] SendGrid details:', JSON.stringify(err.response.body, null, 2));
    }
    return false;
  }
}

module.exports = { sendOtpEmail };
