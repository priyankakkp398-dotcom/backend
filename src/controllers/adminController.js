const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../config/database');

const login = async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, message: 'Username and password required' });
    const result = await query('SELECT * FROM admins WHERE username = $1', [username]);
    if (result.rows.length === 0) return res.status(401).json({ success: false, message: 'Invalid credentials' });
    const admin = result.rows[0];
    const valid = await bcrypt.compare(password, admin.password);
    if (!valid) return res.status(401).json({ success: false, message: 'Invalid credentials' });
    const token = jwt.sign({ id: admin.id, username: admin.username, role: admin.role }, process.env.ADMIN_JWT_SECRET, { expiresIn: '24h' });
    res.json({ success: true, data: { token, admin: { id: admin.id, username: admin.username, role: admin.role } } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Login failed' });
  }
};

const getDashboard = async (req, res) => {
  try {
    const totalUsers = await query('SELECT COUNT(*) FROM users');
    const totalDeposits = await query("SELECT COALESCE(SUM(amount), 0) FROM deposits WHERE status = 'approved'");
    const totalWithdrawals = await query("SELECT COALESCE(SUM(amount), 0) FROM withdrawals WHERE status = 'approved'");
    const totalBets = await query('SELECT COUNT(*) FROM bets');
    const pendingDeposits = await query("SELECT COUNT(*) FROM deposits WHERE status = 'pending'");
    const pendingWithdrawals = await query("SELECT COUNT(*) FROM withdrawals WHERE status = 'pending'");
    const recentUsers = await query('SELECT id, full_name, email, balance, created_at FROM users ORDER BY created_at DESC LIMIT 10');
    const totalDepositAmount = parseFloat(totalDeposits.rows[0].coalesce);
    const totalWithdrawalAmount = parseFloat(totalWithdrawals.rows[0].coalesce);
    const profit = totalDepositAmount - totalWithdrawalAmount;

    res.json({
      success: true,
      data: {
        totalUsers: parseInt(totalUsers.rows[0].count),
        totalDeposits: totalDepositAmount,
        totalWithdrawals: totalWithdrawalAmount,
        totalBets: parseInt(totalBets.rows[0].count),
        profit,
        pendingDeposits: parseInt(pendingDeposits.rows[0].count),
        pendingWithdrawals: parseInt(pendingWithdrawals.rows[0].count),
        recentUsers: recentUsers.rows
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch dashboard' });
  }
};

const getUsers = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const search = req.query.search || '';
    let sql = 'SELECT id, full_name, email, mobile, balance, referral_code, referral_earnings, total_referrals, is_banned, is_admin, created_at FROM users';
    let params = [];
    if (search) {
      sql += ' WHERE full_name ILIKE $1 OR email ILIKE $1 OR mobile ILIKE $1';
      params.push(`%${search}%`);
    }
    sql += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(limit, offset);
    const result = await query(sql, params);
    let countSql = 'SELECT COUNT(*) FROM users';
    if (search) countSql += ' WHERE full_name ILIKE $1 OR email ILIKE $1 OR mobile ILIKE $1';
    const countResult = await query(countSql, search ? [`%${search}%`] : []);
    res.json({ success: true, data: result.rows, total: parseInt(countResult.rows[0].count), page, limit });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch users' });
  }
};

const banUser = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query('SELECT is_banned FROM users WHERE id = $1', [id]);
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'User not found' });
    const newStatus = !result.rows[0].is_banned;
    await query('UPDATE users SET is_banned = $1 WHERE id = $2', [newStatus, id]);
    res.json({ success: true, message: newStatus ? 'User banned' : 'User unbanned' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update user status' });
  }
};

const editBalance = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, type } = req.body;
    if (!amount || !type) return res.status(400).json({ success: false, message: 'Amount and type required' });
    const userResult = await query('SELECT balance FROM users WHERE id = $1', [id]);
    if (userResult.rows.length === 0) return res.status(404).json({ success: false, message: 'User not found' });
    const oldBalance = parseFloat(userResult.rows[0].balance);
    let newBalance;
    if (type === 'add') newBalance = oldBalance + parseFloat(amount);
    else if (type === 'subtract') newBalance = Math.max(0, oldBalance - parseFloat(amount));
    else if (type === 'set') newBalance = parseFloat(amount);
    else return res.status(400).json({ success: false, message: 'Type must be add, subtract, or set' });
    await query('UPDATE users SET balance = $1 WHERE id = $2', [newBalance, id]);
    await query(
      'INSERT INTO transactions (user_id, type, amount, description, balance_before, balance_after) VALUES ($1, $2, $3, $4, $5, $6)',
      [id, 'admin_adjustment', parseFloat(amount), `Admin ${type} balance: ₹${amount}`, oldBalance, newBalance]
    );
    res.json({ success: true, message: 'Balance updated', data: { oldBalance, newBalance } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update balance' });
  }
};

