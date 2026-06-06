require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { query } = require('./database');

const createTables = async () => {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        full_name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        mobile VARCHAR(20) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        balance DECIMAL(12,2) DEFAULT 0,
        referral_code VARCHAR(50) UNIQUE NOT NULL DEFAULT gen_random_uuid(),
        referred_by VARCHAR(50),
        referral_earnings DECIMAL(12,2) DEFAULT 0,
        total_referrals INTEGER DEFAULT 0,
        is_banned BOOLEAN DEFAULT false,
        is_admin BOOLEAN DEFAULT false,
        daily_bonus_claimed BOOLEAN DEFAULT false,
        last_daily_bonus TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS bank_accounts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        holder_name VARCHAR(255) NOT NULL,
        account_number VARCHAR(50) NOT NULL,
        ifsc_code VARCHAR(20) NOT NULL,
        bank_name VARCHAR(255) NOT NULL,
        upi_id VARCHAR(100),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS deposits (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        amount DECIMAL(12,2) NOT NULL,
        utr VARCHAR(100),
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS withdrawals (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        amount DECIMAL(12,2) NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS game_rounds (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        crash_multiplier DECIMAL(10,2) NOT NULL,
        hash VARCHAR(255) NOT NULL,
        status VARCHAR(20) DEFAULT 'waiting',
        started_at TIMESTAMP,
        crashed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS bets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        round_id UUID REFERENCES game_rounds(id),
        amount DECIMAL(12,2) NOT NULL,
        cash_out_at DECIMAL(10,2),
        payout DECIMAL(12,2),
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS referrals (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        parent_id UUID REFERENCES users(id) ON DELETE CASCADE,
        child_id UUID REFERENCES users(id) ON DELETE CASCADE,
        bonus DECIMAL(12,2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        type VARCHAR(50) NOT NULL,
        amount DECIMAL(12,2) NOT NULL,
        description TEXT,
        balance_before DECIMAL(12,2),
        balance_after DECIMAL(12,2),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS admins (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        username VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(50) DEFAULT 'admin',
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS payment_settings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        upi_id VARCHAR(100) NOT NULL,
        qr_code TEXT
      );
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS game_settings (
        id INTEGER PRIMARY KEY DEFAULT 1,
        speed DECIMAL(10,4) NOT NULL DEFAULT 0.06,
        CHECK (id = 1)
      );
    `);

    await query(`
      INSERT INTO game_settings (id, speed) VALUES (1, 0.06)
      ON CONFLICT (id) DO NOTHING;
    `);

    await query(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_users_mobile ON users(mobile);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_deposits_status ON deposits(status);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_bets_round_id ON bets(round_id);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_bets_user_id ON bets(user_id);`);
    await query(`CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);`);

    await query(`ALTER TABLE deposits ADD COLUMN IF NOT EXISTS utr VARCHAR(100);`).catch(() => {});
    console.log('All tables created successfully');
    process.exit(0);
  } catch (err) {
    console.error('Error creating tables:', err);
    process.exit(1);
  }
};

createTables();
