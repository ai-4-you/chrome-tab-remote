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

const grantsRes = await client.callTool({ name: 'list_grants', arguments: {} });
const grantsText = grantsRes.content?.[0]?.text ?? '';
console.log('LIST_GRANTS:', grantsRes.isError ? 'ERROR' : 'ok', grantsText.slice(0, 400));

const grants = (() => {
  try {
    return JSON.parse(grantsText).grants ?? [];
  } catch {
    return [];
  }
})();
const active = grants.find((g) => g.status === 'active');
if (!active) {
  console.log('NO ACTIVE GRANT — grant a tab in the side panel, then re-run.');
  await client.close();
  process.exit(0);
}

const snap = await client.callTool({ name: 'tab_snapshot', arguments: { grantId: active.grantId } });
const snapText = snap.content?.[0]?.text ?? '';
console.log('TAB_SNAPSHOT:', snap.isError ? `ERROR ${snapText.slice(0, 300)}` : 'ok');
if (!snap.isError) {
  const parsed = JSON.parse(snapText);
  console.log('  url:', parsed.url, '| title:', parsed.title, '| truncated:', parsed.truncated);
  const firstRef = (function find(n) {
    return n?.ref ?? (n?.children ?? []).map(find).find(Boolean);
  })(parsed.tree);
  if (firstRef) {
    const read = await client.callTool({
      name: 'tab_read',
      arguments: { grantId: active.grantId, ref: firstRef },
    });
    console.log('TAB_READ:', read.isError ? 'ERROR' : 'ok', (read.content?.[0]?.text ?? '').slice(0, 200));
  }
}
await client.close();
