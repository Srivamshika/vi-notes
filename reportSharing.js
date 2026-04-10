const express = require('express');
const router = express.Router();
const Report = require('../models/Report');
const Text = require('../models/Text');

// Generate shareable report
router.post('/report/generate', async (req, res) => {
    try {
        const { userId, sessionId, findings } = req.body;
        
        const session = await Text.findById(sessionId);
        
        if (!session) {
            return res.status(404).json({ message: 'Session not found' });
        }
        
        const report = new Report({
            userId,
            textSessionId: sessionId,
            reportContent: {
                title: `Authenticity Report - ${new Date().toLocaleDateString()}`,
                summary: `Analysis of "${session.content.slice(0, 50)}..."`,
                trustScore: findings.trustScore || 0,
                analysisDate: new Date(),
                findings: findings.findings || []
            },
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)  // 30 days
        });
        
        await report.save();
        
        const frontendUrl = process.env.FRONTEND_URL || `http://localhost:${process.env.PORT || 3000}`;
        const shareUrl = `${frontendUrl}/verify/${report.sharingToken}`;
        
        res.json({
            reportId: report._id,
            sharingLink: shareUrl,
            token: report.sharingToken,
            expiresAt: report.expiresAt
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// View shared report
router.get('/report/verify/:token', async (req, res) => {
    try {
        const report = await Report.findOne({ sharingToken: req.params.token });
        
        if (!report) {
            return res.status(404).json({ message: 'Report not found' });
        }
        
        if (report.expiresAt && report.expiresAt < new Date()) {
            return res.status(410).json({ message: 'Report has expired' });
        }
        
        // Check access restrictions
        if (report.accessControl?.restrictedViewers && report.accessControl.restrictedViewers.length > 0) {
            const viewerEmail = req.query.email;
            if (!report.accessControl.restrictedViewers.includes(viewerEmail)) {
                return res.status(403).json({ message: 'Access denied' });
            }
        }
        
        // Log view
        report.viewCount = (report.viewCount || 0) + 1;
        report.viewLog = report.viewLog || [];
        report.viewLog.push({
            timestamp: new Date(),
            viewerIP: req.ip
        });
        await report.save();
        
        // Return report without sensitive data if not authorized
        const reportData = {
            reportContent: report.reportContent,
            createdAt: report.createdAt,
            expiresAt: report.expiresAt,
            sharingToken: report.sharingToken
        };
        
        res.json(reportData);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get report details (authenticated)
router.get('/report/:reportId', async (req, res) => {
    try {
        const report = await Report.findById(req.params.reportId);
        
        if (!report) {
            return res.status(404).json({ message: 'Report not found' });
        }
        
        res.json(report);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update sharing settings
router.put('/report/:reportId/sharing', async (req, res) => {
    try {
        const { isPublic, restrictedViewers, expiresAt } = req.body;

        const report = await Report.findById(req.params.reportId);
        if (!report) {
            return res.status(404).json({ message: 'Report not found' });
        }

        if (typeof isPublic === 'boolean') {
            report.isPublic = isPublic;
        }

        if (Array.isArray(restrictedViewers)) {
            report.accessControl = report.accessControl || {};
            report.accessControl.restrictedViewers = restrictedViewers;
        }

        if (expiresAt !== undefined) {
            report.expiresAt = expiresAt ? new Date(expiresAt) : null;
        }

        await report.save();
        
        res.json({ message: 'Sharing settings updated', report });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Revoke report sharing
router.post('/report/:reportId/revoke', async (req, res) => {
    try {
        await Report.findByIdAndDelete(req.params.reportId);
        res.json({ message: 'Report access revoked' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get report list for user
router.get('/reports/user/:userId', async (req, res) => {
    try {
        const reports = await Report.find({ userId: req.params.userId })
            .select('reportContent sharingToken expiresAt createdAt viewCount')
            .lean();
        
        res.json({ reports });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
