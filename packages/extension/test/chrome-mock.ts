// Hand-rolled minimal chrome.* mock for unit tests (no jest-chrome dependency).
// Only the API surface the extension actually uses is mocked.
import { vi } from 'vitest';

type AnyFn = (...args: never[]) => void;

export class MockEvent<T extends AnyFn> {
  private listeners: T[] = [];

  addListener = (fn: T): void => {
    this.listeners.push(fn);
  };

  removeListener = (fn: T): void => {
    this.listeners = this.listeners.filter((l) => l !== fn);
  };

  hasListener = (fn: T): boolean => this.listeners.includes(fn);

  /** Test helper: fire the event on all listeners. */
  emit = (...args: Parameters<T>): void => {
    for (const l of [...this.listeners]) l(...args);
  };
}

function createStorageArea() {
  let data: Record<string, unknown> = {};
  return {
    get: vi.fn(async (key: string) => (key in data ? { [key]: data[key] } : {})),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(data, items);
    }),
    remove: vi.fn(async (key: string) => {
      delete data[key];
    }),
    clear: vi.fn(async () => {
      data = {};
    }),
    /** Test helper: raw access to the backing store. */
    _data: (): Record<string, unknown> => data,
  };
}

export function createChromeMock() {
  const mockPort = {
    postMessage: vi.fn(),
    disconnect: vi.fn(),
    onMessage: new MockEvent<(msg: unknown) => void>(),
    onDisconnect: new MockEvent<() => void>(),
  };

  return {
    storage: {
      session: createStorageArea(),
      local: createStorageArea(),
    },
    tabs: {
      get: vi.fn(async (_tabId: number): Promise<{ id: number; url?: string; title?: string; active?: boolean; windowId?: number }> => {
        throw new Error('No tab with given id.');
      }),
      query: vi.fn(async (_queryInfo?: unknown) => [] as {
        id?: number;
        url?: string;
        title?: string;
        active?: boolean;
        windowId?: number;
      }[]),
      captureVisibleTab: vi.fn(async (_windowId: number, _options: unknown): Promise<string> => {
        throw new Error('capture not configured');
      }),
      sendMessage: vi.fn(async (_tabId: number, _msg: unknown): Promise<unknown> => {
        throw new Error('Could not establish connection.');
      }),
      onUpdated: new MockEvent<(tabId: number, changeInfo: { url?: string }) => void>(),
      onRemoved: new MockEvent<(tabId: number) => void>(),
      onActivated: new MockEvent<() => void>(),
    },
    runtime: {
      connectNative: vi.fn(() => mockPort),
      sendMessage: vi.fn(async (_msg: unknown): Promise<unknown> => undefined),
      onMessage: new MockEvent<
        (msg: unknown, sender: unknown, sendResponse: (response: unknown) => void) => boolean | void
      >(),
    },
    scripting: {
      executeScript: vi.fn(async (_injection: unknown) => []),
    },
    permissions: {
      request: vi.fn(async (_perms: { origins?: string[] }) => true),
      remove: vi.fn(async (_perms: { origins?: string[] }) => true),
      contains: vi.fn(async (_perms: { origins?: string[] }) => true),
    },
    alarms: {
      create: vi.fn(async (_name: string, _info: { periodInMinutes?: number }) => undefined),
      onAlarm: new MockEvent<(alarm: { name: string }) => void>(),
    },
    action: {
      onClicked: new MockEvent<(tab: { windowId?: number }) => void>(),
    },
    sidePanel: {
      open: vi.fn(async (_options: unknown) => undefined),
      setPanelBehavior: vi.fn(async (_behavior: unknown) => undefined),
    },
    /** Test helper: the port returned by connectNative. */
    _mockPort: mockPort,
  };
}

export type ChromeMock = ReturnType<typeof createChromeMock>;

/** Install a fresh mock as globalThis.chrome and return it (typed for helpers). */
export function installChromeMock(): ChromeMock {
  const mock = createChromeMock();
  (globalThis as { chrome?: unknown }).chrome = mock;
  return mock;
}
