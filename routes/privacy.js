const express = require('express');
const router = express.Router();
const EncryptionManager = require('../utils/encryption');
const EncryptedKeystrokeData = require('../models/EncryptedKeystrokeData');
const { requireAuth } = require('../utils/auth');

function hasValidAdminKey(candidateKey) {
    return Boolean(process.env.ADMIN_KEY && candidateKey && candidateKey === process.env.ADMIN_KEY);
}

// Store encrypted keystroke data
router.post('/privacy/encrypt-keystroke', async (req, res) => {
    try {
        const { userId, sessionId, keystrokeData } = req.body;
        
        const encryptionManager = new EncryptionManager(process.env.ENCRYPTION_KEY);
        
        const encrypted = encryptionManager.encrypt(keystrokeData);
        const anonymized = EncryptionManager.anonymize(keystrokeData);
        
        const encData = new EncryptedKeystrokeData({
            userId,
            sessionId,
            encryptedData: encrypted,
            anonymizedMetrics: {
                avgKeystrokeTime: anonymized.avgKeystrokeTime || keystrokeData.avgKeystrokeTime,
                stdDevKeystrokeTime: anonymized.stdDevKeystrokeTime || keystrokeData.stdDevKeystrokeTime,
                pauseFrequency: (keystrokeData.pauseIntervals?.length || 0)
            },
            encryptionTimestamp: new Date()
        });
        
        await encData.save();
        
        res.json({
            message: 'Data encrypted and stored securely',
            encryptedId: encData._id
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Retrieve decrypted keystroke data (admin only)
router.get('/privacy/decrypt/:encryptedId', async (req, res) => {
    try {
        // Check authorization (this should be admin-only)
        if (!hasValidAdminKey(req.query.adminKey)) {
            return res.status(403).json({ message: 'Unauthorized' });
        }
        
        const encData = await EncryptedKeystrokeData.findById(req.params.encryptedId);
        
        if (!encData) {
            return res.status(404).json({ message: 'Encrypted data not found' });
        }
        
        const encryptionManager = new EncryptionManager(process.env.ENCRYPTION_KEY);
        
        const decrypted = encryptionManager.decrypt(encData.encryptedData);
        
        res.json({
            decryptedData: decrypted,
            decryptedAt: new Date()
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get anonymized metrics (no decryption needed)
router.get('/privacy/anonymized/:sessionId', async (req, res) => {
    try {
        const encData = await EncryptedKeystrokeData.findOne({ sessionId: req.params.sessionId });
        
        if (!encData) {
            return res.status(404).json({ message: 'No data found' });
        }
        
        res.json({
            anonymizedMetrics: encData.anonymizedMetrics,
            timestamp: encData.encryptionTimestamp
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// User consent management
router.post('/privacy/consent/:userId', async (req, res) => {
    try {
        const { consentGiven } = req.body;
        
        const updated = await EncryptedKeystrokeData.updateMany(
            { userId: req.params.userId },
            { userConsent: consentGiven }
        );
        
        res.json({
            message: `Consent updated: ${consentGiven ? 'given' : 'revoked'}`,
            updatedCount: updated.modifiedCount
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete user's encrypted data (GDPR right to be forgotten)
router.delete('/privacy/delete-user/:userId', requireAuth, async (req, res) => {
    try {
        // Verify ownership
        if (req.userId !== req.params.userId && !hasValidAdminKey(req.query.adminKey)) {
            return res.status(403).json({ message: 'Unauthorized' });
        }
        
        const deleted = await EncryptedKeystrokeData.deleteMany({ userId: req.params.userId });
        
        res.json({
            message: 'All encrypted keystroke data deleted',
            deletedCount: deleted.deletedCount
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get privacy status
router.get('/privacy/status/:userId', async (req, res) => {
    try {
        const data = await EncryptedKeystrokeData.findOne({ userId: req.params.userId })
            .select('dataEncryptionEnabled userConsent encryptionTimestamp')
            .lean();
        
        res.json({
            encryptionEnabled: data?.dataEncryptionEnabled || false,
            userConsent: data?.userConsent || false,
            lastEncrypted: data?.encryptionTimestamp
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
