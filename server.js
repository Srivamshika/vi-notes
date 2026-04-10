const path = require('path');

require('./utils/loadEnv');

const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const User = require('./models/User');
const Text = require('./models/Text');
const BiometricProfile = require('./models/BiometricProfile');

const { requireAuth, signAuthToken } = require('./utils/auth');
const {
    buildSessionContext,
    buildTextSessionPayload,
    fetchSessionArtifacts,
    runSessionAnalysis
} = require('./utils/sessionPipeline');

const biometricsRoutes = require('./routes/biometrics');
const pasteDetectionRoutes = require('./routes/pasteDetection');
const trustScoreRoutes = require('./routes/trustScore');
const versionControlRoutes = require('./routes/versionControl');
const deviceTrackingRoutes = require('./routes/deviceTracking');
const reportSharingRoutes = require('./routes/reportSharing');
const privacyRoutes = require('./routes/privacy');

const app = express();

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT) || 3000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/vi-notes';

let mongoConnectPromise = null;
let databaseListenersAttached = false;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function getDatabaseStatus() {
    const stateMap = {
        0: 'disconnected',
        1: 'connected',
        2: 'connecting',
        3: 'disconnecting'
    };

    return stateMap[mongoose.connection.readyState] || 'unknown';
}

function isDatabaseReady() {
    return mongoose.connection.readyState === 1;
}

function sendDatabaseUnavailable(res) {
    return res.status(503).json({
        message: 'Database is not connected. Check MONGODB_URI and MongoDB availability.',
        database: getDatabaseStatus()
    });
}

async function connectToDatabase() {
    if (mongoose.connection.readyState === 1) {
        return mongoose.connection;
    }

    if (mongoConnectPromise) {
        return mongoConnectPromise;
    }

    if (!databaseListenersAttached) {
        databaseListenersAttached = true;

        mongoose.connection.on('connected', () => {
            console.log(`MongoDB connected: ${MONGODB_URI}`);
        });

        mongoose.connection.on('disconnected', () => {
            console.warn('MongoDB disconnected');
        });

        mongoose.connection.on('error', (err) => {
            console.error(`MongoDB runtime error: ${err.message}`);
        });
    }

    mongoConnectPromise = mongoose.connect(MONGODB_URI, {
        serverSelectionTimeoutMS: 5000
    }).then(() => mongoose.connection)
        .catch((err) => {
            console.error(`MongoDB connection error: ${err.message}`);
            return null;
        })
        .finally(() => {
            mongoConnectPromise = null;
        });

    return mongoConnectPromise;
}

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function getUsernameFromInput(username, email) {
    const trimmedUsername = String(username || '').trim();
    if (trimmedUsername) {
        return trimmedUsername;
    }

    const normalizedEmail = normalizeEmail(email);
    return normalizedEmail.includes('@') ? normalizedEmail.split('@')[0] : normalizedEmail;
}

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date(),
        database: getDatabaseStatus()
    });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/verify/:token', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'report.html'));
});

