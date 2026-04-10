require('./loadEnv');

const jwt = require('jsonwebtoken');

function getJwtSecret() {
    return process.env.JWT_SECRET || 'vi-notes-development-secret';
}

function getJwtExpiry() {
    return process.env.JWT_EXPIRY || '24h';
}

function normalizeAuthToken(headerValue) {
    if (!headerValue || typeof headerValue !== 'string') {
        return null;
    }

    return headerValue.startsWith('Bearer ')
        ? headerValue.slice('Bearer '.length).trim()
        : headerValue.trim();
}

function signAuthToken(payload, options = {}) {
    const { expiresIn = getJwtExpiry(), ...restOptions } = options;

    return jwt.sign(payload, getJwtSecret(), {
        expiresIn,
        ...restOptions
    });
}

function verifyAuthToken(headerValue) {
    const token = normalizeAuthToken(headerValue);

    if (!token) {
        throw new Error('Missing authorization token');
    }

    return jwt.verify(token, getJwtSecret());
}

function requireAuth(req, res, next) {
    try {
        const headerValue = req.headers.authorization || req.headers.Authorization;
        const decoded = verifyAuthToken(headerValue);

        req.userId = String(decoded.id);
        req.user = decoded;
        next();
    } catch (err) {
        const message = err.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token';
        res.status(401).json({ message });
    }
}

module.exports = {
    getJwtSecret,
    getJwtExpiry,
    normalizeAuthToken,
    signAuthToken,
    verifyAuthToken,
    requireAuth
};
