const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env');

if (fs.existsSync(envPath)) {
    const envFile = fs.readFileSync(envPath, 'utf8');

    for (const rawLine of envFile.split(/\r?\n/)) {
        const line = rawLine.trim();

        if (!line || line.startsWith('#') || !line.includes('=')) {
            continue;
        }

        const separatorIndex = line.indexOf('=');
        const key = line.slice(0, separatorIndex).trim();
        let value = line.slice(separatorIndex + 1).trim();

        if (!key || process.env[key] !== undefined) {
            continue;
        }

        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith('\'') && value.endsWith('\''))
        ) {
            value = value.slice(1, -1);
        }

        process.env[key] = value;
    }
}

module.exports = process.env;
