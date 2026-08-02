// Reconnect watchdog: setTimeout retries die with the MV3 service worker, so
// a chrome.alarms alarm must be able to wake the SW and reopen the native port.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installChromeMock, type ChromeMock } from './chrome-mock.js';

describe('native-port reconnect watchdog', () => {
  let mock: ChromeMock;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules(); // fresh module-level port/handlers state per test
    mock = installChromeMock();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function load() {
    return import('../src/background/native-port.js');
  }

  it('creates the periodic reconnect alarm on connect', async () => {
    const { connectNativeHost, RECONNECT_ALARM } = await load();
    connectNativeHost({ onMessage: () => {} });
    expect(mock.alarms.create).toHaveBeenCalledWith(RECONNECT_ALARM, { periodInMinutes: 1 });
  });

  it('reopens the native port when the alarm fires after a disconnect', async () => {
    const { connectNativeHost, getNativeStatus, RECONNECT_ALARM } = await load();
    connectNativeHost({ onMessage: () => {} });
    expect(mock.runtime.connectNative).toHaveBeenCalledTimes(1);

    mock._mockPort.onDisconnect.emit();
    expect(getNativeStatus()).toBe('disconnected');

    // Simulate SW suspension: the pending setTimeout retry is gone, only the
    // alarm (which survives suspension) fires.
    mock.alarms.onAlarm.emit({ name: RECONNECT_ALARM });
    expect(mock.runtime.connectNative).toHaveBeenCalledTimes(2);
    expect(getNativeStatus()).toBe('connected');
  });

  it('is a no-op while the port is connected', async () => {
    const { connectNativeHost, RECONNECT_ALARM } = await load();
    connectNativeHost({ onMessage: () => {} });
    mock.alarms.onAlarm.emit({ name: RECONNECT_ALARM });
    mock.alarms.onAlarm.emit({ name: 'some-other-alarm' });
    expect(mock.runtime.connectNative).toHaveBeenCalledTimes(1);
  });
});
