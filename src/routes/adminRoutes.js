const router = require('express').Router();
const { login, getDashboard, getUsers, banUser, editBalance, getPaymentSettings, updatePaymentSettings, updateReferralBonus, getGameSettings, updateGameSettings } = require('../controllers/adminController');
const { adminAuth } = require('../middleware/auth');

router.post('/login', login);
router.get('/dashboard', adminAuth, getDashboard);
router.get('/users', adminAuth, getUsers);
router.put('/users/:id/ban', adminAuth, banUser);
router.put('/users/:id/balance', adminAuth, editBalance);
router.get('/payment-settings', adminAuth, getPaymentSettings);
router.put('/payment-settings', adminAuth, updatePaymentSettings);
router.put('/referral-bonus', adminAuth, updateReferralBonus);
router.get('/game-settings', adminAuth, getGameSettings);
router.put('/game-settings', adminAuth, updateGameSettings);

module.exports = router;
