// Full snapshots use array positions for rows, columns and parameters;
// explicit row/column/index fields belong to edit deltas (qc-mcp/PROTOCOL.md §5).
import { displayValue } from './catalog';
import type { Catalog, DisplayValue, StoredValue } from './catalog';
import { ProtoMessage } from './protobuf';
import { decompress } from './protocol';

export interface PresetParameter {
  index: number;
  name: string;
  value: DisplayValue;
  sceneValues: DisplayValue[];
  sceneMode: boolean;
  expression: string | null;
}

export type BlockKind = 'effect' | 'input' | 'output' | 'splitter' | 'mixer' | 'combined splitter';

export interface PresetBlock {
  key: string;
  modelId: number;
  name: string;
  basedOn: string;
  category: string;
  row: number;
  column: number | null;
  kind: BlockKind;
  bypassed: boolean | null;
  parameters: PresetParameter[];
}

export interface PresetRow {
  index: number;
  inputPort: number;
  outputPort: number;
  splitPoints: { split: number; mix: number }[];
  blocks: PresetBlock[];
}

export interface CurrentPreset {
  name: string;
  tempo: number | null;
  sceneIndex: number;
  sceneIsCurrent: boolean;
  sceneName: string;
  sceneLabels: string[];
  rows: PresetRow[];
  warnings: string[];
}

function storedValue(message: ProtoMessage | undefined): StoredValue | undefined {
  if (!message) return;
  if (message.has(3)) return { value: message.text(3), kind: 'string' };
  if (message.has(2)) return { value: message.number(2), kind: 'float' };
  if (message.has(1)) return { value: message.signed(1), kind: 'integer' };
}

function bypassValue(values: ProtoMessage[], scene: number): boolean | null {
  const selected = values.length === 1 ? values[0] : values[scene];
  return selected ? Boolean(selected.number(1)) : null;
}

export async function decodePreset(
  payload: Uint8Array,
  catalog: Catalog,
  currentScene: number | null,
  mini: boolean,
): Promise<CurrentPreset> {
  const preset = new ProtoMessage(await decompress(payload));
  const chains = preset.messages(11);
  if (!chains.length || chains.length > 4) {
    throw new Error('The QC returned an unsupported or incomplete preset grid.');
  }
  const warnings = new Set<string>();
  const validScene = currentScene !== null && currentScene >= 0 && currentScene < 8;
  const scene = validScene ? currentScene : preset.number(7);
  if (scene < 0 || scene >= 8) throw new Error('The QC returned an invalid scene index.');
  if (!validScene) warnings.add('The active scene was unavailable. Values use the preset’s default scene.');
  const bypassRows = preset.messages(18);
  const sceneLabels = preset.strings(15);
  const sceneTempos = preset.integers(14);
  const sceneName = mini ? ['AI', 'BI', 'CI', 'DI', 'AII', 'BII', 'CII', 'DII'][scene] : 'ABCDEFGH'[scene];

  const rows = chains.map((chain, row): PresetRow => {
    const splitPoints = chain.messages(6).map((point) => ({
      split: point.signed(1),
      mix: point.signed(2),
    }));
    const bypassColumns = bypassRows[row]?.messages(1) ?? [];
    const blocks: PresetBlock[] = [];

    const add = (
      model: ProtoMessage,
      kind: BlockKind,
      index: number,
      column: number | null,
      bypassed: boolean | null,
    ) => {
      const modelId = model.number(1);
      if (!modelId) return; // Empty slots still count toward full-grid array positions.
      const definition = catalog.get(modelId);
      if (!definition) warnings.add('Some models are absent from the device catalog; their IDs and raw values are shown.');
      const wireParameters = model.messages(2);
      const parameters = Array.from(
        { length: Math.max(wireParameters.length, definition?.parameters.length ?? 0) },
        (_, parameterIndex): PresetParameter => {
          const wire = wireParameters[parameterIndex];
          const metadata = definition?.parameters[parameterIndex];
          const values = wire?.messages(5).map(storedValue) ?? [];
          const sceneMode = Boolean(wire?.number(4));
          const selected = values.length === 1 || !sceneMode ? values[0] : values[scene];
          const dynamicSteps = wire?.strings(8) ?? [];
          const value = displayValue(selected, metadata, dynamicSteps);
          if (value.note?.startsWith('Raw')) {
            warnings.add('Some display ranges are unknown. Those values are explicitly labeled as raw.');
          }
          const expressionId = wire?.signed(1) ?? 0;
          return {
            index: parameterIndex,
            name: metadata?.name ?? 'Parameter ' + parameterIndex,
            value,
            sceneMode,
            sceneValues: sceneMode
              ? values.map((value) => displayValue(value, metadata, dynamicSteps))
              : [],
            expression: expressionId > 0
              ? 'Expression ' + expressionId
              : null,
          };
        },
      );
      // Lane controls have no entry in the grid bypass matrix. A BYPASS
      // parameter, when present, is the only bypass state we can report there.
      if (bypassed === null && (kind === 'input' || kind === 'output')) {
        const bypassIndex = definition?.parameters.findIndex((parameter) => parameter.name === 'BYPASS') ?? -1;
        const wire = wireParameters[bypassIndex];
        const values = wire?.messages(5) ?? [];
        const selected = values.length === 1 || !wire?.number(4) ? values[0] : values[scene];
        const value = storedValue(selected)?.value;
        if (typeof value === 'number' && (value === 0 || value === 1)) bypassed = Boolean(value);
      }
      blocks.push({
        key: row + '-' + kind + '-' + index,
        modelId,
        name: definition?.name ?? 'Unknown model #' + modelId,
        basedOn: definition?.basedOn ?? '',
        category: definition?.category ?? '',
        row,
        column,
        kind,
        bypassed,
        parameters,
      });
    };

    chain.messages(13).forEach((model, index) => add(model, 'input', index, null, null));
    chain.messages(5).forEach((model, column) => {
      if (column > 7 && model.number(1)) throw new Error('The QC returned an unsupported grid width.');
      const bypass = bypassColumns[column];
      add(
        model,
        'effect',
        column,
        column,
        bypass ? bypassValue(bypass.messages(1), bypass.number(3) ? scene : 0) : null,
      );
    });
    for (const [field, kind] of [[7, 'splitter'], [8, 'mixer'], [12, 'combined splitter']] as const) {
      chain.messages(field).forEach((model, index) => {
        const point = splitPoints[index] ?? splitPoints[0];
        const column = kind === 'mixer' ? point?.mix : point?.split;
        add(
          model,
          kind,
          index,
          column !== undefined && column >= 0 ? column : null,
          bypassValue(chain.messages(kind === 'mixer' ? 11 : 10), scene),
        );
      });
    }
    chain.messages(9).forEach((model, index) => add(model, 'output', index, null, null));
    return {
      index: row,
      inputPort: chain.number(1),
      outputPort: chain.number(2),
      splitPoints,
      blocks,
    };
  });

  const tempo = sceneTempos[scene] || preset.number(10);
  return {
    name: preset.text(2) || 'Untitled preset',
    tempo: tempo > 0 ? tempo : null,
    sceneIndex: scene,
    sceneIsCurrent: validScene,
    sceneName,
    sceneLabels,
    rows,
    warnings: [...warnings],
  };
}
