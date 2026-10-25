# Quad Cortex preset reader

A browser-only, read-only view of the preset currently loaded on a Quad Cortex
or Quad Cortex mini. Uses the existing React/Mantine dependencies, WebHID, and
native browser gzip decompression; no backend or additional packages.

## Read a preset

1. Connect the QC by USB and close Cortex Control.
2. Open the app in desktop Chrome or Edge, served from HTTPS or localhost.
3. Click **Read current preset**, select the QC control interface in the browser
   device picker, and allow USB access.
4. Read the preset name, active scene, tempo, row routing, grid, and all returned
   block parameters. Blocks include lane input/output controls and splitters/mixers.

Rows and columns in the UI are numbered from 1. Parameter indices are the original
zero-based wire indices. Expand a parameter’s per-scene values to inspect the other
scenes without changing the scene on the device. Grid block links jump to the
corresponding parameter table. The result is a snapshot; click the button again
after changing a preset or scene on the hardware.

The reader establishes the session needed for reads, sends a serialized 200 ms
heartbeat while reading, then ends the session and closes the HID handle. Cancel,
disconnect, and page cleanup stop the session. The app sends no preset edits,
scene changes, saves, or other hardware-setting changes. Session negotiation and
keepalive messages are required even for reading. Every outgoing message
passes an explicit allowlist: READ envelopes and the specific session messages
above are permitted; preset edits, preset switching, scene switching, saves, and
hardware-setting writes are blocked before HID transmission.

The catalog is fetched from the device for each session. Display conversion honors
catalog ranges, declared skew, enumerated labels, and the calibrated mixer bounds
from qc-mcp. Values using the reference’s inferred taper are marked approximately;
unresolved ranges remain labeled raw values without invented units. Missing
parameters or bypass states are labeled as not returned/reported. If the active
scene cannot be read, the result explicitly identifies the default scene fallback.

USB permission failures, missing devices, disconnects, malformed data, and timeouts
appear in the UI. Close Cortex Control and reconnect the device before retrying a
connection error. The application keeps snapshots only in memory and has no AI,
editing, or persistence features.

## Windows HID write-completion quirk

The QC can receive a report even when Windows returns
`ERROR_GEN_FAILURE (31 / 0x1F)`. This is documented in
[qc-mcp’s Windows notes](https://github.com/lexasoft123/qc-mcp/blob/main/docs/WINDOWS.md#error_gen_failure31-is-noise-here-not-a-failed-write).
Chromium reports native write failures as
`NotAllowedError: Failed to write the report.`, so that exception alone does
not indicate a permission denial.

For a recognized QC control interface on Windows only, the reader allows that
exact generic completion error while waiting for protocol replies. It never
resends a report to guess whether it landed. Once a completion error occurs,
the preset response must still match the current request ID. Firmware, catalog,
and scene metadata follow qc-mcp’s command-based fallback for devices that omit
or do not echo request IDs. These fallback messages must arrive during the
current session and contain the requested data. A missing reply still fails
with a timeout, and an accepted snapshot displays a note about the completion errors.
Other errors and other platforms retain normal failure handling.

Startup mirrors qc-mcp: heartbeat, session reset, a short firmware probe,
client-version announcement, connection, then state subscriptions. Firmware
detection runs after that startup sequence and can retry up to three times.
The client-version fallback is not presented as detected firmware.

Timeout messages include the number of input reports, observed input report IDs,
decoded messages, received command/request IDs, and write-completion errors.
This distinguishes a silent USB input path from unmatched protocol responses.
No raw preset data, serial numbers, or session identifiers are logged.

This is a read-only workaround, not proof that every reported Windows write
error is benign. Chrome does not expose the native Windows code to page script.
If reading still fails, inspect `chrome://device-log` for the actual HID error.

## Protocol reference and implementation

Based on [qc-mcp](https://github.com/lexasoft123/qc-mcp), with its MIT attribution in
[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md). The reader uses the common
CorOS 4.0/4.1 read fields and reports a warning for newer firmware. Hardware and
browser compatibility have not been verified by executing this implementation.

- `src/features/quad-cortex/webhid.ts`: WebHID types, support and control-interface checks.
- `src/features/quad-cortex/protobuf.ts`: bounded protobuf wire decoding and request encoding.
- `src/features/quad-cortex/protocol.ts`: report framing, reassembly, trailers and gzip.
- `src/features/quad-cortex/reader.ts`: USB lifecycle, handshake, heartbeat and correlated reads.
- `src/features/quad-cortex/readonly-requests.ts`: outbound read/session allowlist; rejects mutation commands.
- `src/features/quad-cortex/catalog.ts`: device catalog archive/XML parsing and display values.
- `src/features/quad-cortex/preset.ts`: full-grid positions, scene values, bypass and lane controls.
- `src/app/App.tsx`: connection flow and preset result view.

## How to run in dev mode

Use Node.js 24 LTS and pnpm 12.14.0 (pinned in `package.json`).

- `pnpm install --frozen-lockfile`
- `pnpm dev` — open the local Vite URL, normally `http://localhost:5173`.

## How to validate

- `pnpm lint:fix:all` — package autofixes and formatting.
- `pnpm lint:all` — run all linters
- `pnpm build` — type-check and build to `dist/`.
- `pnpm test` — run tests

## How to run prod mode

- `pnpm preview` — serve the production build locally.
