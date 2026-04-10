const express = require('express');
const router = express.Router();
const BiometricProfile = require('../models/BiometricProfile');
const AuthenticationEvent = require('../models/AuthenticationEvent');
const { requireAuth } = require('../utils/auth');

// 1. Initialize biometric profile
router.post('/biometrics/init', async (req, res) => {
    try {
        const { userId } = req.body;
        
        let profile = await BiometricProfile.findOne({ userId });
        if (profile) {
            return res.status(400).json({ message: 'Profile already exists' });
        }
        
        profile = new BiometricProfile({
            userId,
            status: 'collecting_baseline'
        });
        
        await profile.save();
        
        res.json({
            message: 'Biometric profile initialized',
            profileId: profile._id,
            mode: 'baseline_collection'
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. Record baseline keystroke sample
router.post('/biometrics/baseline-sample', async (req, res) => {
    try {
        const { userId, keystrokeMetrics, deviceInfo } = req.body;
        
        const profile = await BiometricProfile.findOne({ userId });
        if (!profile) {
            return res.status(404).json({ message: 'Profile not found' });
        }
        
        if (profile.status !== 'collecting_baseline') {
            return res.status(400).json({ message: 'Not in baseline collection mode' });
        }
        
        const metrics = {
            avgKeystrokeTime: keystrokeMetrics.avgKeystrokeTime,
            stdDevKeystrokeTime: keystrokeMetrics.stdDevKeystrokeTime,
            avgPauseTime: keystrokeMetrics.avgPauseTime,
            typingSpeed: keystrokeMetrics.typingSpeed,
            deletionRate: keystrokeMetrics.deletionRate
        };
        
        const rhythmPattern = calculateRhythmPattern(keystrokeMetrics.intervalArray || []);
        
        // Update baseline with exponential moving average
        if (profile.baselineSessionsCount === 0) {
            profile.baselineMetrics = { ...metrics, rhythmPattern };
        } else {
            const alpha = 0.3;  // EMA smoothing factor
            profile.baselineMetrics.avgKeystrokeTime = 
                (1 - alpha) * profile.baselineMetrics.avgKeystrokeTime + 
                alpha * metrics.avgKeystrokeTime;
            
            profile.baselineMetrics.stdDevKeystrokeTime =
                (1 - alpha) * profile.baselineMetrics.stdDevKeystrokeTime +
                alpha * metrics.stdDevKeystrokeTime;
            
            profile.baselineMetrics.typingSpeed =
                (1 - alpha) * profile.baselineMetrics.typingSpeed +
                alpha * metrics.typingSpeed;
        }
        
        profile.baselineSessionsCount += 1;
        
        if (profile.baselineSessionsCount === 1) {
            profile.deviceSignature = deviceInfo;
        }
        
        // Activate after sufficient baseline
        if (profile.baselineSessionsCount >= profile.baselineRequired) {
            profile.status = 'active';
        }
        
        profile.lastUpdated = new Date();
        await profile.save();
        
        res.json({
            message: 'Baseline sample recorded',
            sessionsCollected: profile.baselineSessionsCount,
            sessionsRequired: profile.baselineRequired,
            profileStatus: profile.status
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 3. Verify biometric on login
router.post('/biometrics/verify', async (req, res) => {
    try {
        const { userId, keystrokeMetrics, deviceInfo, sessionId } = req.body;
        
        const profile = await BiometricProfile.findOne({ userId });
        
        if (!profile || profile.status !== 'active') {
            return res.json({
                status: 'not_ready',
                message: 'Biometric verification not yet active'
            });
        }
        
        const isNewDevice = deviceInfo.deviceId !== profile.deviceSignature?.deviceId;
        const verificationScore = calculateBiometricMatch(
            keystrokeMetrics,
            profile.baselineMetrics,
            isNewDevice
        );
        
        const threshold = 75;
        let verdict = 'success';
        let flags = [];
        
        if (verificationScore < threshold) {
            verdict = isNewDevice ? 'challenge' : 'failed';
            if (isNewDevice) flags.push('new_device');
            if (Math.abs(keystrokeMetrics.typingSpeed - profile.baselineMetrics.typingSpeed) > 
                profile.baselineMetrics.stdDevKeystrokeTime * 2) {
                flags.push('keystroke_anomaly');
            }
        }
        
        const authEvent = new AuthenticationEvent({
            userId,
            sessionId,
            keystrokeMetrics: {
                avgKeystrokeTime: keystrokeMetrics.avgKeystrokeTime,
                stdDevKeystrokeTime: keystrokeMetrics.stdDevKeystrokeTime,
                avgPauseTime: keystrokeMetrics.avgPauseTime,
                typingSpeed: keystrokeMetrics.typingSpeed,
                sampleSize: keystrokeMetrics.sampleSize
            },
            deviceInfo,
            verificationResult: {
                status: verdict,
                confidenceScore: verificationScore,
                matchPercentage: verificationScore,
                flags
            }
        });
        
        if (verdict === 'success') {
            profile.failureCount = 0;
        } else {
            profile.failureCount += 1;
            profile.lastVerificationFailed = new Date();
            
            if (profile.failureCount >= 3) {
                profile.status = 'suspended';
            }
        }
        
        profile.lastUpdated = new Date();
        await profile.save();
        await authEvent.save();
        
        res.json({
            status: verdict,
            confidenceScore: verificationScore,
            flags,
            requiresFallback: verdict !== 'success',
            fallbackMethods: verdict !== 'success' ? ['otp', 'email_link'] : []
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 4. Get biometric profile status
router.get('/biometrics/status', requireAuth, async (req, res) => {
    try {
        const profile = await BiometricProfile.findOne({ userId: req.userId });
        
        if (!profile) {
            return res.json({
                message: 'No biometric profile',
                initialized: false
            });
        }
        
        res.json({
            initialized: true,
            status: profile.status,
            baselineSessionsCollected: profile.baselineSessionsCount,
            baselineSessionsRequired: profile.baselineRequired,
            failureCount: profile.failureCount,
            lastVerificationFailed: profile.lastVerificationFailed
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Helper: Calculate biometric match score
function calculateBiometricMatch(current, baseline, isNewDevice) {
    const weights = {
        keystrokeTime: 0.35,
        typingSpeed: 0.25,
        pauseTime: 0.20,
        variance: 0.15,
        deviceBonus: 0.05
    };
    
    let score = 0;
    
    // Keystroke timing comparison
    const keystrokeScore = calculateSimilarityScore(
        current.avgKeystrokeTime,
        baseline.avgKeystrokeTime
    );
    score += keystrokeScore * weights.keystrokeTime;
    
    // Typing speed comparison
    const speedScore = calculateSimilarityScore(
        current.typingSpeed,
        baseline.typingSpeed
    );
    score += speedScore * weights.typingSpeed;
    
    // Pause time comparison
    const pauseScore = calculateSimilarityScore(
        current.avgPauseTime,
        baseline.avgPauseTime
    );
    score += pauseScore * weights.pauseTime;
    
    // Variance comparison
    const varScore = calculateSimilarityScore(
        current.stdDevKeystrokeTime,
        baseline.stdDevKeystrokeTime
    );
    score += varScore * weights.variance;
    
    // Device consistency bonus
    if (!isNewDevice) {
        score += weights.deviceBonus * 100;
    }
    
    return Math.round(Math.min(100, Math.max(0, score)));
}

// Helper: Calculate rhythm pattern
function calculateSimilarityScore(currentValue, baselineValue) {
    if (!Number.isFinite(currentValue) || !Number.isFinite(baselineValue) || baselineValue <= 0) {
        return 0;
    }

    const diff = Math.abs(currentValue - baselineValue);
    return Math.max(0, 100 - (diff / baselineValue) * 100);
}

function calculateRhythmPattern(intervals) {
    if (!intervals || intervals.length === 0) return [0, 0, 0, 0, 0];
    
    const max = Math.max(...intervals);
    if (max === 0) return [0, 0, 0, 0, 0];
    
    const normalized = intervals.map(i => i / max);
    const buckets = [0, 0, 0, 0, 0];
    
    normalized.forEach(val => {
        const bucketIdx = Math.min(4, Math.floor(val * 5));
        buckets[bucketIdx]++;
    });
    
    return buckets;
}

module.exports = router;
