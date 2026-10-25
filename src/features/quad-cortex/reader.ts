// Session sequence adapted from qc-mcp/transport.py. See THIRD_PARTY_NOTICES.md.
import { readCatalog } from './catalog';
import {
  HidAccessError,
  hidAccessMessage,
  isAmbiguousWriteCompletion,
} from './hid-errors';
import { decodePreset } from './preset';
import type { CurrentPreset } from './preset';
import { encodeReadOnlyRequest } from './readonly-requests';
import type { ProtoMessage } from './protobuf';
import { COMMAND, decodeMessage, Reassembler, reportsFor } from './protocol';
import { hidApi, isQcControlInterface, isWindowsHost, supportError } from './webhid';
import type { HidInputEvent, QcHidDevice } from './webhid';

export interface PresetSnapshot {
  preset: CurrentPreset;
  firmware: string;
  deviceName: string;
  mini: boolean;
  readAt: Date;
}

class ReadTimeout extends Error {}

interface PendingRead {
  command: number;
  requestId: number;
  accepts: (body: ProtoMessage) => boolean;
  acceptBroadcast: boolean;
  resolve: (body: ProtoMessage) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  fallback?: ProtoMessage;
}

async function within<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ReadTimeout(message)), milliseconds);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

class QcSession {
  private readonly reassembler = new Reassembler();
  private readonly pending = new Set<PendingRead>();
  private outbound: Promise<void> = Promise.resolve();
  private inbound: Promise<void> = Promise.resolve();
  private failure: Error | null = null;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private heartbeatSending = false;
  private nextId = 0x51c00000;
  private ownsSession = false;
  private closing = false;
  private closeTask: Promise<void> | undefined;
  private readonly windowsQc: boolean;
  private writeCompletionErrors = 0;
  private inputReports = 0;
  private decodedMessages = 0;
  private readonly inputReportIds = new Set<number>();
  private readonly receivedCommands = new Map<number, { count: number; requestId: number }>();
  private version: ProtoMessage | undefined;

  constructor(private readonly device: QcHidDevice) {
    this.windowsQc = isWindowsHost() && isQcControlInterface(device);
  }

  private readonly onInput = (event: HidInputEvent) => {
    if (this.closing || this.failure) return;
    this.inputReports += 1;
    this.inputReportIds.add(event.reportId);
    if (event.reportId !== 1) return;
    try {
      const bytes = this.reassembler.feed(event.data);
      if (!bytes) return;
      // Keep decompression ordered even when several input reports arrive together.
      this.inbound = this.inbound
        .then(async () => {
          if (this.closing || this.failure) return;
          const { command, body } = await decodeMessage(bytes);
          this.decodedMessages += 1;
          const responseId = body.number(2);
          const previous = this.receivedCommands.get(command);
          this.receivedCommands.set(command, {
            count: (previous?.count ?? 0) + 1,
            requestId: responseId,
          });
          if (command === COMMAND.version && body.text(4)) this.version = body;
          for (const request of this.pending) {
            if (request.command !== command || !request.accepts(body)) continue;
            if (
              responseId === request.requestId ||
              (request.acceptBroadcast && responseId === 0)
            ) {
              clearTimeout(request.timer);
              this.pending.delete(request);
              request.resolve(body);
            } else if (request.acceptBroadcast) {
              // Like qc-mcp.request(), prefer the exact request ID, but retain
              // fresh metadata from this session when a command does not echo
              // it. RecallPreset never opts into this fallback.
              request.fallback = body;
            }
          }
        })
        .catch((error: unknown) => this.abort(asError(error)));
    } catch (error) {
      this.abort(asError(error));
    }
  };

  abort(error: Error) {
    this.failure ??= error;
    if (this.heartbeat !== undefined) clearInterval(this.heartbeat);
    for (const request of this.pending) {
      clearTimeout(request.timer);
      request.reject(this.failure);
    }
    this.pending.clear();
  }

