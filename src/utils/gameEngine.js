const { query } = require('../config/database');
const { generateCrashPoint, generateRoundHash } = require('./helpers');

class GameEngine {
  constructor() {
    this.state = 'waiting';
    this.multiplier = 1.00;
    this.crashMultiplier = 1.00;
    this.currentRound = null;
    this.activeBets = new Map();
    this.userBets = new Map();
    this.roundHistory = [];
    this.timer = null;
    this.waitTimer = null;
    this.crashPoint = 1.00;
    this.speed = 0.06;
    this.startTime = null;
    this.waitingElapsed = 0;
    this.waitStart = null;
    this.io = null;
    this.countdownInterval = null;
    this.waitDuration = 20000;
    this.crashedBets = [];
    this.rtp = 94.00;
    this.lowCrashFrequency = 25.00;
    this.highMultiplierFrequency = 2.00;
    this.totalBetsAmount = 0;
    this.totalPayoutAmount = 0;
    this.roundsPlayed = 0;
    this.lowCrashRounds = 0;
    this.lastFakeWins = [];
  }

  setIO(io) {
    this.io = io;
  }

  emit(event, data) {
    if (this.io) this.io.emit(event, data);
  }

  startLoop() {
    this.startWaitingPeriod();
  }

  getRtpBias() {
    if (this.totalBetsAmount <= 0) return 0;
    const actualRtp = this.totalPayoutAmount / this.totalBetsAmount;
    const targetRtp = this.rtp / 100;
    if (actualRtp < targetRtp - 0.02) return -0.15;
    if (actualRtp < targetRtp - 0.01) return -0.08;
    if (actualRtp > targetRtp + 0.02) return 0.10;
    if (actualRtp > targetRtp + 0.01) return 0.05;
    return 0;
  }

  startWaitingPeriod() {
    this.state = 'waiting';
    this.multiplier = 1.00;
    const bias = this.getRtpBias();
    this.crashPoint = generateCrashPoint(bias);
    const hash = generateRoundHash(Date.now().toString());
    this.currentRound = { id: null, hash, crashMultiplier: this.crashPoint };
    this.activeBets.clear();
    this.userBets.clear();
    this.crashedBets = [];
    this.lastFakeWins = [];
    this.waitStart = Date.now();
    this.waitingElapsed = 0;

    if (this.countdownInterval) clearInterval(this.countdownInterval);
    this.countdownInterval = setInterval(() => {
      this.waitingElapsed = Date.now() - this.waitStart;
      this.emit('game:waiting', {
        countdown: Math.max(0, Math.ceil((this.waitDuration - this.waitingElapsed) / 1000)),
        crashPoint: this.crashPoint,
        roundHash: this.currentRound.hash
      });
    }, 200);

    if (this.waitTimer) clearTimeout(this.waitTimer);
    this.waitTimer = setTimeout(() => this.startFlying(), this.waitDuration);
  }

