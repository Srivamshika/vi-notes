const express = require('express');
const router = express.Router();
const WritingVersion = require('../models/WritingVersion');

// Record keystroke for replay
router.post('/version/record-keystroke', async (req, res) => {
    try {
        const { userId, sessionId, keystrokeEvent } = req.body;
        
        let version = await WritingVersion.findOne({ textSessionId: sessionId });
        if (!version) {
            version = new WritingVersion({
                userId,
                textSessionId: sessionId,
                keystrokeReplay: []
            });
        }
        
        version.keystrokeReplay.push({
            timestamp: keystrokeEvent.timestamp,
            type: keystrokeEvent.type,
            character: keystrokeEvent.character,
            text: String(keystrokeEvent.text || '').slice(0, 500),
            position: keystrokeEvent.position,
            interval: keystrokeEvent.interval
        });
        
        // Save version snapshot every 50 keystrokes
        if (version.keystrokeReplay.length % 50 === 0) {
            version.versions = version.versions || [];
            version.versions.push({
                versionNumber: version.versions.length + 1,
                timestamp: new Date(),
                content: keystrokeEvent.currentContent || '',
                characterCount: keystrokeEvent.currentContent?.length || 0,
                changesSinceLast: {
                    inserted: 50,
                    deleted: 0,
                    modified: 0
                }
            });
        }
        
        await version.save();
        res.json({ saved: true, keystrokeCount: version.keystrokeReplay.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get keystroke replay data
router.get('/version/replay/:sessionId', async (req, res) => {
    try {
        const version = await WritingVersion.findOne({ textSessionId: req.params.sessionId });
        
        if (!version) {
            return res.json({ keystrokeReplay: [] });
        }
        
        res.json({
            keystrokeReplay: version.keystrokeReplay,
            versions: version.versions || []
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get versions list
router.get('/version/versions/:sessionId', async (req, res) => {
    try {
        const version = await WritingVersion.findOne({ textSessionId: req.params.sessionId });
        
        res.json({
            versions: version?.versions || []
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Restore to specific version
router.post('/version/restore/:sessionId/:versionNumber', async (req, res) => {
    try {
        const version = await WritingVersion.findOne({ textSessionId: req.params.sessionId });
        
        if (!version) {
            return res.status(404).json({ message: 'Version not found' });
        }
        
        const targetVersion = version.versions.find(v => v.versionNumber === parseInt(req.params.versionNumber));
        
        if (!targetVersion) {
            return res.status(404).json({ message: 'Version number not found' });
        }
        
        res.json({
            restoredContent: targetVersion.content,
            versionTimestamp: targetVersion.timestamp
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
