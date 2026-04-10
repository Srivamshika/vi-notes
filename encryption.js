const crypto = require('crypto');

// Encryption Manager for sensitive keystroke data
class EncryptionManager {
    constructor(encryptionKey = null) {
        this.ALGORITHM = 'aes-256-gcm';
        this.ENCRYPTION_KEY = EncryptionManager.resolveKey(encryptionKey);
    }
    
    // Encrypt keystroke data
    encrypt(data) {
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv(this.ALGORITHM, this.ENCRYPTION_KEY, iv);
        
        const payload = data === undefined ? null : data;

        let encrypted = cipher.update(JSON.stringify(payload), 'utf8', 'hex');
        encrypted += cipher.final('hex');
        
        const authTag = cipher.getAuthTag();
        
        return {
            iv: iv.toString('hex'),
            encryptedData: encrypted,
            authTag: authTag.toString('hex')
        };
    }
    
    // Decrypt keystroke data
    decrypt(encryptedObj) {
        const decipher = crypto.createDecipheriv(
            this.ALGORITHM,
            this.ENCRYPTION_KEY,
            Buffer.from(encryptedObj.iv, 'hex')
        );
        
        decipher.setAuthTag(Buffer.from(encryptedObj.authTag, 'hex'));
        
        let decrypted = decipher.update(encryptedObj.encryptedData, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        
        return JSON.parse(decrypted);
    }
    
    // Anonymize keystroke data (remove PII, keep patterns)
    static anonymize(keystrokeData = {}) {
        return {
            intervals: Array.isArray(keystrokeData.intervals) ? keystrokeData.intervals : [],
            pausePatterns: Array.isArray(keystrokeData.pausePatterns) ? keystrokeData.pausePatterns : [],
            totalDuration: Number(keystrokeData.totalDuration) || 0,
            avgKeystrokeTime: Number(keystrokeData.avgKeystrokeTime) || 0,
            stdDevKeystrokeTime: Number(keystrokeData.stdDevKeystrokeTime) || 0,
            // Removed: character content, exact positions, detailed timing
        };
    }

    static resolveKey(encryptionKey) {
        if (Buffer.isBuffer(encryptionKey) && encryptionKey.length > 0) {
            return encryptionKey.length === 32
                ? encryptionKey
                : crypto.createHash('sha256').update(encryptionKey).digest();
        }

        if (typeof encryptionKey === 'string' && encryptionKey.trim()) {
            const normalizedKey = encryptionKey.trim();

            if (/^[0-9a-fA-F]{64}$/.test(normalizedKey)) {
                return Buffer.from(normalizedKey, 'hex');
            }

            return crypto.createHash('sha256').update(normalizedKey).digest();
        }

        const fallbackSecret = process.env.JWT_SECRET || 'vi-notes-development-key';
        return crypto.createHash('sha256').update(fallbackSecret).digest();
    }
    
    // Hash device fingerprint
    static hashDeviceFingerprint(deviceInfo) {
        const data = JSON.stringify(deviceInfo);
        return crypto.createHash('sha256').update(data).digest('hex');
    }
}

module.exports = EncryptionManager;
