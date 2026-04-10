const mongoose = require('mongoose');

// Track device profiles and typing behavior per device
const deviceProfileSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    deviceId: String,
    
    deviceInfo: {
        osType: String,
        browserAgent: String,
        screenResolution: String,
        timezone: String,
        inputMethod: String
    },
    
    behaviorProfile: {
        avgKeystrokeTime: Number,
        typingSpeed: Number,
        errorRate: Number,
        pasteFrequency: Number
    },
    
    trustScore: { type: Number, default: 100 },
    isKnownDevice: { type: Boolean, default: false },
    
    firstSeen: Date,
    lastSeen: Date,
    
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('DeviceProfile', deviceProfileSchema);
