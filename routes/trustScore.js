const express = require('express');
const router = express.Router();
const SessionTrustScore = require('../models/SessionTrustScore');

// Calculate real-time trust score
router.post('/trust-score/calculate', async (req, res) => {
    try {
        const { userId, sessionId, sessionMetrics, recentAnalysis } = req.body;
        
        const keystrokeBehaviorScore = calculateKeystrokeBehavior(sessionMetrics);
        const pasteDetectionScore = recentAnalysis?.pasteConfidence || 0;
        const aiLikelihoodScore = recentAnalysis?.aiConfidenceScore || 0;
        const anomalyScore = calculateAnomalyScore(sessionMetrics);
        const deviceConsistencyScore = calculateDeviceConsistency(sessionMetrics.deviceInfo);
        
        const weights = {
            keystroke: 0.25,
            paste: 0.20,
            ai: 0.20,
            anomaly: 0.20,
            device: 0.15
        };
        
        const trustScore = 
            keystrokeBehaviorScore * weights.keystroke +
            (100 - pasteDetectionScore) * weights.paste +
            (100 - aiLikelihoodScore) * weights.ai +
            (100 - anomalyScore) * weights.anomaly +
            deviceConsistencyScore * weights.device;
        
        let riskLevel = 'low';
        if (trustScore < 50) riskLevel = 'high';
        else if (trustScore < 75) riskLevel = 'medium';
        
        let scoreDoc = await SessionTrustScore.findOne({ textSessionId: sessionId });
        if (!scoreDoc) {
            scoreDoc = new SessionTrustScore({ userId, textSessionId: sessionId });
        }
        
        scoreDoc.scoreHistory.push({
            timestamp: new Date(),
            score: Math.round(trustScore),
            factors: {
                keystrokeBehavior: keystrokeBehaviorScore,
                pasteDetection: 100 - pasteDetectionScore,
                aiLikelihood: 100 - aiLikelihoodScore,
                anomalyScore: 100 - anomalyScore,
                devicesConsistency: deviceConsistencyScore
            }
        });
        
        scoreDoc.currentScore = Math.round(trustScore);
        scoreDoc.riskLevel = riskLevel;
        
        await scoreDoc.save();
        
        res.json({
            trustScore: Math.round(trustScore),
            riskLevel,
            factors: {
                keystrokeBehavior: keystrokeBehaviorScore,
                pasteDetection: 100 - pasteDetectionScore,
                aiLikelihood: 100 - aiLikelihoodScore,
                anomalyScore: 100 - anomalyScore,
                devicesConsistency: deviceConsistencyScore
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get trust score history
router.get('/trust-score/history/:sessionId', async (req, res) => {
    try {
        const scoreDoc = await SessionTrustScore.findOne({ textSessionId: req.params.sessionId });
        
        if (!scoreDoc) {
            return res.json({ scoreHistory: [] });
        }
        
        res.json({
            currentScore: scoreDoc.currentScore,
            riskLevel: scoreDoc.riskLevel,
            scoreHistory: scoreDoc.scoreHistory
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Helper: Calculate keystroke behavior score
function calculateKeystrokeBehavior(metrics) {
    const baselineAvg = metrics.baselineAvgKeystrokeTime || 100;
    const baselineStdDev = metrics.baselineStdDev || 30;
    
    const diff = Math.abs(metrics.avgKeystrokeTime - baselineAvg);
    const score = Math.max(0, 100 - (diff / baselineAvg) * 100);
    
    return Math.round(score);
}

// Helper: Calculate anomaly score (scaled 0-100)
function calculateAnomalyScore(metrics) {
    // Placeholder: Would integrate with ML model
    const isAnomaly = metrics.isAnomalous ? 50 : 0;
    return Math.min(100, Math.max(0, isAnomaly));
}

// Helper: Calculate device consistency
function calculateDeviceConsistency(deviceInfo) {
    // Check if device is known/expected
    // Placeholder: Would check historical devices
    return 100;  // Default: assume known device
}

module.exports = router;
