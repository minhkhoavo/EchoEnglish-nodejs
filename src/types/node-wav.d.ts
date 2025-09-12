declare module 'node-wav' {
  export function decode(buffer: Buffer): {
    sampleRate: number;
    channelData: Float32Array[];
  };
  const _default: { decode: typeof decode };
  export default _default;
}
