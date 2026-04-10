const mongoose = require('mongoose');

// Real-time session trust score tracking
const sessionTrustScoreSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    textSessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Text' },
    
    scoreHistory: [{
        timestamp: Date,
        score: Number,
        factors: {
            keystrokeBehavior: Number,
            pasteDetection: Number,
            aiLikelihood: Number,
            anomalyScore: Number,
            devicesConsistency: Number
        }
    }],
    
    currentScore: Number,
    riskLevel: { type: String, enum: ['low', 'medium', 'high'] },
    
    warnings: [{
        timestamp: Date,
        message: String,
        severity: String
    }],
    
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('SessionTrustScore', sessionTrustScoreSchema);
