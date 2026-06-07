const crypto = require('crypto');

const generateReferralCode = () => {
  return 'PHP' + crypto.randomBytes(4).toString('hex').toUpperCase();
};

const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

const generateRoundHash = (seed) => {
  return crypto.createHash('sha256').update(seed + Date.now()).digest('hex');
};

const generateCrashPoint = (rtpBias = 0) => {
  const hash = crypto.createHash('sha256').update(Date.now().toString() + Math.random()).digest('hex');
  const decimal = parseInt(hash.slice(0, 13), 16) / Math.pow(16, 13);

  let roll = Math.random();
  roll = Math.max(0, Math.min(1, roll - rtpBias * 0.15));

  let crashPoint;
  if (roll < 0.25) {
    crashPoint = 1 + decimal * 1.0;
  } else if (roll < 0.65) {
    crashPoint = 2 + decimal * 3.0;
  } else if (roll < 0.90) {
    crashPoint = 5 + decimal * 10.0;
  } else if (roll < 0.98) {
    crashPoint = 15 + decimal * 35.0;
  } else {
    crashPoint = 50 + decimal * 450.0;
  }

  return Math.floor(Math.max(1.01, crashPoint) * 100) / 100;
};

const formatAmount = (amount) => {
  return parseFloat(amount).toFixed(2);
};

module.exports = { generateReferralCode, generateOTP, generateRoundHash, generateCrashPoint, formatAmount };
