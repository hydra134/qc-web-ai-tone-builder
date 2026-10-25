// Catalog parsing and display scaling adapted from qc-mcp/catalog.py.
// See THIRD_PARTY_NOTICES.md.
import { decompress } from './protocol';

export interface CatalogParameter {
  name: string;
  type: string;
  unit: string;
  min?: number;
  max?: number;
  skew?: number;
  steps: string[];
  stepCount?: number;
  minText: string;
  maxText: string;
  midText: string;
}

export interface CatalogModel {
  id: number;
  name: string;
  basedOn: string;
  category: string;
  parameters: CatalogParameter[];
}

export type Catalog = Map<number, CatalogModel>;
export interface StoredValue {
  value: number | string;
  kind: 'float' | 'integer' | 'string';
}
export interface DisplayValue {
  text: string;
  unit: string;
  note?: string;
}

const SYMBOLIC: Record<string, number> = {
  MIN_MIXER_DB: -40,
  MAX_MIXER_DB: 12,
};
const numberFormat = new Intl.NumberFormat('en', { maximumFractionDigits: 4 });

function bound(text: string | null): number | undefined {
  if (!text?.trim()) return;
  const literal = Number(text);
  return Number.isFinite(literal) ? literal : SYMBOLIC[text];
}

function archiveXml(bytes: Uint8Array): string {
  const decoder = new TextDecoder();
  if (decoder.decode(bytes.subarray(0, 100)).trimStart().startsWith('<')) {
    return decoder.decode(bytes);
  }
  for (let offset = 0; offset + 512 <= bytes.length; ) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const string = (start: number, end: number) =>
      decoder.decode(header.subarray(start, end)).split('\0')[0].trim();
    const name = string(0, 100);
    const sizeText = string(124, 136);
    if (!/^[0-7]+$/.test(sizeText)) throw new Error('Invalid model catalog archive.');
    const size = Number.parseInt(sizeText, 8);
    const start = offset + 512;
    if (!Number.isSafeInteger(size) || start + size > bytes.length) {
      throw new Error('The model catalog archive is truncated.');
    }
    // Read in memory only; never extract file paths onto the filesystem.
    if (name.split('/').at(-1) === 'ModelRepo.xml' && [0, 48].includes(header[156])) {
      return decoder.decode(bytes.subarray(start, start + size));
    }
    offset = start + Math.ceil(size / 512) * 512;
  }
  throw new Error('ModelRepo.xml was not found in the device catalog.');
}

export async function readCatalog(payload: Uint8Array): Promise<Catalog> {
  const xml = archiveXml(await decompress(payload));
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (document.querySelector('parsererror')) throw new Error('The QC returned an invalid catalog.');
  const catalog: Catalog = new Map();
  for (const category of document.querySelectorAll('Category')) {
    for (const model of Array.from(category.children).filter((child) => child.tagName === 'Model')) {
      const id = Number(model.getAttribute('id'));
      if (!Number.isSafeInteger(id) || id <= 0) continue;
      const parameters = Array.from(model.children)
        .filter((child) => child.tagName === 'Parameter')
        .map((parameter): CatalogParameter => {
          const declaredSkew = parameter.getAttribute('skew');
          return {
            name: parameter.getAttribute('name') || 'Unnamed parameter',
            type: parameter.getAttribute('type') || 'float',
            unit: parameter.getAttribute('units') || '',
            min: bound(parameter.getAttribute('min')),
            max: bound(parameter.getAttribute('max')),
            skew: declaredSkew === 'LIN_SKEW' ? 1 : bound(declaredSkew),
            steps: parameter.getAttribute('stepNames')?.split(',').map((step) => step.trim()) ?? [],
            stepCount: bound(parameter.getAttribute('steps')),
            minText: parameter.getAttribute('min_string') || '',
            maxText: parameter.getAttribute('max_string') || '',
            midText: parameter.getAttribute('mid_string') || '',
          };
        });
      catalog.set(id, {
        id,
        name: model.getAttribute('name') || 'Model #' + id,
        basedOn: model.getAttribute('tm') || '',
        category: category.getAttribute('name') || '',
        parameters,
      });
    }
  }
  if (!catalog.size) throw new Error('The QC returned an empty device catalog.');
  return catalog;
}

export function displayValue(
  stored: StoredValue | undefined,
  parameter: CatalogParameter | undefined,
  dynamicSteps: string[] = [],
): DisplayValue {
  if (!stored) return { text: 'Not returned', unit: '' };
  if (typeof stored.value === 'string') return { text: stored.value || '(empty)', unit: '' };
  const value = stored.value;
  if (!Number.isFinite(value)) return { text: String(value), unit: '', note: 'Invalid device value.' };
  if (!parameter) {
    return {
      text: numberFormat.format(value),
      unit: '',
      note: stored.kind === 'float' ? 'Raw value; parameter is absent from the catalog.' : 'Raw integer.',
    };
  }

  const discrete = ['switch', 'rotarySwitch', 'comboBox', 'toggleButton'].includes(parameter.type);
  const steps = dynamicSteps.length ? dynamicSteps : parameter.steps;
  if (discrete) {
    const count = dynamicSteps.length || parameter.stepCount || steps.length;
    if (count > 0) {
      const index = stored.kind === 'integer' ? value : Math.round(value * (count - 1));
      if (index >= 0 && index < count && Number.isInteger(index)) {
        if (steps[index]) return { text: steps[index], unit: '' };
        if (count === 2 && !steps.length) return { text: index ? 'On' : 'Off', unit: '' };
        return { text: numberFormat.format(index), unit: '', note: 'Discrete option index.' };
      }
    }
  }
  if (stored.kind === 'integer') {
    return { text: numberFormat.format(value), unit: parameter.unit };
  }
  const { min, max, skew } = parameter;
  if (min === undefined || max === undefined || max <= min || value < 0 || value > 1) {
    return {
      text: numberFormat.format(value),
      unit: '',
      note: 'Raw normalized value; the display range is unknown.',
    };
  }
  if (value === 0 && parameter.minText) return { text: parameter.minText, unit: '' };
  if (value === 1 && parameter.maxText) return { text: parameter.maxText, unit: '' };
  if (value === 0.5 && parameter.midText) return { text: parameter.midText, unit: '' };
  const estimated = !(skew !== undefined && skew > 0) && min > 0 && max / min >= 5;
  const exponent = skew !== undefined && skew > 0 ? 1 / skew : estimated ? 1.667 : 1;
  const converted = min + (max - min) * value ** exponent;
  return {
    text: (estimated ? '≈ ' : '') + numberFormat.format(converted),
    unit: parameter.unit,
    note: estimated ? 'Display taper estimated using the qc-mcp fallback.' : undefined,
  };
}
