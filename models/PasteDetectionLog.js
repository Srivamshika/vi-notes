const mongoose = require('mongoose');

// Track paste and AI-generated content detection
const pasteDetectionLogSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    textSessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Text' },
    
    detectionResults: [{
        segmentId: String,
        startPosition: Number,
        endPosition: Number,
        segmentText: String,
        keystrokeAnalysis: {
            hasKeystrokeIntervals: Boolean,
            isInstantAppearance: Boolean,
            uniformityScore: Number,
            variationCv: Number,
            expectedIntervals: Number,
            actualIntervals: Number
        },
        linguisticMarkers: {
            vocabularyShift: Number,
            sentenceComplexity: Number,
            punctuationConsistency: Number,
            grammarAnomalies: [String]
        },
        aiConfidenceScore: Number,
        pasteConfidenceScore: Number,
        verdict: {
            type: String,
            enum: ['human_typed', 'pasted', 'ai_generated', 'uncertain'],
            default: 'uncertain'
        },
        flags: [String]
    }],
    
    summaryAnalysis: {
        totalSegments: Number,
        pastedSegments: Number,
        aiSegments: Number,
        mixedContentDetected: Boolean,
        suspicionLevel: {
            type: String,
            enum: ['low', 'medium', 'high'],
            default: 'low'
        }
    },
    
    timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('PasteDetectionLog', pasteDetectionLogSchema);
