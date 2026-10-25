# Third-party notices

The browser protocol implementation in `src/features/quad-cortex/` is adapted
from the protocol documentation, recovered protobuf field definitions, framing,
session sequence, and parameter conversion logic in
[lexasoft123/qc-mcp](https://github.com/lexasoft123/qc-mcp).

Reference files:

- [PROTOCOL.md](https://github.com/lexasoft123/qc-mcp/blob/main/PROTOCOL.md)
- [protocol.py](https://github.com/lexasoft123/qc-mcp/blob/main/src/qc_mcp/protocol.py)
- [transport.py](https://github.com/lexasoft123/qc-mcp/blob/main/src/qc_mcp/transport.py)
- [catalog.py](https://github.com/lexasoft123/qc-mcp/blob/main/src/qc_mcp/catalog.py)
- [Preset.proto](https://github.com/lexasoft123/qc-mcp/blob/main/proto/Preset.proto)
- [ProductionAutomation.proto](https://github.com/lexasoft123/qc-mcp/blob/main/proto/ProductionAutomation.proto)

The model catalog is read from the connected device at runtime and kept only in
memory. It is not bundled in this repository.

## qc-mcp license

MIT License

Copyright (c) 2026 qc-mcp contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

---

The MIT license above covers the source code in this repository.

This project is an UNOFFICIAL, community reverse-engineering effort. It is not
affiliated with, endorsed by, or supported by Neural DSP Technologies Oy.
"Quad Cortex", "Cortex Control", and "Neural DSP" are trademarks of their
respective owner. All amp/cab/effect model names and the emulated-gear
references in the device catalog (src/qc_mcp/ModelRepo.xml) are Neural DSP's
public device list: https://neuraldsp.com/device-list

It talks to your hardware over a reverse-engineered protocol. There is no
warranty; use at your own risk. See DISCLAIMER in README.md.

