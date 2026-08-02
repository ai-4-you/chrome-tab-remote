// DNS-rebinding protection regression test for the MCP HTTP endpoint.
// IMPORTANT: uses a raw net socket — fetch/undici silently rewrites the Host
// header, which would make the foreign-Host case untestable.
import { createConnection } from 'node:net';
import { describe, expect, it } from 'vitest';
import { startMcpHttpServer, type ToolBridge } from '../src/mcp-server.js';

function stubBridge(): ToolBridge {
  return { callTool: async () => ({ grants: [] }) };
}

function rawPost(port: number, hostHeader: string): Promise<string> {
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  const request =
    'POST /mcp HTTP/1.1\r\n' +
    `Host: ${hostHeader}\r\n` +
    'Content-Type: application/json\r\n' +
    'Accept: application/json, text/event-stream\r\n' +
    `Content-Length: ${Buffer.byteLength(body)}\r\n` +
    'Connection: close\r\n' +
    '\r\n' +
    body;
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port }, () => {
      socket.write(request);
    });
    socket.setEncoding('utf8');
    let data = '';
    socket.on('data', (chunk: string) => {
      data += chunk;
    });
    socket.on('end', () => resolve(data));
    socket.on('error', reject);
  });
}

describe('startMcpHttpServer DNS-rebinding protection', () => {
  it('rejects a foreign Host header with 403 (rebound attacker.example cannot reach the tab)', async () => {
    const handle = await startMcpHttpServer(stubBridge(), { port: 0 });
    try {
      const response = await rawPost(handle.port, `attacker.example:${handle.port}`);
      expect(response).toMatch(/^HTTP\/1\.1 403/);
      expect(response).toContain('Invalid Host header');
    } finally {
      await handle.close();
    }
  });

  it('still serves legitimate loopback clients (Host: 127.0.0.1)', async () => {
    const handle = await startMcpHttpServer(stubBridge(), { port: 0 });
    try {
      const response = await rawPost(handle.port, `127.0.0.1:${handle.port}`);
      expect(response).toMatch(/^HTTP\/1\.1 200/);
      expect(response).toContain('tab_snapshot');
    } finally {
      await handle.close();
    }
  });
});
