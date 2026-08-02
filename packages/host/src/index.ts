/**
 * chrome-tab-remote native messaging host + MCP server entrypoint.
 *
 * Chrome launches this process and owns stdio:
 * - stdin/stdout carry native messaging frames (4-byte LE length + UTF-8 JSON).
 * - stdout is RESERVED for native messaging; all logging goes to stderr.
 * - When stdin closes, Chrome disconnected: shut down and exit 0.
 */
import process from 'node:process';
import { AuditLog } from './audit-log.js';
import { Bridge } from './bridge.js';
import { resolveMcpPort, startMcpHttpServer, type McpHttpServerHandle } from './mcp-server.js';
import { encodeMessage, MessageReader } from './native-messaging.js';

const log = (line: string): void => {
  process.stderr.write(`[chrome-tab-remote-host] ${line}\n`);
};

async function main(): Promise<void> {
  const auditLog = new AuditLog();
  log(`audit log: ${auditLog.filePath}`);

  const bridge = new Bridge({
    send: (message) => {
      process.stdout.write(encodeMessage(message));
    },
    auditSink: (entry) => auditLog.append(entry),
    log,
  });

  const reader = new MessageReader({
    onInvalidJson: (error) => log(`dropping frame with invalid JSON: ${error.message}`),
    onOversizedFrame: (byteLength) => log(`dropping oversized inbound frame (${byteLength} bytes)`),
  });

  const state: { httpHandle?: McpHttpServerHandle; shuttingDown: boolean } = { shuttingDown: false };
  const shutdown = (reason: string): void => {
    if (state.shuttingDown) return;
    state.shuttingDown = true;
    log(`shutting down (${reason})`);
    bridge.dispose();
    const finish = (): void => process.exit(0);
    if (state.httpHandle) {
      state.httpHandle.close().then(finish, (error: unknown) => {
        log(`error closing MCP server: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(0);
      });
    } else {
      finish();
    }
  };

  process.stdin.on('data', (chunk: Buffer) => {
    try {
      for (const message of reader.feed(chunk)) {
        bridge.handleMessage(message);
      }
    } catch (error) {
      log(`native messaging stream error: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  process.stdin.on('end', () => shutdown('stdin ended — Chrome disconnected'));
  process.stdin.on('close', () => shutdown('stdin closed — Chrome disconnected'));
  process.stdin.on('error', (error) => shutdown(`stdin error: ${error.message}`));

  state.httpHandle = await startMcpHttpServer(bridge, {
    port: resolveMcpPort(process.env, log),
    log,
  });
}

main().catch((error: unknown) => {
  log(`fatal: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  process.exit(1);
});
