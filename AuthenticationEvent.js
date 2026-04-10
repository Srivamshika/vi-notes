const mongoose = require('mongoose');

// Log authentication verification events
const authEventSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    sessionId: String,
    keystrokeMetrics: {
        avgKeystrokeTime: Number,
        stdDevKeystrokeTime: Number,
        avgPauseTime: Number,
        typingSpeed: Number,
        sampleSize: Number
    },
    deviceInfo: {
        deviceId: String,
        osType: String,
        timezone: String
    },
    verificationResult: {
        status: {
            type: String,
            enum: ['success', 'failed', 'challenge'],
            default: 'challenge'
        },
        confidenceScore: Number,
        modelPrediction: Number,
        matchPercentage: Number,
        flags: [String]
    },
    fallbackMethod: {
        type: String,
        enum: ['none', 'otp', 'email_link', 'security_question'],
        default: 'none'
    },
    fallbackStatus: String,
    timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('AuthenticationEvent', authEventSchema);