  async startFlying() {
    this.state = 'flying';
    this.multiplier = 1.00;
    this.startTime = Date.now();
    if (this.countdownInterval) clearInterval(this.countdownInterval);

    try {
      const result = await query(
        'INSERT INTO game_rounds (crash_multiplier, hash, status, started_at) VALUES ($1, $2, $3, NOW()) RETURNING id',
        [this.crashPoint, this.currentRound.hash, 'flying']
      );
      this.currentRound.id = result.rows[0].id;
    } catch (err) {
      console.error('Game round insert error:', err);
      this.currentRound.id = 'round-' + Date.now();
    }

    this.emit('game:started', {
      roundId: this.currentRound.id,
      crashPoint: this.crashPoint
    });

    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      const elapsed = (Date.now() - this.startTime) / 1000;
      this.multiplier = parseFloat(Math.pow(Math.E, this.speed * elapsed).toFixed(2));

      this.processAutoCashouts();

      if (this.multiplier >= this.crashPoint) {
        this.crash();
        return;
      }

      const highMultiplierAlerts = [];
      if (this.multiplier >= 5 && this.multiplier < 5.05) highMultiplierAlerts.push('glow');
      if (this.multiplier >= 10 && this.multiplier < 10.1) highMultiplierAlerts.push('gold');
      if (this.multiplier >= 25 && this.multiplier < 25.1) highMultiplierAlerts.push('lightning');
      if (this.multiplier >= 50 && this.multiplier < 50.5) highMultiplierAlerts.push('epic');

      this.emit('game:tick', {
        multiplier: this.multiplier,
        roundId: this.currentRound.id,
        activeBetCount: this.activeBets.size,
        alerts: highMultiplierAlerts.length > 0 ? highMultiplierAlerts : undefined
      });
    }, 50);
  }

  processAutoCashouts() {
    for (const [betKey, bet] of this.activeBets) {
      if (bet.status === 'pending' && bet.autoCashoutAt && this.multiplier >= bet.autoCashoutAt && this.multiplier < this.crashPoint) {
        this.settleBet(betKey, bet);
      }
    }
  }

  async settleBet(betKey, bet) {
    if (bet.status !== 'pending') return;
    const cashoutMultiplier = this.multiplier;
    const payout = parseFloat((bet.amount * cashoutMultiplier).toFixed(2));

    this.totalBetsAmount += bet.amount;
    this.totalPayoutAmount += payout;
    if (this.totalBetsAmount > 10000000) {
      this.totalBetsAmount *= 0.5;
      this.totalPayoutAmount *= 0.5;
    }

    try {
      const userResult = await query('SELECT balance FROM users WHERE id = $1', [bet.userId]);
      const oldBalance = parseFloat(userResult.rows[0].balance);
      const newBalance = oldBalance + payout;

      await query('UPDATE users SET balance = $1 WHERE id = $2', [newBalance, bet.userId]);
      await query(
        'UPDATE bets SET status = $1, cash_out_at = $2, payout = $3 WHERE id = $4',
        ['cashed_out', cashoutMultiplier, payout, bet.id]
      );
      await this.recordTransaction(bet.userId, 'bet_win', payout,
        `Auto cashed out at ${cashoutMultiplier}x - won ₹${payout}`, oldBalance, newBalance
      );

      bet.status = 'cashed_out';
      bet.cashOutAt = cashoutMultiplier;
      bet.payout = payout;

      this.emit('game:cashout', {
        userId: bet.userId,
        amount: bet.amount,
        payout,
        multiplier: cashoutMultiplier,
        auto: true
      });
    } catch (err) {
      console.error('Auto cashout error:', err);
    }
  }

  async crash() {
    this.state = 'crashed';
    if (this.timer) clearInterval(this.timer);
    const crashMult = this.multiplier;

    this.roundsPlayed++;
    if (this.crashPoint < 2) this.lowCrashRounds++;
    const actualLowFreq = this.roundsPlayed > 0 ? (this.lowCrashRounds / this.roundsPlayed) * 100 : 0;
    const targetLowFreq = this.lowCrashFrequency;

    // Track losses for RTP
    let roundBetsTotal = 0;
    let roundPayoutTotal = 0;

    try {
      await query(
        'UPDATE game_rounds SET status = $1, crashed_at = NOW() WHERE id = $2',
        ['crashed', this.currentRound.id]
      );
    } catch (err) {
      console.error('Game round update error:', err);
    }

    const fakeWins = [];
    const losers = [];
    for (const [betKey, bet] of this.activeBets) {
      if (bet.status === 'pending') {
        bet.status = 'lost';
        bet.payout = 0;
        roundBetsTotal += bet.amount;
        losers.push({ userId: bet.userId, amount: bet.amount });
        try {
          await query(
            'UPDATE bets SET status = $1, payout = $2 WHERE id = $3',
            ['lost', 0, bet.id]
          );
          await this.recordTransaction(bet.userId, 'bet_loss', bet.amount,
            `Bet lost - round crashed at ${crashMult}x`);
        } catch (err) {
          console.error('Bet settle error:', err);
        }
      } else if (bet.status === 'cashed_out') {
        roundBetsTotal += bet.amount;
        roundPayoutTotal += bet.payout;
      }
    }

    // Generate fake wins for excitement if crash is 5x+
    if (crashMult >= 5) {
      const fakeWinCount = crashMult >= 25 ? 2 : 1;
      for (let i = 0; i < fakeWinCount; i++) {
        const fakeNames = ['1***a', '2***b', '3***c', '4***d', '5***e', '6***f', '7***g', '8***h'];
        const name = fakeNames[Math.floor(Math.random() * fakeNames.length)];
        const betAmt = Math.round(100 + Math.random() * 5000);
        const winAmt = Math.round(betAmt * crashMult);
        fakeWins.push({ name, amount: winAmt, multiplier: crashMult, bet: betAmt });
      }
    }

    this.lastFakeWins = fakeWins;
    this.totalBetsAmount += roundBetsTotal;
    this.totalPayoutAmount += roundPayoutTotal;
    if (this.totalBetsAmount > 10000000) {
      this.totalBetsAmount *= 0.5;
      this.totalPayoutAmount *= 0.5;
    }

    this.roundHistory.unshift({
      id: this.currentRound.id,
      crashMultiplier: this.crashPoint,
      hash: this.currentRound.hash,
      status: 'crashed'
    });
    if (this.roundHistory.length > 50) this.roundHistory.pop();

    this.emit('game:crashed', {
      crashMultiplier: crashMult,
      roundId: this.currentRound.id,
      roundHash: this.currentRound.hash,
      losers,
      fakeWins
    });

    this.emit('game:state', this.getState());

    setTimeout(() => this.startWaitingPeriod(), 4000);
  }

  async placeBet(userId, amount, autoCashoutAt = null) {
    if (this.state !== 'waiting') {
      throw new Error('Game not accepting bets');
    }

    const userResult = await query('SELECT balance FROM users WHERE id = $1', [userId]);
    if (userResult.rows.length === 0) throw new Error('User not found');
    if (parseFloat(userResult.rows[0].balance) < amount) throw new Error('Insufficient balance');
    if (amount < 10) throw new Error('Minimum bet is ₹10');

    const userBetKeys = this.userBets.get(userId) || [];
    if (userBetKeys.length >= 1) throw new Error('Maximum 1 bet per round');

    const gameRoundId = this.currentRound ? this.currentRound.id || (await query(
      'SELECT id FROM game_rounds ORDER BY created_at DESC LIMIT 1'
    )).rows[0]?.id : null;

    if (!gameRoundId) throw new Error('No active game round');

    const newBalance = parseFloat(userResult.rows[0].balance) - amount;
    await query('UPDATE users SET balance = $1 WHERE id = $2', [newBalance, userId]);

    const betResult = await query(
      'INSERT INTO bets (user_id, round_id, amount, status) VALUES ($1, $2, $3, $4) RETURNING id',
      [userId, gameRoundId, amount, 'pending']
    );

    await this.recordTransaction(userId, 'bet', amount,
      `Bet placed - ₹${amount}`, parseFloat(userResult.rows[0].balance), newBalance);

    const betKey = `${userId}-${betResult.rows[0].id}`;
    const bet = {
      id: betResult.rows[0].id,
      userId,
      amount,
      status: 'pending',
      cashOutAt: null,
      payout: null,
      roundId: gameRoundId,
      autoCashoutAt: autoCashoutAt
    };

    this.activeBets.set(betKey, bet);
    userBetKeys.push(betKey);
    this.userBets.set(userId, userBetKeys);

    this.emit('game:bet', {
      userId,
      amount,
      betId: bet.id,
      autoCashoutAt
    });

    return { betId: bet.id, balance: newBalance };
  }

  async cashOut(userId, betId = null) {
    if (this.state !== 'flying') throw new Error('Game is not flying');
    if (this.multiplier >= this.crashPoint) throw new Error('Game has already crashed');

    const userBetKeys = this.userBets.get(userId) || [];
    let targetKey = null;

    if (betId) {
      targetKey = `${userId}-${betId}`;
    } else {
      for (const key of userBetKeys) {
        const bet = this.activeBets.get(key);
        if (bet && bet.status === 'pending') {
          targetKey = key;
          break;
        }
      }
    }

    if (!targetKey || !this.activeBets.has(targetKey)) throw new Error('No active bet found');
    const bet = this.activeBets.get(targetKey);
    if (bet.status !== 'pending') throw new Error('Bet already settled');

    const cashoutMultiplier = this.multiplier;
    const payout = parseFloat((bet.amount * cashoutMultiplier).toFixed(2));

    const userResult = await query('SELECT balance FROM users WHERE id = $1', [userId]);
    const oldBalance = parseFloat(userResult.rows[0].balance);
    const newBalance = oldBalance + payout;

    await query('UPDATE users SET balance = $1 WHERE id = $2', [newBalance, userId]);
    await query(
      'UPDATE bets SET status = $1, cash_out_at = $2, payout = $3 WHERE id = $4',
      ['cashed_out', cashoutMultiplier, payout, bet.id]
    );
    await this.recordTransaction(userId, 'bet_win', payout,
      `Cashed out at ${cashoutMultiplier}x - won ₹${payout}`, oldBalance, newBalance);

    bet.status = 'cashed_out';
    bet.cashOutAt = cashoutMultiplier;
    bet.payout = payout;

    this.emit('game:cashout', {
      userId,
      betId: bet.id,
      amount: bet.amount,
      payout,
      multiplier: cashoutMultiplier,
      auto: false
    });

    return { payout, cashoutMultiplier, balance: newBalance };
  }

  async recordTransaction(userId, type, amount, description, balanceBefore = null, balanceAfter = null) {
    try {
      if (balanceBefore === null || balanceAfter === null) {
        const result = await query('SELECT balance FROM users WHERE id = $1', [userId]);
        const currentBalance = parseFloat(result.rows[0]?.balance || 0);
        balanceBefore = currentBalance;
        balanceAfter = currentBalance;
      }
      await query(
        'INSERT INTO transactions (user_id, type, amount, description, balance_before, balance_after) VALUES ($1, $2, $3, $4, $5, $6)',
        [userId, type, amount, description, balanceBefore, balanceAfter]
      );
    } catch (err) {
      console.error('Transaction record error:', err);
    }
  }

  getState() {
    return {
      state: this.state,
      multiplier: this.multiplier,
      crashMultiplier: this.crashPoint,
      speed: this.speed,
      rtp: this.rtp,
      roundId: this.currentRound?.id || null,
      roundHash: this.currentRound?.hash || null,
      countdown: this.waitStart ? Math.max(0, Math.ceil((this.waitDuration - (Date.now() - this.waitStart)) / 1000)) : 0,
      activeBetCount: this.activeBets.size,
      history: this.roundHistory.slice(0, 20),
      fakeWins: this.lastFakeWins
    };
  }

  setSpeed(newSpeed) {
    this.speed = newSpeed;
  }

  setRtp(newRtp) {
    this.rtp = newRtp;
  }

  setLowCrashFrequency(freq) {
    this.lowCrashFrequency = freq;
  }

  setHighMultiplierFrequency(freq) {
    this.highMultiplierFrequency = freq;
  }

  getActiveBetsCount() {
    return this.activeBets.size;
  }
}

module.exports = { GameEngine };
