const mongoose = require('mongoose');

const textSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    content: String,
    startTime: Date,
    endTime: Date,
    duration: Number,
    pasteCount: Number,
    pastedTextLength: Number,
    totalKeystrokes: Number,
    sessionMetrics: {
        avgKeystrokeTime: Number,
        stdDevKeystrokeTime: Number,
        avgPauseTime: Number,
        longestPause: Number,
        pauseCount: Number,
        deletionCount: Number,
        focusLossCount: Number,
        revisionCount: Number,
        typingSpeed: Number,
        errorRate: Number,
        pasteRatio: Number,
        sampleSize: Number,
        rhythmPattern: [Number]
    },
    linguisticMetrics: {
        wordCount: Number,
        sentenceCount: Number,
        paragraphCount: Number,
        vocabularyDiversity: Number,
        averageSentenceLength: Number
    },
    deviceSnapshot: {
        deviceId: String,
        osType: String,
        browserAgent: String,
        screenResolution: String,
        timezone: String,
        inputMethod: String
    },
    analysisSummary: {
        pasteVerdict: String,
        aiVerdict: String,
        trustScore: Number,
        riskLevel: String,
        biometricStatus: String,
        deviceTrustScore: Number,
        reportToken: String
    },
    artifactRefs: {
        authenticationEventId: String,
        deviceProfileId: String,
        biometricProfileId: String,
        pasteLogId: String,
        writingVersionId: String,
        encryptedTelemetryId: String,
        trustScoreId: String,
        reportId: String
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
    
});

module.exports = mongoose.model('Text', textSchema);