  private async write(command: number, fields: Record<number, number | boolean | string>) {
    for (const report of reportsFor(command, encodeReadOnlyRequest(command, fields))) {
      await within(
        this.device.sendReport(2, report).catch((error: unknown) => {
          if (this.windowsQc && isAmbiguousWriteCompletion(error)) {
            // qc-mcp/docs/WINDOWS.md: ERROR_GEN_FAILURE(31) can be returned
            // even though the QC received the report. WebHID hides that native
            // code behind this generic rejection. Continue the read exchange,
            // without resending the report, and require a matching QC reply.
            // All other errors and all other platforms still fail immediately.
            this.writeCompletionErrors += 1;
            return;
          }
          throw new HidAccessError('sendReport', error);
        }),
        4000,
        'USB sending timed out. Close Cortex Control and reconnect the QC.',
      );
    }
  }

  private send(command: number, fields: Record<number, number | boolean | string>): Promise<void> {
    const task = this.outbound.then(async () => {
      if (this.failure) throw this.failure;
      if (this.closing) throw new DOMException('Reading was cancelled.', 'AbortError');
      // A complete logical message owns the queue, including every HID chunk.
      await this.write(command, fields);
    });
    this.outbound = task.catch(() => undefined);
    return task;
  }

  private request(
    command: number,
    label: string,
    accepts: (body: ProtoMessage) => boolean,
    timeout = 6000,
    acceptBroadcast = false,
  ): Promise<ProtoMessage> {
    if (this.failure) return Promise.reject(this.failure);
    const requestId = ++this.nextId;
    return new Promise((resolve, reject) => {
      const request: PendingRead = {
        command, requestId, accepts, acceptBroadcast, resolve, reject,
        timer: setTimeout(() => {
          this.pending.delete(request);
          if (request.fallback) {
            resolve(request.fallback);
            return;
          }
          reject(new ReadTimeout(this.timeoutMessage(label)));
        }, timeout),
      };
      this.pending.add(request);
      void this.send(command, { 1: 3, 2: requestId }).catch((error: unknown) => {
        this.abort(asError(error));
      });
    });
  }


  private timeoutMessage(label: string): string {
    const state = this.inputReports === 0
      ? 'Chrome received zero HID input reports from the QC.'
      : this.decodedMessages === 0
        ? 'Chrome received HID input reports, but no complete QC message was decoded.'
        : 'QC messages arrived, but none satisfied this read.';
    const commands = [...this.receivedCommands.entries()]
      .map(([command, info]) => command + ' (count ' + info.count + ', last request ' + info.requestId + ')')
      .join('; ') || 'none';
    return 'Timed out reading ' + label + '. ' + state +
      ' USB diagnostics: input reports=' + this.inputReports +
      ', report IDs=' + ([...this.inputReportIds].join(',') || 'none') +
      ', decoded messages=' + this.decodedMessages +
      ', write-completion errors=' + this.writeCompletionErrors +
      ', commands=' + commands + '. No preset result was accepted.';
  }

  private async settle(milliseconds: number) {
    await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
    if (this.failure) throw this.failure;
  }

