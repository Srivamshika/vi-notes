const mongoose = require('mongoose');

// Track writing versions and keystroke replay data
const writingVersionSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    textSessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Text' },
    
    versions: [{
        versionNumber: Number,
        timestamp: Date,
        content: String,
        characterCount: Number,
        changesSinceLast: {
            inserted: Number,
            deleted: Number,
            modified: Number
        }
    }],
    
    keystrokeReplay: [{
        timestamp: Number,
        type: { type: String, enum: ['keystroke', 'delete', 'paste'] },
        character: String,
        text: String,
        position: Number,
        interval: Number
    }],
    
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('WritingVersion', writingVersionSchema);
