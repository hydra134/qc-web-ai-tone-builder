// Adapted from qc-mcp/protocol.py; see THIRD_PARTY_NOTICES.md.
import { ProtoMessage } from './protobuf';

export const COMMAND = {
  grid: 1,
  position: 2,
  ioSettings: 3,
  generalSettings: 9,
  version: 10,
  scene: 13,
  mode: 14,
  recallPreset: 15,
  masterVolume: 17,
  undoRedo: 21,
  keepAlive: 32,
  globalTempo: 33,
  presetDirty: 34,
  moduleStats: 35,
  globalEq: 38,
  connection: 49,
  modelRepo: 51,
  resetCommsBuffers: 52,
} as const;

export function reportsFor(command: number, payload: Uint8Array): Uint8Array<ArrayBuffer>[] {
  const message = new Uint8Array(payload.length + 8);
  message.set(payload);
  new DataView(message.buffer).setUint16(payload.length, command, true);
  const reports: Uint8Array<ArrayBuffer>[] = [];
  for (let offset = 0; offset < message.length; offset += 126) {
    const chunk = message.subarray(offset, offset + 126);
    // WebHID supplies report ID separately: sendReport(2, these 128 data bytes).
    const report = new Uint8Array(128);
    report[0] = chunk.length;
    report[1] = (offset === 0 ? 0x40 : 0) | (offset + 126 >= message.length ? 0x80 : 0);
    report.set(chunk, 2);
    reports.push(report);
  }
  return reports;
}

export class Reassembler {
  private chunks: Uint8Array<ArrayBuffer>[] = [];
  private size = 0;
  private started = false;

  feed(data: DataView): Uint8Array<ArrayBuffer> | undefined {
    if (data.byteLength < 2) throw new Error('The QC returned a truncated HID report.');
    const length = data.getUint8(0);
    const flags = data.getUint8(1);
    if (length > 126 || length + 2 > data.byteLength || ![0, 0x40, 0x80, 0xc0].includes(flags)) {
      throw new Error('The QC returned an invalid HID report.');
    }
    if (flags & 0x40) {
      this.chunks = [];
      this.size = 0;
      this.started = true;
    }
    // Opening the interface can start in the middle of existing telemetry.
    if (!this.started) return;
    this.size += length;
    if (this.size > 16 * 1024 * 1024) throw new Error('The QC message is too large.');
    this.chunks.push(new Uint8Array(data.buffer, data.byteOffset + 2, length).slice());
    if (!(flags & 0x80)) return;
    const message = new Uint8Array(this.size);
    let offset = 0;
    for (const chunk of this.chunks) {
      message.set(chunk, offset);
      offset += chunk.length;
    }
    this.chunks = [];
    this.size = 0;
    this.started = false;
    return message;
  }
}

export async function decompress(bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b || bytes[2] !== 0x08) return bytes.slice();
  const stream = new Blob([bytes.slice().buffer])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      length += result.value.length;
      if (length > 32 * 1024 * 1024) throw new Error('The decompressed QC data is too large.');
      chunks.push(result.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

export interface DecodedMessage {
  command: number;
  body: ProtoMessage;
}

export async function decodeMessage(bytes: Uint8Array): Promise<DecodedMessage> {
  if (bytes.length < 8) throw new Error('The QC returned an incomplete message.');
  const trailer = new DataView(bytes.buffer, bytes.byteOffset + bytes.length - 8, 8);
  return {
    command: trailer.getUint16(0, true),
    body: new ProtoMessage(await decompress(bytes.subarray(0, -8))),
  };
}