  private async detectVersion(): Promise<ProtoMessage> {
    let lastTimeout: ReadTimeout | undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (this.version) return this.version;
      try {
        return await this.request(
          COMMAND.version,
          'device firmware',
          (body) => Boolean(body.text(4)),
          3000,
          true,
        );
      } catch (error) {
        if (!(error instanceof ReadTimeout)) throw error;
        lastTimeout = error;
        if (attempt < 2) await this.settle(500);
      }
    }
    throw lastTimeout ?? new ReadTimeout(this.timeoutMessage('device firmware'));
  }

  private startHeartbeat() {
    const beat = () => {
      if (this.heartbeatSending || this.closing || this.failure) return;
      this.heartbeatSending = true;
      void this.send(COMMAND.keepAlive, { 1: 1, 3: true })
        .catch((error: unknown) => this.abort(asError(error)))
        .finally(() => { this.heartbeatSending = false; });
    };
    beat();
    this.heartbeat = setInterval(beat, 200);
  }

  async read(progress: (message: string) => void): Promise<PresetSnapshot> {
    progress('Opening the USB connection…');
    await within(
      this.device.open().catch((error: unknown) => {
        throw new HidAccessError('open', error);
      }).then(async () => {
        // open() cannot be aborted. Release a handle that arrives after timeout
        // or cancellation, even if the regular close path has already finished.
        if (this.closing || this.failure) {
          await this.device.close();
          throw this.failure ?? new DOMException('Reading was cancelled.', 'AbortError');
        }
      }),
      8000,
      'Opening the QC timed out. Close Cortex Control and reconnect the device.',
    );
    if (this.failure) throw this.failure;
    this.device.addEventListener('inputreport', this.onInput);
    progress('Establishing a QC session…');
    // ResetCommsBuffers and Connection have no action field: their request ID
    // is field 1. Do not apply the usual action/request-id envelope to them.
    this.ownsSession = true;
    // Follow QuadCortex.open() and _handshake(): heartbeat first, reset with
    // the default request ID, then a short Version probe. Do not gate the rest
    // of startup on that probe; qc-mcp detects firmware after subscribing.
    this.startHeartbeat();
    await this.send(COMMAND.resetCommsBuffers, {
      2: crypto.randomUUID().replaceAll('-', ''),
    });
    await this.settle(150);
    await this.send(COMMAND.version, { 1: 3 });
    await this.settle(150);
    // This is the client-version announcement, not a claim about the device.
    // qc-mcp uses its latest supported client version when the probe is silent.
    const clientVersion = this.version?.text(4) || '4.1.0';
    await this.send(COMMAND.version, { 1: 1, 2: ++this.nextId, 11: clientVersion });
    await this.settle(150);
    await this.send(COMMAND.connection, { 2: true });

    // These READ subscriptions mirror Cortex Control's startup burst. Session
    // and heartbeat updates are the only non-READ messages sent by this reader.
    // Install the catalog waiter before the startup burst; the catalog can be
    // delivered while the other subscriptions are being sent. Handle rejection
    // immediately, even if another startup send fails before we await the result.
    const catalogRead = this.request(
      COMMAND.modelRepo, 'the model catalog', (body) => Boolean(body.bytes(3)?.length), 15000, true,
    ).then(
      (body) => ({ body }),
      (error: unknown) => ({ error: asError(error) }),
    );
    for (const command of [
      COMMAND.moduleStats, COMMAND.undoRedo, COMMAND.ioSettings,
      COMMAND.generalSettings, COMMAND.mode, COMMAND.globalEq, COMMAND.masterVolume,
      COMMAND.globalTempo, COMMAND.scene, COMMAND.presetDirty, COMMAND.position,
    ]) {
      await this.send(command, { 1: 3, 2: ++this.nextId });
    }
    await this.settle(700);

    progress('Reading device firmware after session startup…');
    const version = await this.detectVersion();
    const firmware = version.text(4); // app_fw_version is a build hash, not CorOS.
    const match = /^v?(\d+)\.(\d+)(?:\.|$)/.exec(firmware);
    if (!match || Number(match[1]) < 4) {
      throw new Error('Unsupported CorOS version: ' + firmware + '. This reader targets CorOS 4.0 and 4.1.');
    }

    progress('Reading the device’s model and parameter catalog…');
    const catalogResult = await catalogRead;
    if ('error' in catalogResult) throw catalogResult.error;
    const catalogPayload = catalogResult.body.bytes(3);
    if (!catalogPayload) throw new Error('The QC returned no device catalog.');
    const catalog = await readCatalog(catalogPayload);

    progress('Reading the current preset…');
    const response = await this.request(
      COMMAND.recallPreset, 'the current preset', (body) => Boolean(body.bytes(3)?.length), 10000,
    );
    const payload = response.bytes(3);
    if (!payload) throw new Error('The QC returned no preset data.');
    const scene = await this.request(
      COMMAND.scene, 'the active scene', (body) => body.number(1) !== 3, 3000, true,
    ).catch((error: unknown) => {
      if (error instanceof ReadTimeout) return null;
      throw error;
    });
    progress('Resolving blocks and parameter values…');
    const mini = version.number(12) === 1 || this.device.productId === 0x892f;
    const preset = await decodePreset(payload, catalog, scene ? scene.number(3) : null, mini);
    if (Number(match[1]) > 4 || Number(match[2]) > 1) {
      preset.warnings.push('This firmware is newer than the CorOS 4.0/4.1 reference schemas.');
    }
    if (this.failure) throw this.failure;
    if (this.writeCompletionErrors) {
      preset.warnings.push(
        'Windows reported USB write-completion errors. The QC returned a preset matching this read request.',
      );
    }
    return {
      preset,
      firmware,
      deviceName: version.text(15) || this.device.productName || (mini ? 'Quad Cortex mini' : 'Quad Cortex'),
      mini,
      readAt: new Date(),
    };
  }

  close(): Promise<void> {
    this.closeTask ??= this.finishClosing();
    return this.closeTask;
  }

  private async finishClosing() {
    this.closing = true;
    if (this.heartbeat !== undefined) clearInterval(this.heartbeat);
    this.abort(new DOMException('Reading was cancelled.', 'AbortError'));
    this.device.removeEventListener('inputreport', this.onInput);
    await this.outbound;
    if (this.device.opened && this.ownsSession) {
      await this.write(COMMAND.connection, { 1: ++this.nextId, 2: false }).catch(() => undefined);
    }
    if (this.device.opened) {
      await within(
        this.device.close().catch((error: unknown) => {
          throw new HidAccessError('close', error);
        }),
        3000,
        'Closing the USB connection timed out.',
      );
    }
  }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function readError(error: unknown): string {
  const failure = asError(error);
  if (failure instanceof HidAccessError) return hidAccessMessage(failure);
  switch (failure.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Chrome refused HID access. Browser detail: ' + failure.name + ': ' + failure.message;
    case 'NotFoundError':
      return 'No Quad Cortex was selected. Connect it by USB and choose it in the device picker.';
    case 'NetworkError':
    case 'NotReadableError':
    case 'InvalidStateError':
      return 'The QC USB connection is unavailable. Close Cortex Control, reconnect the device, and try again.';
    case 'AbortError':
      return 'Reading was cancelled.';
    default:
      return failure.message || 'Reading the current preset failed.';
  }
}

