import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Container,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { QcPresetReader, readError } from '../features/quad-cortex/reader';
import type { PresetSnapshot } from '../features/quad-cortex/reader';
import type { DisplayValue } from '../features/quad-cortex/catalog';
import type { PresetBlock } from '../features/quad-cortex/preset';
import { supportError } from '../features/quad-cortex/webhid';
import './App.css';

function Value({ value }: { value: DisplayValue }) {
  return (
    <span className="parameter-value">
      <span>{value.text}{value.unit ? ' ' + value.unit : ''}</span>
      {value.note && <small>{value.note}</small>}
    </span>
  );
}

function Block({ block, snapshot }: { block: PresetBlock; snapshot: PresetSnapshot }) {
  const bypass = block.bypassed === null ? 'Bypass not reported' : block.bypassed ? 'Bypassed' : 'Active';
  return (
    <details className="preset-block" open>
      <summary>
        <span className="block-heading">
          <strong>{block.name}</strong>
          <span>
            Row {block.row + 1} · {block.column !== null ? 'Column ' + (block.column + 1) : block.kind}
            {' · Model #' + block.modelId}
          </span>
        </span>
        <Badge
          color={block.bypassed === null ? 'gray' : block.bypassed ? 'orange' : 'teal'}
          variant="light"
        >
          {bypass}
        </Badge>
      </summary>
      <div className="block-body">
        {(block.basedOn || block.category) && (
          <Text size="sm" c="dimmed" mb="md">
            {[block.category, block.basedOn].filter(Boolean).join(' · ')}
          </Text>
        )}
        {block.parameters.length ? (
          <div className="parameter-scroll" role="region" aria-label={block.name + ' parameters'} tabIndex={0}>
            <table className="parameter-table">
              <thead>
                <tr>
                  <th scope="col">Parameter</th>
                  <th scope="col">
                    {snapshot.preset.sceneIsCurrent ? 'Current value' : 'Default scene value'}
                  </th>
                  <th scope="col">Scene / expression</th>
                </tr>
              </thead>
              <tbody>
                {block.parameters.map((parameter) => (
                  <tr key={parameter.index}>
                    <th scope="row">
                      {parameter.name}
                      <small>Parameter {parameter.index}</small>
                    </th>
                    <td><Value value={parameter.value} /></td>
                    <td>
                      {parameter.expression && <small>{parameter.expression}</small>}
                      {parameter.sceneMode ? (
                        <details className="scene-values">
                          <summary>Per-scene values</summary>
                          <dl>
                            {parameter.sceneValues.map((value, scene) => (
                              <div key={scene}>
                                <dt>
                                  {snapshot.mini
                                    ? ['AI', 'BI', 'CI', 'DI', 'AII', 'BII', 'CII', 'DII'][scene] ?? scene
                                    : 'ABCDEFGH'[scene] ?? scene}
                                  {snapshot.preset.sceneLabels[scene]
                                    ? ' · ' + snapshot.preset.sceneLabels[scene]
                                    : ''}
                                </dt>
                                <dd><Value value={value} /></dd>
                              </div>
                            ))}
                          </dl>
                        </details>
                      ) : <small>Shared across scenes</small>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Text size="sm" c="dimmed">No parameters were returned for this block.</Text>}
      </div>
    </details>
  );
}

function PresetResult({ snapshot }: { snapshot: PresetSnapshot }) {
  const { preset } = snapshot;
  const count = preset.rows.reduce(
    (total, row) => total + row.blocks.filter((block) => block.kind === 'effect').length, 0,
  );
  return (
    <Stack gap="xl">
      <Paper p="lg" radius="md" withBorder className="preset-overview">
        <Group justify="space-between" align="flex-start">
          <div>
            <Text size="xs" fw={700} c="teal" tt="uppercase">Current preset snapshot</Text>
            <Title order={2} mt={6}>{preset.name}</Title>
            <Text size="sm" c="dimmed" mt={6}>
              {snapshot.deviceName} · CorOS {snapshot.firmware}
            </Text>
          </div>
          <Text size="sm" c="dimmed">
            Read at {snapshot.readAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </Text>
        </Group>
        <Group gap="sm" mt="lg">
          <Badge variant="light" size="lg">
            {preset.sceneIsCurrent ? 'Scene ' : 'Default scene '}{preset.sceneName}
            {preset.sceneLabels[preset.sceneIndex] ? ' · ' + preset.sceneLabels[preset.sceneIndex] : ''}
          </Badge>
          {preset.tempo !== null && <Badge variant="light" size="lg" color="teal">{preset.tempo} BPM</Badge>}
          <Badge variant="light" size="lg" color="gray">{count} effect blocks</Badge>
          <Badge variant="light" size="lg" color="gray">{preset.rows.length} rows</Badge>
        </Group>
        <Text size="xs" c="dimmed" mt="md">
          Snapshot only. Read again after changing the preset or scene on the QC.
          The USB session closes after each read.
        </Text>
      </Paper>

      {preset.warnings.length > 0 && (
        <Alert color="yellow" title="Some values need context">
          <ul className="result-warnings">
            {preset.warnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        </Alert>
      )}

      <section aria-labelledby="signal-chain-title">
        <Title order={3} id="signal-chain-title" mb="md">Signal chain</Title>
        <div className="signal-grid-scroll" role="region" aria-label="Four-row signal grid" tabIndex={0}>
          <div className="signal-grid">
            <div className="signal-grid-header">
              <span />
              {Array.from({ length: 8 }, (_, column) => <span key={column}>{column + 1}</span>)}
            </div>
            {preset.rows.map((row) => (
              <div className="signal-grid-row" key={row.index}>
                <strong>Row {row.index + 1}</strong>
                {Array.from({ length: 8 }, (_, column) => {
                  const block = row.blocks.find((item) => item.kind === 'effect' && item.column === column);
                  return (
                    <div
                      key={column}
                      className={'signal-slot' + (block ? ' occupied' : '') + (block?.bypassed ? ' bypassed' : '')}
                    >
                      {block ? <a href={'#block-' + block.key}>{block.name}</a> : <span aria-label="Empty slot">—</span>}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <Text size="xs" c="dimmed" mt="xs">
          Columns 1–8. Select a block to jump to its parameters. Routing and split points appear below.
        </Text>
      </section>

      {preset.rows.map((row) => (
        <section key={row.index} aria-labelledby={'row-' + row.index}>
          <Group justify="space-between" mb="sm" gap="xs">
            <Title order={3} id={'row-' + row.index}>Row {row.index + 1}</Title>
            <Text size="sm" c="dimmed">
              {row.inputPort ? 'Input port ' + row.inputPort : 'No input'}
              {' → '}
              {row.outputPort ? 'Output port ' + row.outputPort : 'No output'}
            </Text>
          </Group>
          {row.splitPoints.filter((point) => point.split >= 0 || point.mix >= 0).map((point, index) => (
            <Text size="sm" c="dimmed" mb="sm" key={index}>
              Split: {point.split >= 0 ? 'column ' + (point.split + 1) : 'none'}
              {' · '}Mix: {point.mix >= 0 ? 'column ' + (point.mix + 1) : 'none'}
            </Text>
          ))}
          <Stack gap="sm">
            {row.blocks.map((block) => (
              <div id={'block-' + block.key} key={block.key} className="block-anchor">
                <Block block={block} snapshot={snapshot} />
              </div>
            ))}
            {!row.blocks.length && <Text size="sm" c="dimmed">This row has no blocks.</Text>}
          </Stack>
        </section>
      ))}
    </Stack>
  );
}

export default function App() {
  const [reader] = useState(() => new QcPresetReader());
  const [snapshot, setSnapshot] = useState<PresetSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(false);
  const unavailable = supportError();

  useEffect(() => {
    mounted.current = true;
    const cancel = () => reader.cancel();
    window.addEventListener('pagehide', cancel);
    return () => {
      mounted.current = false;
      window.removeEventListener('pagehide', cancel);
      reader.cancel();
    };
  }, [reader]);

  async function readCurrentPreset() {
    setLoading(true);
    setError(null);
    setSnapshot(null);
    try {
      const result = await reader.read((message) => {
        if (mounted.current) setProgress(message);
      });
      if (mounted.current) setSnapshot(result);
    } catch (failure) {
      if (mounted.current) setError(readError(failure));
    } finally {
      if (mounted.current) {
        setLoading(false);
        setProgress('');
      }
    }
  }

  return (
    <Container size="lg" py="xl" className="app-shell">
      <Stack gap="xl">
        <header>
          <Group justify="space-between" gap="sm" mb="md">
            <Text fw={800} size="sm" tt="uppercase" c="teal">Quad Cortex · USB reader</Text>
            <Badge variant="outline" color="gray">Read only</Badge>
          </Group>
          <Title order={1}>Your current preset, in detail.</Title>
          <Text c="dimmed" mt="sm" maw={660}>
            Read the preset loaded on your Quad Cortex, including its signal chain,
            bypass states, and block parameters.
          </Text>
        </header>

        <Paper withBorder radius="md" p="lg">
          <Stack gap="md">
            <div>
              <Text fw={600}>Connect your QC by USB and close Cortex Control.</Text>
              <Text size="sm" c="dimmed" mt={4}>
                Use desktop Chrome or Edge on HTTPS or localhost.
                Allow the device when your browser asks.
              </Text>
            </div>
            <Group>
              <Button
                size="md"
                color="teal"
                loading={loading}
                disabled={Boolean(unavailable) || loading}
                onClick={() => { void readCurrentPreset(); }}
              >
                Read current preset
              </Button>
              {loading && <Button variant="subtle" color="gray" onClick={() => reader.cancel()}>Cancel</Button>}
            </Group>
            <div role="status" aria-live="polite">
              {loading && (
                <Group gap="xs">
                  <Loader size="xs" color="teal" />
                  <Text size="sm">{progress || 'Preparing to read…'}</Text>
                </Group>
              )}
              {!loading && snapshot && <Text size="sm" c="teal">Preset read. USB session closed.</Text>}
            </div>
          </Stack>
        </Paper>

        {unavailable && <Alert color="yellow" title="Browser support">{unavailable}</Alert>}
        {error && <Alert role="alert" color="red" title="Couldn’t read the preset">{error}</Alert>}
        {snapshot && <PresetResult snapshot={snapshot} />}
        {!snapshot && !loading && !error && (
          <Paper p="xl" radius="md" className="empty-state">
            <Text fw={600}>Your signal chain will appear here.</Text>
            <Text size="sm" c="dimmed" mt="xs">
              One read shows all rows, blocks, and available parameters for the active scene.
            </Text>
          </Paper>
        )}
        <footer>
          <Text size="xs" c="dimmed">
            Protocol reference:{' '}
            <a href="https://github.com/lexasoft123/qc-mcp" target="_blank" rel="noreferrer">qc-mcp</a>.
            {' '}Unofficial; not affiliated with Neural DSP.
          </Text>
        </footer>
      </Stack>
    </Container>
  );
}
