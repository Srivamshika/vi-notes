const mongoose = require('mongoose');

// Track keystroke profiles for behavioral authentication
const biometricProfileSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    baselineMetrics: {
        avgKeystrokeTime: Number,
        stdDevKeystrokeTime: Number,
        avgPauseTime: Number,
        typingSpeed: Number,
        deletionRate: Number,
        rhythmPattern: [Number]
    },
    deviceSignature: {
        keyboardType: String,
        osType: String,
        browserAgent: String,
        screenResolution: String,
        timezone: String
    },
    status: {
        type: String,
        enum: ['collecting_baseline', 'active', 'suspended'],
        default: 'collecting_baseline'
    },
    baselineSessionsCount: { type: Number, default: 0 },
    baselineRequired: { type: Number, default: 5 },
    failureCount: { type: Number, default: 0 },
    lastVerificationFailed: Date,
    createdAt: { type: Date, default: Date.now },
    lastUpdated: { type: Date, default: Date.now }
});

module.exports = mongoose.model('BiometricProfile', biometricProfileSchema);