app.post('/register', async (req, res) => {
    try {
        if (!isDatabaseReady()) {
            return sendDatabaseUnavailable(res);
        }

        const { username, email, password } = req.body;
        const normalizedEmail = normalizeEmail(email);
        const resolvedUsername = getUsernameFromInput(username, normalizedEmail);

        if (!normalizedEmail || !password) {
            return res.status(400).json({
                message: 'Email and password are required'
            });
        }

        const existingUser = await User.findOne({ email: normalizedEmail });
        if (existingUser) {
            return res.status(409).json({ message: 'User already exists' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const user = new User({
            username: resolvedUsername,
            email: normalizedEmail,
            password: hashedPassword
        });

        await user.save();

        res.status(201).json({
            message: 'User registered successfully',
            userId: user._id
        });
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ message: 'Error registering user' });
    }
});

app.post('/login', async (req, res) => {
    try {
        if (!isDatabaseReady()) {
            return sendDatabaseUnavailable(res);
        }

        const { email, password } = req.body;
        const normalizedEmail = normalizeEmail(email);

        if (!normalizedEmail || !password) {
            return res.status(400).json({
                message: 'Email and password are required'
            });
        }

        const user = await User.findOne({ email: normalizedEmail });

        if (!user) {
            return res.status(400).json({ message: 'User not found' });
        }

        const isMatch = await bcrypt.compare(password, user.password);

        if (!isMatch) {
            return res.status(400).json({ message: 'Invalid password' });
        }

        const token = signAuthToken({ id: user._id });
        const bioProfile = await BiometricProfile.findOne({ userId: user._id });

        res.json({
            message: 'Login successful',
            token,
            userId: user._id,
            requiresBiometricVerification: bioProfile?.status === 'active'
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ message: 'Error logging in' });
    }
});

app.post('/save', requireAuth, async (req, res) => {
    try {
        if (!isDatabaseReady()) {
            return sendDatabaseUnavailable(res);
        }

        const sessionData = buildSessionContext(req.body);
        if (!sessionData.content.trim()) {
            return res.status(400).json({
                message: 'Content must not be empty'
            });
        }

        const textSession = new Text({
            _id: new mongoose.Types.ObjectId(),
            ...buildTextSessionPayload(req.userId, sessionData)
        });

        const analysis = await runSessionAnalysis(req.userId, textSession, sessionData);

        textSession.analysisSummary = analysis.textSummary;
        textSession.artifactRefs = analysis.artifactRefs;
        await textSession.save();

        res.json({
            message: 'Session saved and advanced analysis generated',
            sessionId: textSession._id,
            analysis: analysis.textSummary,
            records: analysis.records
        });
    } catch (err) {
        console.error('Save session error:', err.stack || err);
        res.status(500).json({
            message: process.env.NODE_ENV === 'development'
                ? err.message
                : 'Error saving session'
        });
    }
});

app.get('/my-sessions', requireAuth, async (req, res) => {
    try {
        if (!isDatabaseReady()) {
            return sendDatabaseUnavailable(res);
        }

        const sessions = await Text.find({ userId: req.userId })
            .select('content pasteCount sessionMetrics analysisSummary artifactRefs createdAt')
            .sort({ createdAt: -1 })
            .lean();

        res.json(sessions);
    } catch (err) {
        console.error('Fetch sessions error:', err);
        res.status(500).json({ message: 'Error fetching sessions' });
    }
});

app.get('/session-details/:sessionId', requireAuth, async (req, res) => {
    try {
        if (!isDatabaseReady()) {
            return sendDatabaseUnavailable(res);
        }

        const session = await Text.findOne({
            _id: req.params.sessionId,
            userId: req.userId
        }).lean();

        if (!session) {
            return res.status(404).json({ message: 'Session not found' });
        }

        const artifacts = await fetchSessionArtifacts(req.userId, session);

        res.json({
            session,
            ...artifacts
        });
    } catch (err) {
        console.error('Session details error:', err);
        res.status(500).json({ message: 'Error fetching session details' });
    }
});

app.use('/api', (req, res, next) => {
    if (!isDatabaseReady()) {
        return sendDatabaseUnavailable(res);
    }

    next();
});

app.use('/api', biometricsRoutes);
app.use('/api', pasteDetectionRoutes);
app.use('/api', trustScoreRoutes);
app.use('/api', versionControlRoutes);
app.use('/api', deviceTrackingRoutes);
app.use('/api', reportSharingRoutes);
app.use('/api', privacyRoutes);

app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
        message: 'Internal Server Error',
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
});

async function startServer() {
    const maxAttempts = 10;

    const listenOnPort = (port) => new Promise((resolve) => {
        const server = app.listen(port, HOST, () => {
            console.log(`Server running at http://${HOST}:${port}`);
            console.log(`Advanced API routes available at http://${HOST}:${port}/api/*`);
            resolve(server);
        });

        server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                console.warn(`Port ${port} on ${HOST} is busy, trying the next port.`);
                resolve(null);
                return;
            }

            console.error(`HTTP server error: ${err.message}`);
            resolve(null);
        });
    });

    void connectToDatabase();

    for (let offset = 0; offset < maxAttempts; offset += 1) {
        const candidatePort = PORT + offset;
        const server = await listenOnPort(candidatePort);
        if (server) {
            return server;
        }
    }

    throw new Error(`Unable to start the server on ports ${PORT} through ${PORT + maxAttempts - 1}.`);
}

if (require.main === module) {
    startServer();
}

module.exports = {
    app,
    connectToDatabase,
    startServer
};
