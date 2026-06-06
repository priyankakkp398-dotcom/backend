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
const { GameEngine } = require('./utils/gameEngine');
const { query } = require('./config/database');

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
  cors: corsOptions
});

const PORT = process.env.PORT || 5000;

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

query('SELECT speed FROM game_settings LIMIT 1').then(result => {
  if (result.rows.length > 0) {
    const dbSpeed = parseFloat(result.rows[0].speed);
    if (!isNaN(dbSpeed) && dbSpeed >= 0) {
      gameEngine.setSpeed(dbSpeed);
      console.log(`Game speed loaded from DB: ${dbSpeed}`);
    }
  }
}).catch(err => console.error('Failed to load game speed from DB:', err));

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
  });
}

module.exports = app;
