export type HidOperation = 'requestDevice' | 'open' | 'sendReport' | 'close';

// Keep the browser's DOMException and the operation together. Device-picker
// permission, OS handle access, and report access can fail with the same name.
export class HidAccessError extends Error {
  readonly browserName: string;

  constructor(
    readonly operation: HidOperation,
    cause: unknown,
  ) {
    const browserError = cause instanceof Error || cause instanceof DOMException ? cause : null;
    super(browserError?.message || String(cause), { cause });
    this.name = 'HidAccessError';
    this.browserName = browserError?.name || 'Error';
  }
}

export function hidAccessMessage(error: HidAccessError): string {
  const detail = ' Browser detail: ' + error.browserName + ': ' + error.message;
  switch (error.operation) {
    case 'requestDevice':
      if (error.browserName === 'NotFoundError') {
        return 'No Quad Cortex was selected in the device picker.' + detail;
      }
      if (error.browserName === 'SecurityError') {
        return 'Chrome blocked the USB device picker. Open the app directly in a Chrome tab and click Read current preset. Check whether the browser or site policy blocks HID devices.' + detail;
      }
      return 'Chrome did not grant device-picker access. Check this site’s HID-device permission in Chrome and try again.' + detail;
    case 'open':
      return 'The QC was selected, but Chrome could not open its HID interface. Close Cortex Control, qc-mcp/Patchbay, and any other QC client or browser tab. Reconnect the QC by USB and retry. If it still fails, check Chrome’s device log for the operating-system error.' + detail;
    case 'sendReport':
      // Chromium uses NotAllowedError for native write failures too. The name
      // alone does not establish that report access or permission was blocked.
      return 'The QC connection opened, but sending output report 2 failed. Check chrome://device-log for the native HID error; this browser error does not identify the underlying cause.' + detail;
    case 'close':
      return 'Chrome could not close the QC USB connection. Reconnect the device before retrying.' + detail;
  }
}

export function isAmbiguousWriteCompletion(error: unknown): boolean {
  return (
    (error instanceof Error || error instanceof DOMException) &&
    error.name === 'NotAllowedError' &&
    error.message === 'Failed to write the report.'
  );
}
