const express = require('express');
const router = express.Router();
const PasteDetectionLog = require('../models/PasteDetectionLog');

// Analyze text session for paste/AI injection
router.post('/detect-paste-injection', async (req, res) => {
    try {
        const { keystrokeData, contentText, sessionId, userId } = req.body;
        
        const segments = segmentContent(contentText);
        const detectionResults = [];
        
        for (const segment of segments) {
            const analysis = analyzeSegment(
                segment,
                keystrokeData,
                contentText
            );
            detectionResults.push(analysis);
        }
        
        const summary = calculateSummary(detectionResults);
        
        const log = new PasteDetectionLog({
            userId,
            textSessionId: sessionId,
            detectionResults,
            summaryAnalysis: summary
        });
        
        await log.save();
        
        res.json({
            sessionId,
            analysis: detectionResults,
            summary,
            overallVerdict: summary.suspicionLevel,
            recommendations: generateRecommendations(summary)
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Real-time paste detection
router.post('/detect-live-paste', async (req, res) => {
    try {
        const { recentText, keystrokeIntervals, previousContent } = req.body;
        
        const isInstantAppearance = detectInstantAppearance(
            recentText,
            keystrokeIntervals
        );
        
        if (isInstantAppearance) {
            return res.json({
                pasteDetected: true,
                confidence: 95,
                message: "Text appears to be pasted",
                flag: 'instant_appearance',
                action: 'highlight_segment'
            });
        }
        
        const uniformityScore = calculateUniformity(keystrokeIntervals);
        
        if (uniformityScore > 85) {
            return res.json({
                aiLikelyDetected: true,
                uniformityScore,
                confidence: 70,
                message: "Text shows highly uniform typing pattern (possible AI)",
                flag: 'uniform_keystroke',
                action: 'flag_for_review'
            });
        }
        
        res.json({
            pasteDetected: false,
            aiLikelyDetected: false,
            confidence: 95,
            message: "Text appears human-typed"
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Helper: Detect instant appearance
function detectInstantAppearance(newText, keystrokeIntervals) {
    const textLength = newText.length;
    const expectedIntervals = textLength - 1;
    const missingIntervals = expectedIntervals - keystrokeIntervals.length;
    
    return missingIntervals > expectedIntervals * 0.5;
}

// Helper: Calculate keystroke uniformity
function calculateUniformity(intervals) {
    if (intervals.length < 3) return 0;
    
    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const variance = intervals.reduce((sum, val) => 
        sum + Math.pow(val - mean, 2), 0) / intervals.length;
    const stdDev = Math.sqrt(variance);
    
    const cv = (stdDev / mean) * 100;
    return Math.max(0, 100 - cv * 2);
}

// Helper: Segment content
function segmentContent(text) {
    return text.split(/[.!?]\s+/).map((seg, idx, arr) => {
        if (idx < arr.length - 1) {
            return seg + '.';
        }
        return seg;
    }).filter(seg => seg.trim().length > 0);
}

// Helper: Analyze single segment
function analyzeSegment(segment, keystrokeData, fullText) {
    const startPos = fullText.indexOf(segment);
    const endPos = startPos + segment.length;
    
    const segmentKeystrokes = keystrokeData.intervals.filter(k =>
        k.position >= startPos && k.position <= endPos
    );
    
    const isInstant = detectInstantAppearance(segment, segmentKeystrokes);
    const uniformity = calculateUniformity(
        segmentKeystrokes.map(k => k.interval)
    );
    
    const linguisticMarkers = analyzeLinguistics(segment);
    const aiConfidence = calculateAIConfidence(
        uniformity,
        linguisticMarkers,
        segmentKeystrokes.length
    );
    
    const pasteConfidence = isInstant ? 90 : 10;
    
    let verdict = 'human_typed';
    let flags = [];
    
    if (isInstant) {
        verdict = 'pasted';
        flags.push('instant_appearance');
    } else if (aiConfidence > 80) {
        verdict = 'ai_generated';
        flags.push('uniform_typing', 'linguistic_markers');
    } else if (uniformity > 85) {
        verdict = 'uncertain';
        flags.push('high_uniformity');
    }
    
    if (linguisticMarkers.grammarAnomalies.length > 0) {
        flags.push('grammar_anomaly');
    }
    
    return {
        segmentId: `seg_${startPos}_${endPos}`,
        startPosition: startPos,
        endPosition: endPos,
        segmentText: segment,
        keystrokeAnalysis: {
            hasKeystrokeIntervals: segmentKeystrokes.length > 0,
            isInstantAppearance: isInstant,
            uniformityScore: uniformity,
            variationCv: segmentKeystrokes.length > 0 ? 
                (Math.sqrt(
                    segmentKeystrokes.reduce((sum, k) => sum + Math.pow(k.interval, 2), 0) /
                    segmentKeystrokes.length
                ) / (segmentKeystrokes.reduce((a, b) => a + b.interval, 0) / segmentKeystrokes.length)) * 100
                : 0,
            expectedIntervals: segment.length - 1,
            actualIntervals: segmentKeystrokes.length
        },
        linguisticMarkers,
        aiConfidenceScore: aiConfidence,
        pasteConfidenceScore: pasteConfidence,
        verdict,
        flags
    };
}

// Helper: Analyze linguistic features
function analyzeLinguistics(text) {
    const sentences = text.split(/[.!?]/).filter(s => s.trim());
    const words = text.toLowerCase().split(/\s+/);
    const uniqueWords = new Set(words).size;
    const vocabularyDiversity = (uniqueWords / words.length) * 100;
    
    const avgCharsPerSentence = text.length / (sentences.length || 1);
    const punctuationCount = (text.match(/[.!?,;:-]/g) || []).length;
    const punctuationConsistency = (punctuationCount / words.length) * 100;
    
    const aiMarkers = [
        'furthermore', 'moreover', 'in addition', 'consequently',
        'undoubtedly', 'certainly', 'undeniably', 'appears to be'
    ];
    
    const grammarAnomalies = [];
    aiMarkers.forEach(marker => {
        if (text.toLowerCase().includes(marker)) {
            grammarAnomalies.push(`AI_marker: ${marker}`);
        }
    });
    
    return {
        vocabularyShift: 100 - vocabularyDiversity,
        sentenceComplexity: Math.round(avgCharsPerSentence),
        punctuationConsistency: Math.round(punctuationConsistency),
        grammarAnomalies
    };
}

// Helper: Calculate AI confidence
function calculateAIConfidence(uniformity, linguistic, keystrokeCount) {
    const weights = {
        uniformity: 0.4,
        linguistic: 0.3,
        keystrokeCount: 0.3
    };
    
    let uniformityScore = uniformity;
    const linguisticAnomalies = linguistic.grammarAnomalies.length;
    const linguisticScore = (linguisticAnomalies / 5) * 100;
    const keystrokeScore = keystrokeCount < 20 ? 50 : Math.max(0, 100 - keystrokeCount / 2);
    
    const aiConfidence = 
        uniformityScore * weights.uniformity +
        linguisticScore * weights.linguistic +
        keystrokeScore * weights.keystrokeCount;
    
    return Math.round(Math.min(100, aiConfidence));
}

// Helper: Calculate summary
function calculateSummary(results) {
    const pastedCount = results.filter(r => r.verdict === 'pasted').length;
    const aiCount = results.filter(r => r.verdict === 'ai_generated').length;
    
    const totalSegments = results.length;
    const mixedContent = (pastedCount + aiCount) > 0 && totalSegments > (pastedCount + aiCount);
    
    let suspicionLevel = 'low';
    if (pastedCount + aiCount > totalSegments * 0.5) {
        suspicionLevel = 'high';
    } else if (pastedCount + aiCount > totalSegments * 0.2) {
        suspicionLevel = 'medium';
    }
    
    return {
        totalSegments,
        pastedSegments: pastedCount,
        aiSegments: aiCount,
        mixedContentDetected: mixedContent,
        suspicionLevel
    };
}

// Helper: Generate recommendations
function generateRecommendations(summary) {
    const recs = [];
    
    if (summary.suspicionLevel === 'high') {
        recs.push('⚠️ High suspicion of non-human content');
        recs.push('Recommend manual review');
        recs.push('Consider requiring re-submission');
    } else if (summary.suspicionLevel === 'medium') {
        recs.push('⚠️ Some segments show questionable patterns');
        recs.push('Review highlighted segments');
        recs.push('May require clarification from author');
    } else {
        recs.push('✓ Content appears naturally authored');
    }
    
    return recs;
}

module.exports = router;