const getPaymentSettings = async (req, res) => {
  try {
    const result = await query('SELECT * FROM payment_settings LIMIT 1');
    res.json({ success: true, data: result.rows[0] || { upiId: 'Not set', qrCode: null } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch payment settings' });
  }
};

const updatePaymentSettings = async (req, res) => {
  try {
    const { upiId, qrCode } = req.body;
    const existing = await query('SELECT id FROM payment_settings LIMIT 1');
    if (existing.rows.length > 0) {
      await query('UPDATE payment_settings SET upi_id = $1, qr_code = COALESCE($2, qr_code) WHERE id = $3',
        [upiId, qrCode || null, existing.rows[0].id]);
    } else {
      await query('INSERT INTO payment_settings (upi_id, qr_code) VALUES ($1, $2)', [upiId, qrCode || null]);
    }
    res.json({ success: true, message: 'Payment settings updated' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update payment settings' });
  }
};

const updateReferralBonus = async (req, res) => {
  try {
    const { bonus } = req.body;
    if (!bonus || bonus < 0) return res.status(400).json({ success: false, message: 'Invalid bonus amount' });
    process.env.REFERRAL_BONUS = bonus.toString();
    res.json({ success: true, message: `Referral bonus updated to ₹${bonus}` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update referral bonus' });
  }
};

const getGameSettings = async (req, res) => {
  try {
    const engine = req.app.locals.gameEngine;
    const result = await query('SELECT speed, rtp, low_crash_frequency, high_multiplier_frequency FROM game_settings LIMIT 1');
    if (result.rows.length > 0) {
      const row = result.rows[0];
      res.json({ success: true, data: {
        speed: parseFloat(row.speed),
        rtp: parseFloat(row.rtp),
        lowCrashFrequency: parseFloat(row.low_crash_frequency),
        highMultiplierFrequency: parseFloat(row.high_multiplier_frequency)
      }});
    } else {
      res.json({ success: true, data: { speed: engine.speed, rtp: engine.rtp, lowCrashFrequency: engine.lowCrashFrequency, highMultiplierFrequency: engine.highMultiplierFrequency } });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch game settings' });
  }
};

const updateGameSettings = async (req, res) => {
  try {
    const { speed, rtp, lowCrashFrequency, highMultiplierFrequency } = req.body;
    const engine = req.app.locals.gameEngine;

    if (speed !== undefined && speed !== null) {
      const parsed = parseFloat(speed);
      if (isNaN(parsed) || parsed < 0) return res.status(400).json({ success: false, message: 'Speed must be a non-negative number' });
      engine.setSpeed(parsed);
    }
    if (rtp !== undefined && rtp !== null) {
      const parsed = parseFloat(rtp);
      if (isNaN(parsed) || parsed < 80 || parsed > 99) return res.status(400).json({ success: false, message: 'RTP must be 80-99' });
      engine.setRtp(parsed);
    }
    if (lowCrashFrequency !== undefined && lowCrashFrequency !== null) {
      const parsed = parseFloat(lowCrashFrequency);
      if (isNaN(parsed) || parsed < 5 || parsed > 50) return res.status(400).json({ success: false, message: 'Low crash frequency must be 5-50' });
      engine.setLowCrashFrequency(parsed);
    }
    if (highMultiplierFrequency !== undefined && highMultiplierFrequency !== null) {
      const parsed = parseFloat(highMultiplierFrequency);
      if (isNaN(parsed) || parsed < 0.5 || parsed > 10) return res.status(400).json({ success: false, message: 'High multiplier frequency must be 0.5-10' });
      engine.setHighMultiplierFrequency(parsed);
    }

    await query(
      `UPDATE game_settings SET speed = $1, rtp = $2, low_crash_frequency = $3, high_multiplier_frequency = $4 WHERE id = 1`,
      [engine.speed, engine.rtp, engine.lowCrashFrequency, engine.highMultiplierFrequency]
    );

    res.json({ success: true, message: 'Game settings updated', data: {
      speed: engine.speed,
      rtp: engine.rtp,
      lowCrashFrequency: engine.lowCrashFrequency,
      highMultiplierFrequency: engine.highMultiplierFrequency
    }});
  } catch (err) {
    console.error('Game settings update error:', err);
    res.status(500).json({ success: false, message: 'Failed to update game settings' });
  }
};

const updateSupport = async (req, res) => {
  try {
    const { telegram, whatsapp } = req.body;
    await query(
      'INSERT INTO support_settings (id, telegram, whatsapp) VALUES (1, $1, $2) ON CONFLICT (id) DO UPDATE SET telegram = EXCLUDED.telegram, whatsapp = EXCLUDED.whatsapp',
      [telegram || '', whatsapp || '']
    );
    res.json({ success: true, message: 'Support settings updated' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to update support settings' });
  }
};

module.exports = { login, getDashboard, getUsers, banUser, editBalance, getPaymentSettings, updatePaymentSettings, updateReferralBonus, getGameSettings, updateGameSettings, updateSupport };
