// Adapted from qc-mcp's recovered schemas. See THIRD_PARTY_NOTICES.md.
type WireValue = bigint | number | Uint8Array<ArrayBuffer>;

export class ProtoMessage {
  private readonly fields = new Map<number, WireValue[]>();

  constructor(bytes: Uint8Array) {
    let offset = 0;
    const take = (length: number) => {
      if (!Number.isSafeInteger(length) || length < 0 || offset + length > bytes.length) {
        throw new Error('The QC returned a truncated protobuf message.');
      }
      const result = bytes.slice(offset, offset + length);
      offset += length;
      return result;
    };
    const varint = () => {
      let result = 0n;
      for (let shift = 0n; shift < 70n; shift += 7n) {
        const byte = take(1)[0];
        if (shift === 63n && byte > 1) throw new Error('Invalid protobuf integer.');
        result |= BigInt(byte & 0x7f) << shift;
        if (!(byte & 0x80)) return result;
      }
      throw new Error('Invalid protobuf integer.');
    };
    while (offset < bytes.length) {
      const tag = Number(varint());
      const field = Math.floor(tag / 8);
      if (field < 1 || field > 0x1fffffff) throw new Error('Invalid protobuf field.');
      let value: WireValue;
      switch (tag % 8) {
        case 0:
          value = varint();
          break;
        case 1: {
          const data = take(8);
          value = new DataView(data.buffer).getFloat64(0, true);
          break;
        }
        case 2:
          value = take(Number(varint()));
          break;
        case 5: {
          const data = take(4);
          value = new DataView(data.buffer).getFloat32(0, true);
          break;
        }
        default:
          throw new Error('The QC returned an unsupported protobuf wire type.');
      }
      const values = this.fields.get(field) ?? [];
      values.push(value);
      this.fields.set(field, values);
    }
  }

  has(field: number) {
    return this.fields.has(field);
  }

  number(field: number, fallback = 0): number {
    const value = this.fields.get(field)?.at(-1);
    return typeof value === 'number' || typeof value === 'bigint' ? Number(value) : fallback;
  }

  signed(field: number, fallback = 0): number {
    const value = this.fields.get(field)?.at(-1);
    return typeof value === 'bigint' ? Number(BigInt.asIntN(32, value)) : fallback;
  }

  bytes(field: number): Uint8Array<ArrayBuffer> | undefined {
    const value = this.fields.get(field)?.at(-1);
    return value instanceof Uint8Array ? value : undefined;
  }

  text(field: number): string {
    const value = this.bytes(field);
    return value ? new TextDecoder().decode(value) : '';
  }

  messages(field: number): ProtoMessage[] {
    return (this.fields.get(field) ?? [])
      .filter((value): value is Uint8Array<ArrayBuffer> => value instanceof Uint8Array)
      .map((value) => new ProtoMessage(value));
  }

  strings(field: number): string[] {
    return (this.fields.get(field) ?? [])
      .filter((value): value is Uint8Array<ArrayBuffer> => value instanceof Uint8Array)
      .map((value) => new TextDecoder().decode(value));
  }

  integers(field: number): number[] {
    const values: number[] = [];
    for (const value of this.fields.get(field) ?? []) {
      if (typeof value === 'bigint') values.push(Number(value));
      else if (value instanceof Uint8Array) {
        let integer = 0n;
        let shift = 0n;
        for (const byte of value) {
          if (shift >= 70n) throw new Error('Invalid packed protobuf integer.');
          integer |= BigInt(byte & 0x7f) << shift;
          if (byte & 0x80) shift += 7n;
          else {
            values.push(Number(integer));
            integer = 0n;
            shift = 0n;
          }
        }
        if (shift) throw new Error('Truncated packed protobuf integer.');
      }
    }
    return values;
  }
}

function varint(value: number): number[] {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid request integer.');
  let remaining = BigInt(value);
  const bytes: number[] = [];
  do {
    const byte = Number(remaining & 0x7fn);
    remaining >>= 7n;
    bytes.push(byte | (remaining ? 0x80 : 0));
  } while (remaining);
  return bytes;
}

export function encodeFields(fields: Record<number, number | boolean | string>): Uint8Array {
  const bytes: number[] = [];
  for (const [key, value] of Object.entries(fields)) {
    const field = Number(key);
    if (typeof value === 'string') {
      const text = new TextEncoder().encode(value);
      bytes.push(...varint(field * 8 + 2), ...varint(text.length), ...text);
    } else {
      bytes.push(...varint(field * 8), ...varint(Number(value)));
    }
  }
  return new Uint8Array(bytes);
}
