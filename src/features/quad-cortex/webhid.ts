// Local WebHID declarations keep the repository's current dependencies.
export interface HidReport {
  reportId: number;
  items: { reportSize: number; reportCount: number }[];
}

export interface HidCollection {
  inputReports: HidReport[];
  outputReports: HidReport[];
  children: HidCollection[];
}

export interface HidInputEvent extends Event {
  reportId: number;
  data: DataView;
}

export interface QcHidDevice {
  vendorId: number;
  productId: number;
  productName: string;
  opened: boolean;
  collections: HidCollection[];
  open(): Promise<void>;
  close(): Promise<void>;
  sendReport(reportId: number, data: Uint8Array<ArrayBuffer>): Promise<void>;
  addEventListener(type: 'inputreport', listener: (event: HidInputEvent) => void): void;
  removeEventListener(type: 'inputreport', listener: (event: HidInputEvent) => void): void;
}

interface HidConnectionEvent extends Event {
  device: QcHidDevice;
}

export interface HidApi {
  requestDevice(options: {
    filters: { vendorId: number; productId: number }[];
  }): Promise<QcHidDevice[]>;
  addEventListener(type: 'disconnect', listener: (event: HidConnectionEvent) => void): void;
  removeEventListener(type: 'disconnect', listener: (event: HidConnectionEvent) => void): void;
}

export function hidApi(): HidApi | undefined {
  return (navigator as Navigator & { hid?: HidApi }).hid;
}

export function supportError(): string | undefined {
  if (!window.isSecureContext) return 'Open this app on HTTPS or localhost to use USB devices.';
  if (!hidApi()) return 'WebHID is unavailable. Open this app in desktop Chrome or Edge.';
  if (typeof DecompressionStream === 'undefined') {
    return 'This browser cannot decompress QC data. Update desktop Chrome or Edge.';
  }
}

export function isQcControlInterface(device: QcHidDevice): boolean {
  if (device.vendorId !== 0x152a || ![0x880a, 0x892f].includes(device.productId)) return false;
  const collections = (items: HidCollection[]): HidCollection[] =>
    items.flatMap((item) => [item, ...collections(item.children)]);
  const reports = collections(device.collections);
  const matches = (report: HidReport, id: number) =>
    report.reportId === id &&
    report.items.reduce((bits, item) => bits + item.reportSize * item.reportCount, 0) === 1024;
  return (
    reports.some((item) => item.inputReports.some((report) => matches(report, 1))) &&
    reports.some((item) => item.outputReports.some((report) => matches(report, 2)))
  );
}

export function isWindowsHost(): boolean {
  const browser = navigator as Navigator & { userAgentData?: { platform: string } };
  return browser.userAgentData?.platform === 'Windows' || /^Win/i.test(navigator.platform);
}
