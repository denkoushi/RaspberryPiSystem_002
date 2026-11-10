import sharp from 'sharp';

export async function enhanceForJudgement(bytes: Buffer): Promise<Buffer> {
  try {
    // Float Lab preserves signed a/b values; uchar would clip negative chroma.
    const { data, info } = await sharp(bytes).removeAlpha().toColourspace('lab')
      .raw({ depth: 'float' }).toBuffer({ resolveWithObject: true });
    const lab = new Float32Array(data.buffer, data.byteOffset, data.byteLength / 4);
    const pixels = info.width * info.height;
    const lightness = Buffer.alloc(pixels);
    const chroma = new Float32Array(pixels * 2);
    for (let i = 0; i < pixels; i += 1) {
      lightness[i] = Math.round(Math.max(0, Math.min(100, lab[i * 3])) * 255 / 100);
      chroma[i * 2] = lab[i * 3 + 1];
      chroma[i * 2 + 1] = lab[i * 3 + 2];
    }
    const raw = { width: info.width, height: info.height, channels: 1 as const };
    const enhanced = await sharp(lightness, { raw }).pipelineColourspace('b-w').clahe({
      width: Math.min(64, info.width), height: Math.min(64, info.height), maxSlope: 8,
    }).toColourspace('b-w').raw().toBuffer();
    const enhancedLightness = Float32Array.from(enhanced, (value) => value * 100 / 255);
    // joinChannel assigns the output interpretation to the assembled Lab bands.
    // The JPEG encoder then converts Lab to sRGB, retaining the original a/b.
    // sharp accepts typed raw input here, but joinChannel's typings omit it.
    return await sharp(enhancedLightness, { raw })
      .joinChannel(chroma as unknown as Buffer, { raw: { ...raw, channels: 2 } })
      .toColourspace('lab').jpeg({ quality: 85 }).toBuffer();
  } catch {
    return bytes;
  }
}
