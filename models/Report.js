const mongoose = require('mongoose');
const crypto = require('crypto');

// Generate and manage shareable verification reports
const reportSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    textSessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Text' },
    
    reportContent: {
        title: String,
        summary: String,
        trustScore: Number,
        analysisDate: Date,
        findings: [{
            category: String,
            result: String,
            confidence: Number
        }]
    },
    
    sharingToken: { type: String, unique: true },
    isPublic: { type: Boolean, default: false },
    expiresAt: Date,
    accessControl: {
        allowVerification: { type: Boolean, default: true },
        restrictedViewers: [String]
    },
    
    viewCount: { type: Number, default: 0 },
    viewLog: [{
        timestamp: Date,
        viewerIP: String
    }],
    
    createdAt: { type: Date, default: Date.now }
});

// Auto-generate secure token before saving
reportSchema.pre('save', function() {
    if (!this.sharingToken) {
        this.sharingToken = crypto.randomBytes(32).toString('hex');
    }
});

module.exports = mongoose.model('Report', reportSchema);
