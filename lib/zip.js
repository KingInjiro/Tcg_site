const { crc32, deflateRawSync } = require('node:zlib');

// ZIP 2.0: UTF-8 filenames, DEFLATE, local headers + central directory.
// Only writes trusted website files; never extracts user-supplied archives.
// Format: https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT
function zip(files, date = new Date()) {
    if (files.length > 65535) throw new Error('Забагато файлів для ZIP.');
    const year = Math.max(1980, Math.min(2107, date.getFullYear()));
    const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
    const parts = [], directory = [], names = new Set();
    let offset = 0, total = 0;
    for (const file of files) {
        if (!file.path || /[\\\x00-\x1f:]/.test(file.path) || file.path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Некоректний шлях у ZIP.');
        const key = file.path.toLowerCase();
        if (names.has(key)) throw new Error('Повторний шлях у ZIP: ' + file.path);
        names.add(key);
        const name = Buffer.from(file.path, 'utf8'), data = Buffer.from(file.content);
        total += data.length;
        if (name.length > 65535 || total > 128 * 1024 * 1024) throw new Error('Сайт завеликий для експорту (максимум 128 МБ).');
        const packed = deflateRawSync(data), checksum = crc32(data);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(0x800, 6); // UTF-8
        local.writeUInt16LE(8, 8); // DEFLATE
        local.writeUInt16LE(dosTime, 10);
        local.writeUInt16LE(dosDate, 12);
        local.writeUInt32LE(checksum, 14);
        local.writeUInt32LE(packed.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(name.length, 26);
        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4);
        local.copy(central, 6, 4, 30);
        central.writeUInt32LE(offset, 42);
        parts.push(local, name, packed);
        directory.push(central, name);
        offset += local.length + name.length + packed.length;
    }
    const central = Buffer.concat(directory), end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(files.length, 8);
    end.writeUInt16LE(files.length, 10);
    end.writeUInt32LE(central.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...parts, central, end]);
}
module.exports = { zip };
