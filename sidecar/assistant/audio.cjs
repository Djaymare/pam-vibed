const { ensure } = require('./validation.cjs');
const MAX_AUDIO_BYTES = 44 + 16000 * 30 * 2;
function validateWav(bytes) {
  ensure(
    Array.isArray(bytes) &&
      bytes.length > 44 &&
      bytes.length <= MAX_AUDIO_BYTES &&
      bytes.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255),
    'Audio invalide ou supérieur à 30 secondes.',
  );
  const wav = Buffer.from(bytes);
  ensure(
    wav.toString('ascii', 0, 4) === 'RIFF' &&
      wav.toString('ascii', 8, 12) === 'WAVE' &&
      wav.toString('ascii', 12, 16) === 'fmt ' &&
      wav.readUInt32LE(16) === 16 &&
      wav.readUInt16LE(20) === 1 &&
      wav.readUInt16LE(22) === 1 &&
      wav.readUInt32LE(24) === 16000 &&
      wav.readUInt32LE(28) === 32000 &&
      wav.readUInt16LE(32) === 2 &&
      wav.readUInt16LE(34) === 16 &&
      wav.toString('ascii', 36, 40) === 'data' &&
      wav.readUInt32LE(40) === wav.length - 44 &&
      wav.readUInt32LE(4) === wav.length - 8 &&
      (wav.length - 44) % 2 === 0,
    'Format attendu : WAV PCM 16 bits, mono, 16 kHz.',
  );
  return wav;
}
module.exports = { validateWav };
