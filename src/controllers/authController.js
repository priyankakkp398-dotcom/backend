const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../config/database');
const { generateReferralCode, generateOTP } = require('../utils/helpers');
const { sendOtpEmail } = require('../utils/mailer');

const otpStore = new Map();

const register = async (req, res) => {
  try {
    const { fullName, email, mobile, password, referralCode } = req.body;
    const existingEmail = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (existingEmail.rows.length > 0) return res.status(400).json({ success: false, message: 'Email already registered' });
    const existingMobile = await query('SELECT id FROM users WHERE mobile = $1', [mobile]);
    if (existingMobile.rows.length > 0) return res.status(400).json({ success: false, message: 'Mobile number already registered' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const code = generateReferralCode();

    let referredBy = null;
    if (referralCode) {
      const parent = await query('SELECT id FROM users WHERE referral_code = $1', [referralCode]);
      if (parent.rows.length > 0) referredBy = parent.rows[0].id;
    }

    const result = await query(
      'INSERT INTO users (full_name, email, mobile, password, referral_code, referred_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, full_name, email, mobile, balance, referral_code, created_at',
      [fullName, email, mobile, hashedPassword, code, referredBy]
    );
    const user = result.rows[0];

    if (referredBy) {
      const bonus = parseFloat(process.env.REFERRAL_BONUS) || 50;
      await query('UPDATE users SET balance = balance + $1, referral_earnings = referral_earnings + $1, total_referrals = total_referrals + 1 WHERE id = $2', [bonus, referredBy]);
      await query('INSERT INTO referrals (parent_id, child_id, bonus) VALUES ($1, $2, $3)', [referredBy, user.id, bonus]);
      const parentResult = await query('SELECT balance FROM users WHERE id = $1', [referredBy]);
      const parentBalance = parseFloat(parentResult.rows[0]?.balance || 0);
      await query(
        'INSERT INTO transactions (user_id, type, amount, description, balance_before, balance_after) VALUES ($1, $2, $3, $4, $5, $6)',
        [referredBy, 'referral_bonus', bonus, `Referral bonus for referring ${fullName}`, parentBalance - bonus, parentBalance]
      );
    }

    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
    res.status(201).json({ success: true, message: 'Registration successful', data: { token, user } });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ success: false, message: 'Registration failed' });
  }
};

const login = async (req, res) => {
  try {
    const { email, mobile, password } = req.body;
    const identifier = email || mobile;
    if (!identifier) return res.status(400).json({ success: false, message: 'Email or mobile is required' });

    const result = await query(
      'SELECT id, full_name, email, mobile, balance, referral_code, password, is_banned FROM users WHERE email = $1 OR mobile = $1',
      [identifier]
    );
    if (result.rows.length === 0) return res.status(401).json({ success: false, message: 'Invalid credentials' });

    const user = result.rows[0];
    if (user.is_banned) return res.status(403).json({ success: false, message: 'Your account has been banned' });

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(401).json({ success: false, message: 'Invalid credentials' });

    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
    const { password: _, ...userData } = user;
    res.json({ success: true, message: 'Login successful', data: { token, user: userData } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: 'Login failed' });
  }
};

const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'Email is required' });
    const result = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Email not registered' });

    const otp = generateOTP();
    otpStore.set(email, { otp, expiresAt: Date.now() + 600000 });

    const sent = await sendOtpEmail(email, otp);
    if (!sent) {
      console.log(`OTP for ${email}: ${otp}`);
    }

    res.json({ success: true, message: 'If this email is registered, an OTP has been sent.' });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ success: false, message: 'Failed to process request' });
  }
};

const resetPassword = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    const stored = otpStore.get(email);
    if (!stored) return res.status(400).json({ success: false, message: 'No OTP requested' });
    if (stored.otp !== otp) return res.status(400).json({ success: false, message: 'Invalid OTP' });
    if (Date.now() > stored.expiresAt) return res.status(400).json({ success: false, message: 'OTP expired' });

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await query('UPDATE users SET password = $1 WHERE email = $2', [hashedPassword, email]);
    otpStore.delete(email);

    res.json({ success: true, message: 'Password reset successful' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ success: false, message: 'Failed to reset password' });
  }
};

const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const result = await query('SELECT password FROM users WHERE id = $1', [req.user.id]);
    const valid = await bcrypt.compare(currentPassword, result.rows[0].password);
    if (!valid) return res.status(400).json({ success: false, message: 'Current password is incorrect' });

    const hashed = await bcrypt.hash(newPassword, 10);
    await query('UPDATE users SET password = $1 WHERE id = $2', [hashed, req.user.id]);
    res.json({ success: true, message: 'Password changed successfully' });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ success: false, message: 'Failed to change password' });
  }
};

module.exports = { register, login, forgotPassword, resetPassword, changePassword };
