const AuthenticationEvent = require('../models/AuthenticationEvent');
const BiometricProfile = require('../models/BiometricProfile');
const DeviceProfile = require('../models/DeviceProfile');
const EncryptedKeystrokeData = require('../models/EncryptedKeystrokeData');
const PasteDetectionLog = require('../models/PasteDetectionLog');
const Report = require('../models/Report');
const SessionTrustScore = require('../models/SessionTrustScore');
const WritingVersion = require('../models/WritingVersion');

const EncryptionManager = require('./encryption');

function toNumber(value, fallback = 0) {
    return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function round(value, digits = 2) {
    const factor = 10 ** digits;
    return Math.round(toNumber(value) * factor) / factor;
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, toNumber(value)));
}

function average(values) {
    if (!Array.isArray(values) || values.length === 0) {
        return 0;
    }

    return values.reduce((sum, value) => sum + toNumber(value), 0) / values.length;
}

function standardDeviation(values) {
    if (!Array.isArray(values) || values.length === 0) {
        return 0;
    }

    const mean = average(values);
    const variance = average(values.map((value) => (toNumber(value) - mean) ** 2));
    return Math.sqrt(variance);
}

function normalizeText(text) {
    return typeof text === 'string' ? text : '';
}

function normalizeTelemetry(telemetry = {}) {
    const intervals = Array.isArray(telemetry.intervals)
        ? telemetry.intervals.map((value) => clamp(value, 0, 60000)).filter((value) => value > 0)
        : [];

    const pauseIntervals = Array.isArray(telemetry.pauseIntervals)
        ? telemetry.pauseIntervals.map((value) => clamp(value, 0, 60000)).filter((value) => value > 0)
        : [];

    const pastedSegments = Array.isArray(telemetry.pastedSegments)
        ? telemetry.pastedSegments.map((segment, index) => ({
            startPosition: toNumber(segment.startPosition),
            endPosition: toNumber(segment.endPosition),
            text: normalizeText(segment.text).slice(0, 180),
            length: toNumber(segment.length, normalizeText(segment.text).length),
            timestamp: segment.timestamp || new Date().toISOString(),
            segmentId: `paste_${index + 1}`
        }))
        : [];

    const keystrokeEvents = Array.isArray(telemetry.keystrokeEvents)
        ? telemetry.keystrokeEvents.slice(-400).map((event) => ({
            timestamp: toNumber(event.timestamp, Date.now()),
            type: ['keystroke', 'delete', 'paste'].includes(event.type) ? event.type : 'keystroke',
            character: normalizeText(event.character).slice(0, 20) || '[Key]',
            text: normalizeText(event.text).slice(0, 500),
            position: toNumber(event.position),
            interval: toNumber(event.interval)
        }))
        : [];

    const versionHistory = Array.isArray(telemetry.versionHistory)
        ? telemetry.versionHistory.slice(-20).map((version, index) => ({
            versionNumber: toNumber(version.versionNumber, index + 1),
            timestamp: version.timestamp || new Date().toISOString(),
            reason: normalizeText(version.reason) || 'typing',
            content: normalizeText(version.content),
            characterCount: toNumber(version.characterCount, normalizeText(version.content).length),
            changesSinceLast: {
                inserted: toNumber(version.changesSinceLast?.inserted),
                deleted: toNumber(version.changesSinceLast?.deleted),
                modified: toNumber(version.changesSinceLast?.modified)
            }
        }))
        : [];

    const rawDeviceInfo = telemetry.deviceInfo || {};

    return {
        intervals,
        pauseIntervals,
        deleteCount: toNumber(telemetry.deleteCount),
        focusLossCount: toNumber(telemetry.focusLossCount),
        pastedSegments,
        keystrokeEvents,
        versionHistory,
        deviceInfo: {
            osType: normalizeText(rawDeviceInfo.osType) || 'Unknown',
            browserAgent: normalizeText(rawDeviceInfo.browserAgent) || 'Unknown',
            screenResolution: normalizeText(rawDeviceInfo.screenResolution) || 'Unknown',
            timezone: normalizeText(rawDeviceInfo.timezone) || 'Unknown',
            inputMethod: normalizeText(rawDeviceInfo.inputMethod) || 'keyboard',
            language: normalizeText(rawDeviceInfo.language) || 'Unknown'
        }
    };
}

function buildDeviceSnapshot(deviceInfo) {
    const baseDeviceInfo = {
        osType: deviceInfo.osType,
        browserAgent: deviceInfo.browserAgent,
        screenResolution: deviceInfo.screenResolution,
        timezone: deviceInfo.timezone,
        inputMethod: deviceInfo.inputMethod
    };

    return {
        deviceId: EncryptionManager.hashDeviceFingerprint(baseDeviceInfo).slice(0, 16),
        ...baseDeviceInfo
    };
}

