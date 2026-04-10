const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const DeviceProfile = require('../models/DeviceProfile');

// Register device
router.post('/device/register', async (req, res) => {
    try {
        const { userId, deviceInfo } = req.body;
        const deviceId = generateDeviceFingerprint(deviceInfo);
        
        let profile = await DeviceProfile.findOne({ userId, deviceId });
        
        if (!profile) {
            profile = new DeviceProfile({
                userId,
                deviceId,
                deviceInfo,
                firstSeen: new Date(),
                isKnownDevice: false
            });
        }
        
        profile.lastSeen = new Date();
        await profile.save();
        
        res.json({
            deviceId,
            isNewDevice: !profile.isKnownDevice,
            trustScore: profile.trustScore
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Verify device consistency
router.post('/device/verify-consistency', async (req, res) => {
    try {
        const { userId, currentDeviceInfo, behaviorMetrics } = req.body;
        const userDevices = await DeviceProfile.find({ userId });
        
        if (userDevices.length === 0) {
            return res.json({ consistent: true, consistency: 100 });
        }
        
        const avgBehavior = calculateAverageBehavior(userDevices);
        const consistency = calculateConsistency(behaviorMetrics, avgBehavior);
        
        res.json({
            consistency,
            isConsistent: consistency > 70,
            deviceCount: userDevices.length
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get all devices for user
router.get('/device/list/:userId', async (req, res) => {
    try {
        const devices = await DeviceProfile.find({ userId: req.params.userId })
            .select('deviceId deviceInfo trustScore firstSeen lastSeen')
            .lean();
        
        res.json({ devices });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Mark device as trusted
router.post('/device/:deviceId/trust', async (req, res) => {
    try {
        const device = await DeviceProfile.findOneAndUpdate(
            { deviceId: req.params.deviceId },
            { isKnownDevice: true, trustScore: 100 },
            { new: true }
        );
        
        res.json({ message: 'Device marked as trusted', device });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Helper: Generate device fingerprint
function generateDeviceFingerprint(deviceInfo) {
    const data = JSON.stringify({
        osType: deviceInfo.osType,
        browserAgent: deviceInfo.browserAgent,
        screenResolution: deviceInfo.screenResolution,
        timezone: deviceInfo.timezone
    });
    
    return crypto.createHash('sha256').update(data).digest('hex').slice(0, 16);
}

// Helper: Calculate average behavior across devices
function calculateAverageBehavior(devices) {
    const avgKeystrokeTime = devices.reduce((sum, d) => 
        sum + (d.behaviorProfile?.avgKeystrokeTime || 100), 0
    ) / devices.length;
    
    const avgTypingSpeed = devices.reduce((sum, d) =>
        sum + (d.behaviorProfile?.typingSpeed || 5), 0
    ) / devices.length;
    
    return { avgKeystrokeTime, avgTypingSpeed };
}

// Helper: Calculate consistency score
function calculateConsistency(current, avg) {
    const keystrokeDiff = Math.abs(current.avgKeystrokeTime - avg.avgKeystrokeTime);
    const keystrokeScore = Math.max(0, 100 - (keystrokeDiff / avg.avgKeystrokeTime) * 100);
    
    const speedDiff = Math.abs(current.typingSpeed - avg.avgTypingSpeed);
    const speedScore = Math.max(0, 100 - (speedDiff / avg.avgTypingSpeed) * 100);
    
    return Math.round((keystrokeScore + speedScore) / 2);
}

module.exports = router;
