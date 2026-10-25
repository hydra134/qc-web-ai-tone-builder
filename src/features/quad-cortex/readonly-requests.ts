import { encodeFields } from './protobuf';
import { COMMAND } from './protocol';

// Read-only means no changes to presets or hardware settings. The QC still
// requires session negotiation, keepalive messages, and transmitted READ
// requests before it will return state. There is deliberately no escape hatch
// for Grid updates, preset recalls, scene changes, saves, or parameter writes.
const READ_COMMANDS = new Set<number>([
  COMMAND.version,
  COMMAND.position,
  COMMAND.ioSettings,
  COMMAND.generalSettings,
  COMMAND.scene,
  COMMAND.mode,
  COMMAND.recallPreset,
  COMMAND.masterVolume,
  COMMAND.undoRedo,
  COMMAND.globalTempo,
  COMMAND.presetDirty,
  COMMAND.moduleStats,
  COMMAND.globalEq,
  COMMAND.modelRepo,
]);

type Fields = Record<number, number | boolean | string>;

function onlyFields(fields: Fields, allowed: number[]): boolean {
  return Object.keys(fields).every((field) => allowed.includes(Number(field)));
}

function requestId(value: number | boolean | string | undefined): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 0xffffffff;
}

export function encodeReadOnlyRequest(command: number, fields: Fields): Uint8Array {
  const readRequest =
    READ_COMMANDS.has(command) &&
    fields[1] === 3 &&
    (
      requestId(fields[2]) ||
      (command === COMMAND.version && (fields[2] === undefined || fields[2] === 0))
    ) &&
    onlyFields(fields, [1, 2]);

  const resetSession =
    command === COMMAND.resetCommsBuffers &&
    (fields[1] === undefined || fields[1] === 0 || requestId(fields[1])) &&
    typeof fields[2] === 'string' &&
    /^[0-9a-f]{32}$/i.test(fields[2]) &&
    onlyFields(fields, [1, 2]);

  const announceClient =
    command === COMMAND.version &&
    fields[1] === 1 &&
    requestId(fields[2]) &&
    typeof fields[11] === 'string' &&
    /^v?\d+\.\d+(?:\.\d+)?$/.test(fields[11]) &&
    onlyFields(fields, [1, 2, 11]);

  const connection =
    command === COMMAND.connection &&
    (fields[1] === undefined || fields[1] === 0 || requestId(fields[1])) &&
    typeof fields[2] === 'boolean' &&
    onlyFields(fields, [1, 2]);

  const heartbeat =
    command === COMMAND.keepAlive &&
    fields[1] === 1 &&
    fields[3] === true &&
    onlyFields(fields, [1, 3]);

  if (!readRequest && !resetSession && !announceClient && !connection && !heartbeat) {
    throw new Error('Blocked an outgoing message outside the read-only QC protocol.');
  }
  return encodeFields(fields);
}
