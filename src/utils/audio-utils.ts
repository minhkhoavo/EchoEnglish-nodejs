import ffmpeg from '~/utils/ffmpeg';
import * as sdk from 'microsoft-cognitiveservices-speech-sdk';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

export async function convertMp3ToWav(buffer: Buffer): Promise<Buffer> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ffx-'));
  const inPath = path.join(tmpDir, 'in.mp3');
  const outPath = path.join(tmpDir, 'out.wav');
  try {
    await fs.writeFile(inPath, buffer);
    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(inPath)
        .noVideo()
        .audioChannels(1)
        .audioFrequency(16000)
        .audioCodec('pcm_s16le')
        .outputOptions(['-y'])
        .save(outPath)
        .on('error', reject)
        .on('end', () => resolve());
    });
    const wav = await fs.readFile(outPath);
    return wav;
  } finally {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

export function makeAudioConfigFromPcm16kMonoWav(
  wavBuf: Buffer
): sdk.AudioConfig {
  try {
    if (wavBuf.length >= 4 && wavBuf.toString('ascii', 0, 4) === 'RIFF') {
      if (wavBuf.length < 44 || wavBuf.toString('ascii', 8, 12) !== 'WAVE')
        throw new Error('not RIFF/WAVE');
      let offset = 12;
      let dataStart = -1;
      let dataSize = 0;
      while (offset + 8 <= wavBuf.length) {
        const id = wavBuf.toString('ascii', offset, offset + 4);
        const size = wavBuf.readUInt32LE(offset + 4);
        const chunkStart = offset + 8;
        const chunkEnd = chunkStart + size;
        if (chunkEnd > wavBuf.length) break;
        if (id === 'data') {
          dataStart = chunkStart;
          dataSize = size;
          break;
        }
        offset = chunkEnd + (chunkEnd % 2);
      }
      if (dataStart === -1) throw new Error('no data chunk');
      const pcm = wavBuf.subarray(dataStart, dataStart + dataSize);
      const format = sdk.AudioStreamFormat.getWaveFormatPCM(16000, 16, 1);
      const pushStream = sdk.AudioInputStream.createPushStream(format);
      const ab = pcm.buffer.slice(
        pcm.byteOffset,
        pcm.byteOffset + pcm.byteLength
      );
      pushStream.write(ab as ArrayBuffer);
      pushStream.close();
      return sdk.AudioConfig.fromStreamInput(pushStream);
    }
  } catch (e) {
    // fall through to native handler
  }
  return sdk.AudioConfig.fromWavFileInput(wavBuf);
}
