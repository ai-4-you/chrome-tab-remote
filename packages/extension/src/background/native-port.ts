// Native messaging port to the local host process.
// Chrome 116+ keeps the service worker alive while a native port is open, so we
// connect once and reconnect with exponential backoff on disconnect.
import type { NativeMessage } from '@ctr/shared';

export const NATIVE_HOST_NAME = 'com.cgint.chrome_tab_remote';

const BACKOFF_INITIAL_MS = 1_000;
// Kept below the ~30 s MV3 service-worker idle timeout so an in-lifetime
// setTimeout retry never races SW termination.
const BACKOFF_MAX_MS = 20_000;

/**
 * Reconnect watchdog alarm. Once the native port is down, nothing keeps the
 * service worker alive and pending setTimeout timers die with it — chrome.alarms
 * survives SW suspension and wakes it, so a broken link (and the MCP host it
 * spawns) is repaired at most ~1 minute later without user interaction.
 */
export const RECONNECT_ALARM = 'ctr-native-reconnect';

export type NativeStatus = 'connected' | 'disconnected';

export interface NativePortHandlers {
  onMessage: (msg: unknown) => void;
  /** Called after each (re)connect — send grantsChanged here. */
  onConnect?: () => void;
  onStatusChange?: (status: NativeStatus) => void;
}

let port: chrome.runtime.Port | null = null;
let handlers: NativePortHandlers | null = null;
let backoffMs = BACKOFF_INITIAL_MS;

// Registered at module top level so the alarm can wake a suspended service
// worker; no-op while the port is open or before connectNativeHost ran (the
// SW top-level code calls connectNativeHost right after wake anyway).
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RECONNECT_ALARM && !port && handlers) open();
});

export function connectNativeHost(h: NativePortHandlers): void {
  handlers = h;
  void chrome.alarms.create(RECONNECT_ALARM, { periodInMinutes: 1 });
  open();
}

function open(): void {
  if (port) return; // Already connected (e.g. alarm raced a setTimeout retry).
  try {
    port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
  } catch {
    port = null;
    scheduleReconnect();
    return;
  }
  port.onMessage.addListener((msg: unknown) => {
    // A message from the host proves the link works — reset backoff.
    backoffMs = BACKOFF_INITIAL_MS;
    handlers?.onMessage(msg);
  });
  port.onDisconnect.addListener(() => {
    port = null;
    handlers?.onStatusChange?.('disconnected');
    scheduleReconnect();
  });
  handlers?.onStatusChange?.('connected');
  handlers?.onConnect?.();
}

function scheduleReconnect(): void {
  const delay = backoffMs;
  backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS);
  setTimeout(open, delay);
}

/** Send a message to the host; returns false when not connected (message dropped). */
export function sendToHost(msg: NativeMessage): boolean {
  if (!port) return false;
  try {
    port.postMessage(msg);
    return true;
  } catch {
    return false;
  }
}

export function getNativeStatus(): NativeStatus {
  return port ? 'connected' : 'disconnected';
}
