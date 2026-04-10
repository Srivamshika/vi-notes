const mongoose = require('mongoose');

// Store encrypted keystroke data for privacy
const encryptedKeystrokeSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Text' },
    
    encryptedData: {
        iv: String,
        encryptedData: String,
        authTag: String
    },
    
    anonymizedMetrics: {
        avgKeystrokeTime: Number,
        stdDevKeystrokeTime: Number,
        pauseFrequency: Number
    },
    
    encryptionTimestamp: Date,
    dataEncryptionEnabled: { type: Boolean, default: true },
    userConsent: { type: Boolean, default: true },
    
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('EncryptedKeystrokeData', encryptedKeystrokeSchema);
