// Test-only reader: use the central directory (independent of write order).
const assert = require('node:assert/strict');
const { inflateRawSync, crc32 } = require('node:zlib');
function readZip(buffer) {
    const end = buffer.length - 22;
    assert.equal(buffer.readUInt32LE(end), 0x06054b50);
    const count = buffer.readUInt16LE(end + 10), files = new Map();
    let cursor = buffer.readUInt32LE(end + 16);
    const start = cursor;
    for (let i = 0; i < count; i++) {
        assert.equal(buffer.readUInt32LE(cursor), 0x02014b50);
        assert.equal(buffer.readUInt16LE(cursor + 8), 0x800, 'UTF-8 names');
        assert.equal(buffer.readUInt16LE(cursor + 10), 8, 'DEFLATE');
        const packedLength = buffer.readUInt32LE(cursor + 20), length = buffer.readUInt32LE(cursor + 24);
        const nameLength = buffer.readUInt16LE(cursor + 28), extra = buffer.readUInt16LE(cursor + 30), comment = buffer.readUInt16LE(cursor + 32);
        const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
        const offset = buffer.readUInt32LE(cursor + 42);
        assert.equal(buffer.readUInt32LE(offset), 0x04034b50);
        assert.equal(buffer.subarray(offset + 30, offset + 30 + buffer.readUInt16LE(offset + 26)).toString('utf8'), name);
        const dataStart = offset + 30 + buffer.readUInt16LE(offset + 26) + buffer.readUInt16LE(offset + 28);
        const data = inflateRawSync(buffer.subarray(dataStart, dataStart + packedLength));
        assert.equal(data.length, length);
        assert.equal(crc32(data), buffer.readUInt32LE(cursor + 16), name + ' CRC');
        assert.ok(!files.has(name));
        files.set(name, data);
        cursor += 46 + nameLength + extra + comment;
    }
    assert.equal(cursor, end);
    assert.equal(cursor - start, buffer.readUInt32LE(end + 12));
    return files;
}
module.exports = { readZip };