export class QcPresetReader {
  private device: QcHidDevice | undefined;
  private session: QcSession | undefined;
  private busy = false;
  private generation = 0;

  cancel() {
    ++this.generation;
    this.session?.abort(new DOMException('Reading was cancelled.', 'AbortError'));
    void this.session?.close().catch(() => undefined);
  }

  async read(progress: (message: string) => void): Promise<PresetSnapshot> {
    if (this.busy) throw new Error('A preset read is already in progress.');
    const unavailable = supportError();
    const api = hidApi();
    if (unavailable || !api) throw new Error(unavailable ?? 'WebHID is unavailable.');
    this.busy = true;
    const generation = ++this.generation;
    let session: QcSession | undefined;
    let readFailed = false;
    const onDisconnect = (event: { device: QcHidDevice }) => {
      if (event.device === this.device) {
        this.device = undefined;
        session?.abort(new Error('The Quad Cortex was disconnected. Reconnect it and try again.'));
      }
    };
    api.addEventListener('disconnect', onDisconnect);
    try {
      if (!this.device) {
        progress('Select your Quad Cortex in the browser’s USB device picker…');
        // Invoked before any await, preserving the button click's user activation.
        const selected = await api.requestDevice({
          filters: [
            { vendorId: 0x152a, productId: 0x880a },
            { vendorId: 0x152a, productId: 0x892f },
          ],
        }).catch((error: unknown) => {
          throw new HidAccessError('requestDevice', error);
        });
        this.device = selected.find(isQcControlInterface);
        if (!this.device) {
          throw new Error(selected.length
            ? 'The QC control interface is unavailable. Close Cortex Control and reconnect the QC.'
            : 'No Quad Cortex was selected. Connect it by USB and choose it in the device picker.');
        }
      }
      if (generation !== this.generation) throw new DOMException('Reading was cancelled.', 'AbortError');
      session = new QcSession(this.device);
      this.session = session;
      const snapshot = await session.read(progress);
      if (generation !== this.generation) throw new DOMException('Reading was cancelled.', 'AbortError');
      return snapshot;
    } catch (error) {
      readFailed = true;
      // A fresh picker on the next attempt also recovers revoked permissions
      // and a reconnected device whose previous HIDDevice object became stale.
      this.device = undefined;
      throw error;
    } finally {
      api.removeEventListener('disconnect', onDisconnect);
      try {
        await session?.close();
      } catch (error) {
        this.device = undefined;
        // Preserve the original read failure if releasing the failed connection
        // also fails; otherwise the useful browser error would be overwritten.
        if (!readFailed) throw error;
      } finally {
        this.session = undefined;
        this.busy = false;
      }
    }
  }
}