function buildRhythmPattern(intervals) {
    if (!intervals.length) {
        return [0, 0, 0, 0, 0];
    }

    const maxValue = Math.max(...intervals);
    if (!maxValue) {
        return [0, 0, 0, 0, 0];
    }

    const buckets = [0, 0, 0, 0, 0];

    intervals.forEach((interval) => {
        const bucketIndex = Math.min(4, Math.floor((interval / maxValue) * 5));
        buckets[bucketIndex] += 1;
    });

    return buckets;
}

function buildLinguisticMetrics(content) {
    const safeContent = normalizeText(content);
    const words = safeContent.match(/\b[\w'-]+\b/g) || [];
    const sentences = safeContent
        .split(/[.!?]+/)
        .map((value) => value.trim())
        .filter(Boolean);
    const paragraphs = safeContent
        .split(/\n+/)
        .map((value) => value.trim())
        .filter(Boolean);
    const uniqueWords = new Set(words.map((word) => word.toLowerCase()));

    return {
        wordCount: words.length,
        sentenceCount: sentences.length,
        paragraphCount: paragraphs.length || (safeContent ? 1 : 0),
        vocabularyDiversity: round(words.length ? (uniqueWords.size / words.length) * 100 : 0),
        averageSentenceLength: round(sentences.length ? words.length / sentences.length : 0)
    };
}

function buildSessionMetrics(content, duration, totalKeystrokes, pasteCount, telemetry, linguisticMetrics) {
    const avgKeystrokeTime = round(average(telemetry.intervals));
    const stdDevKeystrokeTime = round(standardDeviation(telemetry.intervals));
    const avgPauseTime = round(average(telemetry.pauseIntervals));
    const longestPause = round(Math.max(0, ...telemetry.pauseIntervals));
    const typingSpeed = round(duration > 0 ? (linguisticMetrics.wordCount / duration) * 60 : 0);

    return {
        avgKeystrokeTime,
        stdDevKeystrokeTime,
        avgPauseTime,
        longestPause,
        pauseCount: telemetry.pauseIntervals.length,
        deletionCount: telemetry.deleteCount,
        focusLossCount: telemetry.focusLossCount,
        revisionCount: telemetry.versionHistory.length,
        typingSpeed,
        errorRate: round(totalKeystrokes > 0 ? (telemetry.deleteCount / totalKeystrokes) * 100 : 0),
        pasteCount,
        pasteRatio: round(content.length ? (pasteCount / Math.max(1, content.length)) * 100 : 0),
        rhythmPattern: buildRhythmPattern(telemetry.intervals),
        sampleSize: telemetry.intervals.length
    };
}

function buildLinguisticMarkers(text) {
    const safeText = normalizeText(text);
    const metrics = buildLinguisticMetrics(safeText);
    const punctuationCount = (safeText.match(/[.!?,;:]/g) || []).length;
    const aiMarkers = [
        'furthermore',
        'moreover',
        'in conclusion',
        'in summary',
        'additionally',
        'overall'
    ];

    return {
        vocabularyShift: round(100 - metrics.vocabularyDiversity),
        sentenceComplexity: round(metrics.averageSentenceLength),
        punctuationConsistency: round(metrics.wordCount ? (punctuationCount / metrics.wordCount) * 100 : 0),
        grammarAnomalies: aiMarkers
            .filter((marker) => safeText.toLowerCase().includes(marker))
            .map((marker) => `marker:${marker}`)
    };
}

function buildUniformityScore(intervals) {
    if (!intervals.length) {
        return 0;
    }

    const mean = average(intervals);
    if (!mean) {
        return 0;
    }

    const coefficientOfVariation = standardDeviation(intervals) / mean;
    return round(clamp(100 - coefficientOfVariation * 100, 0, 100));
}

function buildPasteAnalysis(content, telemetry, sessionMetrics, linguisticMetrics) {
    const safeContent = normalizeText(content);
    const uniformityScore = buildUniformityScore(telemetry.intervals);
    const baseAiConfidence = round(clamp(
        uniformityScore * 0.45 +
        (sessionMetrics.pauseCount === 0 ? 20 : 0) +
        (sessionMetrics.deletionCount <= 1 ? 12 : 0) +
        (linguisticMetrics.vocabularyDiversity < 45 ? 12 : 0),
        0,
        100
    ));

    const detectionResults = telemetry.pastedSegments.map((segment) => {
        const segmentText = segment.text || safeContent.slice(segment.startPosition, segment.endPosition);

        return {
            segmentId: segment.segmentId,
            startPosition: segment.startPosition,
            endPosition: segment.endPosition,
            segmentText,
            keystrokeAnalysis: {
                hasKeystrokeIntervals: false,
                isInstantAppearance: true,
                uniformityScore,
                variationCv: round(
                    sessionMetrics.avgKeystrokeTime
                        ? sessionMetrics.stdDevKeystrokeTime / sessionMetrics.avgKeystrokeTime
                        : 0
                ),
                expectedIntervals: Math.max(0, segment.length - 1),
                actualIntervals: 0
            },
            linguisticMarkers: buildLinguisticMarkers(segmentText),
            aiConfidenceScore: round(clamp(baseAiConfidence + (segment.length > 80 ? 10 : 0), 0, 100)),
            pasteConfidenceScore: round(clamp(75 + segment.length * 0.4, 0, 100)),
            verdict: 'pasted',
            flags: ['clipboard_insert', ...(segment.length > 80 ? ['long_paste'] : [])]
        };
    });

    if (!detectionResults.length && safeContent) {
        const verdict = baseAiConfidence >= 70 ? 'ai_generated' : baseAiConfidence >= 50 ? 'uncertain' : 'human_typed';

        detectionResults.push({
            segmentId: 'full_text',
            startPosition: 0,
            endPosition: safeContent.length,
            segmentText: safeContent.slice(0, 240),
            keystrokeAnalysis: {
                hasKeystrokeIntervals: telemetry.intervals.length > 0,
                isInstantAppearance: false,
                uniformityScore,
                variationCv: round(
                    sessionMetrics.avgKeystrokeTime
                        ? sessionMetrics.stdDevKeystrokeTime / sessionMetrics.avgKeystrokeTime
                        : 0
                ),
                expectedIntervals: Math.max(0, safeContent.length - 1),
                actualIntervals: telemetry.intervals.length
            },
            linguisticMarkers: buildLinguisticMarkers(safeContent),
            aiConfidenceScore: baseAiConfidence,
            pasteConfidenceScore: 0,
            verdict,
            flags: verdict === 'ai_generated' ? ['uniform_typing_pattern'] : []
        });
    }

    const pastedSegments = detectionResults.filter((result) => result.verdict === 'pasted').length;
    const aiSegments = detectionResults.filter((result) => result.verdict === 'ai_generated').length;
    const suspiciousSegments = detectionResults.filter((result) => ['pasted', 'ai_generated', 'uncertain'].includes(result.verdict)).length;
    const suspicionRatio = detectionResults.length ? suspiciousSegments / detectionResults.length : 0;

    return {
        detectionResults,
        summaryAnalysis: {
            totalSegments: detectionResults.length,
            pastedSegments,
            aiSegments,
            mixedContentDetected: pastedSegments > 0 && safeContent.length > 0,
            suspicionLevel: suspicionRatio >= 0.6 || pastedSegments > 0
                ? 'high'
                : suspicionRatio >= 0.3
                    ? 'medium'
                    : 'low'
        },
        overallAiConfidence: baseAiConfidence
    };
}

function calculateSimilarityScore(currentValue, baselineValue) {
    if (!baselineValue) {
        return 100;
    }

    const difference = Math.abs(toNumber(currentValue) - toNumber(baselineValue));
    return round(clamp(100 - (difference / Math.max(1, baselineValue)) * 100, 0, 100));
}

function buildDeviceConsistencyScore(sessionMetrics, profiles) {
    if (!profiles.length) {
        return 100;
    }

    const avgKeystrokeTime = average(
        profiles.map((profile) => profile.behaviorProfile?.avgKeystrokeTime || sessionMetrics.avgKeystrokeTime)
    );
    const avgTypingSpeed = average(
        profiles.map((profile) => profile.behaviorProfile?.typingSpeed || sessionMetrics.typingSpeed)
    );

    return round(
        (
            calculateSimilarityScore(sessionMetrics.avgKeystrokeTime, avgKeystrokeTime) +
            calculateSimilarityScore(sessionMetrics.typingSpeed, avgTypingSpeed)
        ) / 2
    );
}

async function upsertDeviceProfile(userId, deviceSnapshot, sessionMetrics, pasteCount) {
    const userProfiles = await DeviceProfile.find({ userId });
    const consistencyScore = buildDeviceConsistencyScore(sessionMetrics, userProfiles);
    const existingProfile = userProfiles.find((profile) => profile.deviceId === deviceSnapshot.deviceId);

    const deviceInfo = {
        osType: deviceSnapshot.osType,
        browserAgent: deviceSnapshot.browserAgent,
        screenResolution: deviceSnapshot.screenResolution,
        timezone: deviceSnapshot.timezone,
        inputMethod: deviceSnapshot.inputMethod
    };

    const behaviorProfile = existingProfile
        ? {
            avgKeystrokeTime: round(average([existingProfile.behaviorProfile?.avgKeystrokeTime, sessionMetrics.avgKeystrokeTime])),
            typingSpeed: round(average([existingProfile.behaviorProfile?.typingSpeed, sessionMetrics.typingSpeed])),
            errorRate: round(average([existingProfile.behaviorProfile?.errorRate, sessionMetrics.errorRate])),
            pasteFrequency: round(average([existingProfile.behaviorProfile?.pasteFrequency, pasteCount]))
        }
        : {
            avgKeystrokeTime: sessionMetrics.avgKeystrokeTime,
            typingSpeed: sessionMetrics.typingSpeed,
            errorRate: sessionMetrics.errorRate,
            pasteFrequency: pasteCount
        };

    const profile = existingProfile || new DeviceProfile({
        userId,
        deviceId: deviceSnapshot.deviceId,
        firstSeen: new Date()
    });

    profile.deviceInfo = deviceInfo;
    profile.behaviorProfile = behaviorProfile;
    profile.trustScore = existingProfile ? round(average([profile.trustScore, consistencyScore])) : (userProfiles.length ? consistencyScore : 100);
    profile.isKnownDevice = Boolean(existingProfile || userProfiles.length === 0);
    profile.lastSeen = new Date();

    await profile.save();

    return {
        profileId: String(profile._id),
        deviceId: profile.deviceId,
        trustScore: round(profile.trustScore),
        consistencyScore,
        isKnownDevice: profile.isKnownDevice
    };
}

function getBiometricDeviceKey(deviceSnapshot) {
    return [
        deviceSnapshot.osType,
        deviceSnapshot.browserAgent,
        deviceSnapshot.screenResolution,
        deviceSnapshot.timezone
    ].join('|');
}

async function upsertBiometricProfile(userId, deviceSnapshot, sessionMetrics) {
    const currentMetrics = {
        avgKeystrokeTime: sessionMetrics.avgKeystrokeTime,
        stdDevKeystrokeTime: sessionMetrics.stdDevKeystrokeTime,
        avgPauseTime: sessionMetrics.avgPauseTime,
        typingSpeed: sessionMetrics.typingSpeed,
        deletionRate: sessionMetrics.errorRate,
        rhythmPattern: sessionMetrics.rhythmPattern
    };

    let profile = await BiometricProfile.findOne({ userId });

    if (!profile) {
        profile = new BiometricProfile({
            userId,
            baselineMetrics: currentMetrics,
            deviceSignature: {
                keyboardType: deviceSnapshot.inputMethod,
                osType: deviceSnapshot.osType,
                browserAgent: deviceSnapshot.browserAgent,
                screenResolution: deviceSnapshot.screenResolution,
                timezone: deviceSnapshot.timezone
            },
            baselineRequired: 3,
            baselineSessionsCount: 1,
            status: 'collecting_baseline',
            lastUpdated: new Date()
        });

        await profile.save();

        return {
            profileId: String(profile._id),
            profileStatus: profile.status,
            verificationStatus: 'success',
            verificationScore: 100,
            flags: ['baseline_started']
        };
    }

    const baseline = profile.baselineMetrics || {};
    const verificationScore = round(average([
        calculateSimilarityScore(sessionMetrics.avgKeystrokeTime, baseline.avgKeystrokeTime),
        calculateSimilarityScore(sessionMetrics.stdDevKeystrokeTime, baseline.stdDevKeystrokeTime),
        calculateSimilarityScore(sessionMetrics.avgPauseTime, baseline.avgPauseTime),
        calculateSimilarityScore(sessionMetrics.typingSpeed, baseline.typingSpeed)
    ]));

    const previousDeviceKey = [
        profile.deviceSignature?.osType,
        profile.deviceSignature?.browserAgent,
        profile.deviceSignature?.screenResolution,
        profile.deviceSignature?.timezone
    ].join('|');
    const currentDeviceKey = getBiometricDeviceKey(deviceSnapshot);
    const flags = [];

    if (previousDeviceKey && previousDeviceKey !== currentDeviceKey) {
        flags.push('new_device_signature');
    }

    if (verificationScore < 60) {
        flags.push('behavior_shift');
    }

    const verificationStatus = verificationScore < 55
        ? 'failed'
        : verificationScore < 75
            ? 'challenge'
            : 'success';

    const alpha = 0.35;
    profile.baselineMetrics = {
        avgKeystrokeTime: round((1 - alpha) * toNumber(baseline.avgKeystrokeTime, currentMetrics.avgKeystrokeTime) + alpha * currentMetrics.avgKeystrokeTime),
        stdDevKeystrokeTime: round((1 - alpha) * toNumber(baseline.stdDevKeystrokeTime, currentMetrics.stdDevKeystrokeTime) + alpha * currentMetrics.stdDevKeystrokeTime),
        avgPauseTime: round((1 - alpha) * toNumber(baseline.avgPauseTime, currentMetrics.avgPauseTime) + alpha * currentMetrics.avgPauseTime),
        typingSpeed: round((1 - alpha) * toNumber(baseline.typingSpeed, currentMetrics.typingSpeed) + alpha * currentMetrics.typingSpeed),
        deletionRate: round((1 - alpha) * toNumber(baseline.deletionRate, currentMetrics.deletionRate) + alpha * currentMetrics.deletionRate),
        rhythmPattern: currentMetrics.rhythmPattern
    };
    profile.baselineSessionsCount += 1;
    profile.status = profile.baselineSessionsCount >= profile.baselineRequired ? 'active' : profile.status;
    profile.failureCount = verificationStatus === 'failed' ? profile.failureCount + 1 : 0;
    profile.lastVerificationFailed = verificationStatus === 'failed' ? new Date() : profile.lastVerificationFailed;
    profile.deviceSignature = {
        keyboardType: deviceSnapshot.inputMethod,
        osType: deviceSnapshot.osType,
        browserAgent: deviceSnapshot.browserAgent,
        screenResolution: deviceSnapshot.screenResolution,
        timezone: deviceSnapshot.timezone
    };
    profile.lastUpdated = new Date();

    await profile.save();

    return {
        profileId: String(profile._id),
        profileStatus: profile.status,
        verificationStatus,
        verificationScore,
        flags
    };
}

function buildEventMetrics(sessionMetrics) {
    return {
        avgKeystrokeTime: sessionMetrics.avgKeystrokeTime,
        typingSpeed: sessionMetrics.typingSpeed,
        sampleSize: sessionMetrics.sampleSize
    };
}

async function createAuthenticationEvent(userId, sessionId, deviceSnapshot, sessionMetrics, biometricSummary) {
    const authEvent = new AuthenticationEvent({
        userId,
        sessionId: String(sessionId),
        keystrokeMetrics: buildEventMetrics(sessionMetrics),
        deviceInfo: {
            deviceId: deviceSnapshot.deviceId,
            osType: deviceSnapshot.osType,
            timezone: deviceSnapshot.timezone
        },
        verificationResult: {
            status: biometricSummary.verificationStatus,
            confidenceScore: biometricSummary.verificationScore,
            matchPercentage: biometricSummary.verificationScore,
            flags: biometricSummary.flags
        },
        fallbackMethod: biometricSummary.verificationStatus === 'challenge' ? 'email_link' : 'none',
        fallbackStatus: biometricSummary.verificationStatus === 'challenge' ? 'recommended' : 'not_required'
    });

    await authEvent.save();
    return authEvent;
}

async function createWritingVersion(userId, sessionId, content, telemetry) {
    const versions = telemetry.versionHistory.length
        ? telemetry.versionHistory
        : [{
            versionNumber: 1,
            timestamp: new Date().toISOString(),
            reason: 'save',
            content,
            characterCount: content.length,
            changesSinceLast: {
                inserted: content.length,
                deleted: 0,
                modified: 0
            }
        }];

    const versionDoc = new WritingVersion({
        userId,
        textSessionId: sessionId,
        versions: versions.map((version) => ({
            versionNumber: version.versionNumber,
            timestamp: new Date(version.timestamp),
            content: version.content,
            characterCount: version.characterCount,
            changesSinceLast: version.changesSinceLast
        })),
        keystrokeReplay: telemetry.keystrokeEvents.map((event) => ({
            timestamp: event.timestamp,
            type: event.type,
            character: event.character,
            text: normalizeText(event.text).slice(0, 500),
            position: event.position,
            interval: event.interval
        }))
    });

    await versionDoc.save();
    return versionDoc;
}

async function createEncryptedTelemetry(userId, sessionId, telemetry, sessionMetrics) {
    const encryptionManager = new EncryptionManager(process.env.ENCRYPTION_KEY);

    const encryptedDoc = new EncryptedKeystrokeData({
        userId,
        sessionId,
        encryptedData: encryptionManager.encrypt({
            intervals: telemetry.intervals,
            pauseIntervals: telemetry.pauseIntervals,
            pastedSegments: telemetry.pastedSegments,
            keystrokeEvents: telemetry.keystrokeEvents
        }),
        anonymizedMetrics: {
            avgKeystrokeTime: sessionMetrics.avgKeystrokeTime,
            stdDevKeystrokeTime: sessionMetrics.stdDevKeystrokeTime,
            pauseFrequency: telemetry.pauseIntervals.length
        },
        encryptionTimestamp: new Date()
    });

    await encryptedDoc.save();
    return encryptedDoc;
}

async function createPasteDetectionLog(userId, sessionId, pasteAnalysis) {
    const log = new PasteDetectionLog({
        userId,
        textSessionId: sessionId,
        detectionResults: pasteAnalysis.detectionResults,
        summaryAnalysis: pasteAnalysis.summaryAnalysis
    });

    await log.save();
    return log;
}

function buildTrustSummary(sessionMetrics, pasteAnalysis, deviceSummary, biometricSummary) {
    const keystrokeBehavior = round((
        clamp(100 - Math.abs(sessionMetrics.avgKeystrokeTime - 220) / 3, 0, 100) +
        clamp(sessionMetrics.stdDevKeystrokeTime * 1.4, 0, 100) +
        clamp(35 + sessionMetrics.deletionCount * 8 + sessionMetrics.pauseCount * 6, 0, 100)
    ) / 3);
    const pasteDetection = round(clamp(100 - pasteAnalysis.summaryAnalysis.pastedSegments * 35, 0, 100));
    const aiLikelihood = round(clamp(100 - pasteAnalysis.overallAiConfidence, 0, 100));
    const anomalyScore = round(clamp(
        100 - (sessionMetrics.focusLossCount * 8 + (sessionMetrics.deletionCount === 0 ? 8 : 0)),
        0,
        100
    ));
    const devicesConsistency = round(deviceSummary.consistencyScore);

    const trustScore = round(
        keystrokeBehavior * 0.30 +
        pasteDetection * 0.25 +
        aiLikelihood * 0.20 +
        anomalyScore * 0.10 +
        devicesConsistency * 0.15
    );

    const warnings = [];
    if (pasteAnalysis.summaryAnalysis.pastedSegments > 0) {
        warnings.push({
            timestamp: new Date(),
            message: 'Clipboard paste detected during writing session',
            severity: 'high'
        });
    }

    if (pasteAnalysis.overallAiConfidence >= 60) {
        warnings.push({
            timestamp: new Date(),
            message: 'Typing pattern looks unusually uniform',
            severity: 'medium'
        });
    }

    if (!deviceSummary.isKnownDevice) {
        warnings.push({
            timestamp: new Date(),
            message: 'New device profile observed',
            severity: 'medium'
        });
    }

    return {
        trustScore,
        riskLevel: trustScore < 55 ? 'high' : trustScore < 75 ? 'medium' : 'low',
        factors: {
            keystrokeBehavior,
            pasteDetection,
            aiLikelihood,
            anomalyScore,
            devicesConsistency
        },
        warnings,
        pasteVerdict: pasteAnalysis.summaryAnalysis.pastedSegments > 0
            ? 'pasted_content_detected'
            : 'no_direct_paste_detected',
        aiVerdict: pasteAnalysis.overallAiConfidence >= 70
            ? 'high_ai_suspicion'
            : pasteAnalysis.overallAiConfidence >= 50
                ? 'medium_ai_suspicion'
                : 'human_like_behavior',
        biometricStatus: biometricSummary.profileStatus,
        deviceTrustScore: deviceSummary.trustScore
    };
}

async function createTrustScore(userId, sessionId, trustSummary) {
    const trustDoc = new SessionTrustScore({
        userId,
        textSessionId: sessionId,
        scoreHistory: [{
            timestamp: new Date(),
            score: trustSummary.trustScore,
            factors: trustSummary.factors
        }],
        currentScore: trustSummary.trustScore,
        riskLevel: trustSummary.riskLevel,
        warnings: trustSummary.warnings
    });

    await trustDoc.save();
    return trustDoc;
}

function buildReportFindings(sessionMetrics, linguisticMetrics, trustSummary, deviceSummary, biometricSummary) {
    return [
        {
            category: 'Behavior',
            result: `Average keystroke time ${sessionMetrics.avgKeystrokeTime} ms with ${sessionMetrics.pauseCount} pauses and ${sessionMetrics.deletionCount} deletions.`,
            confidence: trustSummary.factors.keystrokeBehavior
        },
        {
            category: 'Paste Detection',
            result: `Verdict: ${trustSummary.pasteVerdict.replaceAll('_', ' ')}.`,
            confidence: trustSummary.factors.pasteDetection
        },
        {
            category: 'AI Suspicion',
            result: `Verdict: ${trustSummary.aiVerdict.replaceAll('_', ' ')}.`,
            confidence: 100 - trustSummary.factors.aiLikelihood
        },
        {
            category: 'Device',
            result: `Device ${deviceSummary.isKnownDevice ? 'matches' : 'does not match'} existing profile. Trust score ${deviceSummary.trustScore}.`,
            confidence: deviceSummary.consistencyScore
        },
        {
            category: 'Biometric Profile',
            result: `Profile status ${biometricSummary.profileStatus} with verification ${biometricSummary.verificationStatus}.`,
            confidence: biometricSummary.verificationScore
        },
        {
            category: 'Linguistics',
            result: `Vocabulary diversity ${linguisticMetrics.vocabularyDiversity}% across ${linguisticMetrics.wordCount} words.`,
            confidence: clamp(linguisticMetrics.vocabularyDiversity, 0, 100)
        }
    ];
}

async function createReport(userId, sessionId, content, sessionMetrics, linguisticMetrics, trustSummary, deviceSummary, biometricSummary) {
    const report = new Report({
        userId,
        textSessionId: sessionId,
        reportContent: {
            title: `Vi-Notes Session Report - ${new Date().toLocaleDateString()}`,
            summary: `Trust score ${trustSummary.trustScore}/100 for "${normalizeText(content).slice(0, 60)}"`,
            trustScore: trustSummary.trustScore,
            analysisDate: new Date(),
            findings: buildReportFindings(sessionMetrics, linguisticMetrics, trustSummary, deviceSummary, biometricSummary)
        },
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    });

    await report.save();
    return report;
}

function buildTextSessionPayload(userId, session) {
    return {
        userId,
        content: session.content,
        startTime: session.startTime,
        endTime: session.endTime,
        duration: session.duration,
        pasteCount: session.pasteCount,
        pastedTextLength: session.pastedTextLength,
        totalKeystrokes: session.totalKeystrokes,
        sessionMetrics: session.sessionMetrics,
        linguisticMetrics: session.linguisticMetrics,
        deviceSnapshot: session.deviceSnapshot
    };
}

function buildSessionContext(body = {}) {
    const content = normalizeText(body.content);
    const startTime = body.startTime ? new Date(body.startTime) : new Date();
    const endTime = body.endTime ? new Date(body.endTime) : new Date();
    const duration = toNumber(body.duration, Math.max(1, (endTime - startTime) / 1000));
    const pasteCount = toNumber(body.pasteCount);
    const pastedTextLength = toNumber(body.pastedTextLength);
    const totalKeystrokes = toNumber(body.totalKeystrokes);
    const telemetry = normalizeTelemetry(body.telemetry);
    const deviceSnapshot = buildDeviceSnapshot(telemetry.deviceInfo);
    const linguisticMetrics = buildLinguisticMetrics(content);
    const sessionMetrics = buildSessionMetrics(
        content,
        duration,
        totalKeystrokes,
        pasteCount,
        telemetry,
        linguisticMetrics
    );

    return {
        content,
        startTime,
        endTime,
        duration,
        pasteCount,
        pastedTextLength,
        totalKeystrokes,
        telemetry,
        deviceSnapshot,
        linguisticMetrics,
        sessionMetrics
    };
}

async function runSessionAnalysis(userId, textSession, sessionData) {
    const { content, telemetry, sessionMetrics, linguisticMetrics, deviceSnapshot, pasteCount } = sessionData;
    let stage = 'paste-analysis';

    try {
        const pasteAnalysis = buildPasteAnalysis(content, telemetry, sessionMetrics, linguisticMetrics);

        stage = 'device-profile';
        const deviceSummary = await upsertDeviceProfile(userId, deviceSnapshot, sessionMetrics, pasteCount);

        stage = 'biometric-profile';
        const biometricSummary = await upsertBiometricProfile(userId, deviceSnapshot, sessionMetrics);

        stage = 'authentication-event';
        const authEvent = await createAuthenticationEvent(userId, textSession._id, deviceSnapshot, sessionMetrics, biometricSummary);

        stage = 'paste-log';
        const pasteLog = await createPasteDetectionLog(userId, textSession._id, pasteAnalysis);

        stage = 'writing-version';
        const writingVersion = await createWritingVersion(userId, textSession._id, content, telemetry);

        stage = 'encrypted-telemetry';
        const encryptedTelemetry = await createEncryptedTelemetry(userId, textSession._id, telemetry, sessionMetrics);

        stage = 'trust-score';
        const trustSummary = buildTrustSummary(sessionMetrics, pasteAnalysis, deviceSummary, biometricSummary);
        const trustScoreDoc = await createTrustScore(userId, textSession._id, trustSummary);

        stage = 'report';
        const report = await createReport(
            userId,
            textSession._id,
            content,
            sessionMetrics,
            linguisticMetrics,
            trustSummary,
            deviceSummary,
            biometricSummary
        );

        const artifactRefs = {
            authenticationEventId: String(authEvent._id),
            deviceProfileId: deviceSummary.profileId,
            biometricProfileId: biometricSummary.profileId,
            pasteLogId: String(pasteLog._id),
            writingVersionId: String(writingVersion._id),
            encryptedTelemetryId: String(encryptedTelemetry._id),
            trustScoreId: String(trustScoreDoc._id),
            reportId: String(report._id)
        };

        return {
            pasteAnalysis,
            deviceSummary,
            biometricSummary,
            trustSummary,
            report,
            artifactRefs,
            records: {
                textId: String(textSession._id),
                authEventId: artifactRefs.authenticationEventId,
                pasteLogId: artifactRefs.pasteLogId,
                writingVersionId: artifactRefs.writingVersionId,
                encryptedTelemetryId: artifactRefs.encryptedTelemetryId,
                trustScoreId: artifactRefs.trustScoreId,
                reportId: artifactRefs.reportId
            },
            textSummary: {
                pasteVerdict: trustSummary.pasteVerdict,
                aiVerdict: trustSummary.aiVerdict,
                trustScore: trustSummary.trustScore,
                riskLevel: trustSummary.riskLevel,
                biometricStatus: biometricSummary.profileStatus,
                deviceTrustScore: deviceSummary.trustScore,
                reportToken: report.sharingToken
            }
        };
    } catch (err) {
        err.message = `Analysis failed at ${stage}: ${err.message}`;
        throw err;
    }
}

async function fetchSessionArtifacts(userId, session) {
    const artifactRefs = session?.artifactRefs || {};
    const sessionId = session?._id;
    const deviceId = session?.deviceSnapshot?.deviceId;

    const authEventsPromise = artifactRefs.authenticationEventId
        ? AuthenticationEvent.find({ _id: artifactRefs.authenticationEventId, userId }).lean()
        : AuthenticationEvent.find({ userId, sessionId: String(sessionId) }).lean();

    const deviceProfilesPromise = artifactRefs.deviceProfileId
        ? DeviceProfile.find({ _id: artifactRefs.deviceProfileId, userId }).lean()
        : deviceId
            ? DeviceProfile.find({ userId, deviceId }).lean()
            : DeviceProfile.find({ userId }).lean();

    const [authEvents, biometricProfile, deviceProfiles, encryptedTelemetry, pasteLog, report, trustScore, writingVersion] = await Promise.all([
        authEventsPromise,
        artifactRefs.biometricProfileId
            ? BiometricProfile.findOne({ _id: artifactRefs.biometricProfileId, userId }).lean()
            : BiometricProfile.findOne({ userId }).lean(),
        deviceProfilesPromise,
        artifactRefs.encryptedTelemetryId
            ? EncryptedKeystrokeData.findOne({ _id: artifactRefs.encryptedTelemetryId, userId }).lean()
            : EncryptedKeystrokeData.findOne({ sessionId }).lean(),
        artifactRefs.pasteLogId
            ? PasteDetectionLog.findOne({ _id: artifactRefs.pasteLogId, userId }).lean()
            : PasteDetectionLog.findOne({ textSessionId: sessionId }).lean(),
        artifactRefs.reportId
            ? Report.findOne({ _id: artifactRefs.reportId, userId }).lean()
            : Report.findOne({ textSessionId: sessionId }).lean(),
        artifactRefs.trustScoreId
            ? SessionTrustScore.findOne({ _id: artifactRefs.trustScoreId, userId }).lean()
            : SessionTrustScore.findOne({ textSessionId: sessionId }).lean(),
        artifactRefs.writingVersionId
            ? WritingVersion.findOne({ _id: artifactRefs.writingVersionId, userId }).lean()
            : WritingVersion.findOne({ textSessionId: sessionId }).lean()
    ]);

    return {
        authEvents,
        biometricProfile,
        deviceProfiles,
        encryptedTelemetry,
        pasteLog,
        report,
        trustScore,
        writingVersion
    };
}

module.exports = {
    buildSessionContext,
    buildTextSessionPayload,
    fetchSessionArtifacts,
    runSessionAnalysis
};
