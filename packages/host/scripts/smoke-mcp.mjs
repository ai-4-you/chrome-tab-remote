#!/usr/bin/env node
// E2E smoke test for the running MCP endpoint: lists tools, calls list_grants,
// and if an active grant exists, tab_snapshot + tab_read on the first ref.
// Usage: node packages/host/scripts/smoke-mcp.mjs   (CTR_MCP_URL overrides)
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const url = new URL(process.env.CTR_MCP_URL ?? 'http://127.0.0.1:8917/mcp');
const client = new Client({ name: 'smoke-mcp', version: '0.0.1' });
await client.connect(new StreamableHTTPClientTransport(url));

const tools = await client.listTools();
console.log('TOOLS:', tools.tools.map((t) => t.name).join(', '));

// list_grants renders prose lines (one per grant, or a recovery instruction).
const grantsRes = await client.callTool({ name: 'list_grants', arguments: {} });
console.log('LIST_GRANTS:', grantsRes.isError ? 'ERROR' : 'ok', (grantsRes.content?.[0]?.text ?? '').slice(0, 400));

// grantId is deliberately omitted: the extension defaults to the single active
// grant, and without one the error text explains what to do.
const snap = await client.callTool({ name: 'tab_snapshot', arguments: {} });
const snapText = snap.content?.[0]?.text ?? '';
console.log('TAB_SNAPSHOT:', snap.isError ? `ERROR ${snapText.slice(0, 300)}` : 'ok');
if (!snap.isError) {
  // Compact text format: "url:"/"title:" header lines, then "- n<i> role ..." lines.
  const header = (name) => snapText.match(new RegExp(`^${name}: (.*)$`, 'm'))?.[1];
  console.log('  url:', header('url'), '| title:', header('title'), '| truncated:', header('truncated') ?? 'false');
  const firstRef = snapText.match(/^\s*- (n\d+) /m)?.[1];
  if (firstRef) {
    const read = await client.callTool({ name: 'tab_read', arguments: { ref: firstRef } });
    console.log('TAB_READ:', read.isError ? 'ERROR' : 'ok', (read.content?.[0]?.text ?? '').slice(0, 200));
  }
}
await client.close();
