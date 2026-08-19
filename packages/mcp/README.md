# @open-recording/mcp

MCP server for [open-recording](https://github.com/simonliu-ai-product/open-recording) — lets any agent framework press record, stop, transcribe, and read the transcript back.

Mounted on the dev server by `open-recording dev --mcp`. It has to run in that process: the recorder state machine lives there, and the tools reach the browser studio through its open event stream.

```bash
pnpm add -D @open-recording/mcp
```

See the [repo README](https://github.com/simonliu-ai-product/open-recording#readme) for the tool list.
