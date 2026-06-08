const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { register, login, forgotPassword, resetPassword, changePassword } = require('../controllers/authController');
const { auth } = require('../middleware/auth');
const { validateRegister } = require('../middleware/validate');

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, message: 'Too many attempts. Try again later.' },
  validate: { xForwardedForHeader: false }
});

router.post('/register', authLimiter, validateRegister, register);
router.post('/login', authLimiter, login);
router.post('/forgot-password', authLimiter, forgotPassword);
router.post('/reset-password', authLimiter, resetPassword);
router.post('/change-password', auth, changePassword);

module.exports = router;
