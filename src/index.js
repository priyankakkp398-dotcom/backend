require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const http = require('http');
const { Server } = require('socket.io');

const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const bankRoutes = require('./routes/bankRoutes');
const depositRoutes = require('./routes/depositRoutes');
const withdrawRoutes = require('./routes/withdrawRoutes');
const gameRoutes = require('./routes/gameRoutes');
const referralRoutes = require('./routes/referralRoutes');
const transactionRoutes = require('./routes/transactionRoutes');
const adminRoutes = require('./routes/adminRoutes');
const supportRoutes = require('./routes/supportRoutes');
const { GameEngine } = require('./utils/gameEngine');
const { query } = require('./config/database');
const { startKeepAlive } = require('./utils/keepAlive');

const app = express();
const server = http.createServer(app);
const corsOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  process.env.FRONTEND_URL,
  process.env.FRONTEND_URL_2
].filter(Boolean);

const corsOptions = {
  origin: (origin, cb) => {
    if (!origin || corsOrigins.includes(origin) || origin.endsWith('.netlify.app')) return cb(null, true);
    cb(null, true);
  },
  credentials: true
};

const io = new Server(server, {
  cors: corsOptions,
  path: '/api/socket.io'
});

const PORT = process.env.PORT || 5000;

app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors(corsOptions));
app.use(express.json({ limit: '50mb' }));

app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/bank', bankRoutes);
app.use('/api/deposit', depositRoutes);
app.use('/api/withdraw', withdrawRoutes);
app.use('/api/game', gameRoutes);
app.use('/api/referral', referralRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/support', supportRoutes);

app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'Server is running', timestamp: new Date().toISOString() });
});

app.get('/api/payment-info', async (req, res) => {
  try {
    const result = await query('SELECT upi_id, qr_code FROM payment_settings LIMIT 1');
    if (result.rows.length > 0) {
      res.json({ success: true, data: result.rows[0] });
    } else {
      res.json({ success: false, message: 'Payment settings not configured' });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch payment info' });
  }
});

const gameEngine = new GameEngine();
gameEngine.setIO(io);
app.locals.gameEngine = gameEngine;

const initGameSettings = async () => {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS game_settings (
        id INTEGER PRIMARY KEY DEFAULT 1,
        speed DECIMAL(10,4) NOT NULL DEFAULT 0.06,
        rtp DECIMAL(5,2) NOT NULL DEFAULT 94.00,
        low_crash_frequency DECIMAL(5,2) NOT NULL DEFAULT 25.00,
        high_multiplier_frequency DECIMAL(5,2) NOT NULL DEFAULT 2.00,
        CHECK (id = 1)
      )
    `);
    await query('ALTER TABLE game_settings ADD COLUMN IF NOT EXISTS rtp DECIMAL(5,2) DEFAULT 94.00').catch(() => {});
    await query('ALTER TABLE game_settings ADD COLUMN IF NOT EXISTS low_crash_frequency DECIMAL(5,2) DEFAULT 25.00').catch(() => {});
    await query('ALTER TABLE game_settings ADD COLUMN IF NOT EXISTS high_multiplier_frequency DECIMAL(5,2) DEFAULT 2.00').catch(() => {});
    await query('INSERT INTO game_settings (id, speed, rtp, low_crash_frequency, high_multiplier_frequency) VALUES (1, 0.06, 94.00, 25.00, 2.00) ON CONFLICT (id) DO NOTHING');
    const result = await query('SELECT speed, rtp, low_crash_frequency, high_multiplier_frequency FROM game_settings LIMIT 1');
    if (result.rows.length > 0) {
      const row = result.rows[0];
      const dbSpeed = parseFloat(row.speed);
      if (!isNaN(dbSpeed) && dbSpeed >= 0) {
        gameEngine.setSpeed(dbSpeed);
        console.log(`Game speed loaded from DB: ${dbSpeed}`);
      }
      const dbRtp = parseFloat(row.rtp);
      if (!isNaN(dbRtp) && dbRtp >= 80 && dbRtp <= 99) {
        gameEngine.setRtp(dbRtp);
        console.log(`RTP loaded from DB: ${dbRtp}%`);
      }
      const dbLowFreq = parseFloat(row.low_crash_frequency);
      if (!isNaN(dbLowFreq)) {
        gameEngine.setLowCrashFrequency(dbLowFreq);
      }
      const dbHighFreq = parseFloat(row.high_multiplier_frequency);
      if (!isNaN(dbHighFreq)) {
        gameEngine.setHighMultiplierFrequency(dbHighFreq);
      }
    }
  } catch (err) {
    console.error('Game settings init error:', err.message);
  }
};
initGameSettings();

gameEngine.startLoop();

io.on('connection', (socket) => {
  socket.emit('game:state', gameEngine.getState());
  socket.on('game:join', () => {
    socket.emit('game:state', gameEngine.getState());
  });
});

app.use((err, req, res, next) => {
  console.error('Server Error:', err);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    startKeepAlive();
  });
}

module.exports = app;
