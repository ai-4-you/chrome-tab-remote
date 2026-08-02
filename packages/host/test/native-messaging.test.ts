import { Buffer } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import {
  encodeMessage,
  MessageReader,
  MessageTooLargeError,
  MAX_MESSAGE_BYTES,
} from '../src/native-messaging.js';

describe('encodeMessage', () => {
  it('prefixes UTF-8 JSON with a 4-byte little-endian length', () => {
    const buf = encodeMessage({ a: 1 });
    const json = Buffer.from(JSON.stringify({ a: 1 }), 'utf8');
    expect(buf.readUInt32LE(0)).toBe(json.length);
    expect(buf.subarray(4).toString('utf8')).toBe('{"a":1}');
  });

  it('counts bytes, not characters, for non-ASCII payloads', () => {
    const buf = encodeMessage({ s: 'äöü€' });
    expect(buf.readUInt32LE(0)).toBe(buf.length - 4);
  });

  it('throws MessageTooLargeError beyond the 1 MB cap', () => {
    const big = { s: 'x'.repeat(MAX_MESSAGE_BYTES) };
    expect(() => encodeMessage(big)).toThrow(MessageTooLargeError);
  });
});

describe('MessageReader', () => {
  it('round-trips a single message', () => {
    const reader = new MessageReader();
    expect(reader.feed(encodeMessage({ kind: 'ping', n: 42 }))).toEqual([{ kind: 'ping', n: 42 }]);
  });

  it('decodes multiple messages arriving in one chunk', () => {
    const reader = new MessageReader();
    const chunk = Buffer.concat([encodeMessage({ i: 1 }), encodeMessage({ i: 2 }), encodeMessage({ i: 3 })]);
    expect(reader.feed(chunk)).toEqual([{ i: 1 }, { i: 2 }, { i: 3 }]);
  });

  it('reassembles a message split across many chunks (byte by byte)', () => {
    const reader = new MessageReader();
    const encoded = encodeMessage({ hello: 'wörld' });
    const results: unknown[] = [];
    for (let i = 0; i < encoded.length; i++) {
      results.push(...reader.feed(encoded.subarray(i, i + 1)));
    }
    expect(results).toEqual([{ hello: 'wörld' }]);
  });

  it('handles a chunk boundary inside the length prefix', () => {
    const reader = new MessageReader();
    const encoded = encodeMessage({ x: true });
    expect(reader.feed(encoded.subarray(0, 2))).toEqual([]);
    expect(reader.feed(encoded.subarray(2))).toEqual([{ x: true }]);
  });

  it('handles a complete message plus a partial next message in one chunk', () => {
    const reader = new MessageReader();
    const first = encodeMessage({ i: 1 });
    const second = encodeMessage({ i: 2 });
    const chunk = Buffer.concat([first, second.subarray(0, 5)]);
    expect(reader.feed(chunk)).toEqual([{ i: 1 }]);
    expect(reader.feed(second.subarray(5))).toEqual([{ i: 2 }]);
  });

  it('skips an oversized frame and stays in sync (messages before AND after survive)', () => {
    const onOversizedFrame = vi.fn();
    const reader = new MessageReader({ maxBytes: 16, onOversizedFrame });
    const bigPayload = Buffer.from(JSON.stringify({ big: 'x'.repeat(64) }), 'utf8');
    const bigHeader = Buffer.alloc(4);
    bigHeader.writeUInt32LE(bigPayload.length, 0);
    const chunk = Buffer.concat([
      encodeMessage({ i: 1 }),
      bigHeader,
      bigPayload,
      encodeMessage({ i: 2 }),
    ]);
    expect(reader.feed(chunk)).toEqual([{ i: 1 }, { i: 2 }]);
    expect(onOversizedFrame).toHaveBeenCalledWith(bigPayload.length);
  });

  it('skips an oversized payload arriving across many chunks, then resumes cleanly', () => {
    const onOversizedFrame = vi.fn();
    const reader = new MessageReader({ onOversizedFrame });
    const oversize = MAX_MESSAGE_BYTES + 10;
    const header = Buffer.alloc(4);
    header.writeUInt32LE(oversize, 0);
    expect(reader.feed(header)).toEqual([]);
    expect(onOversizedFrame).toHaveBeenCalledWith(oversize);
    // Drain the oversized payload in pieces; no output, no throw.
    expect(reader.feed(Buffer.alloc(MAX_MESSAGE_BYTES))).toEqual([]);
    // Final piece of the payload coalesced with a real frame: frame survives.
    expect(reader.feed(Buffer.concat([Buffer.alloc(10), encodeMessage({ ok: true })]))).toEqual([
      { ok: true },
    ]);
    expect(reader.feed(encodeMessage({ next: 1 }))).toEqual([{ next: 1 }]);
  });

  it('skips invalid-JSON frames via onInvalidJson and keeps decoding', () => {
    const onInvalidJson = vi.fn();
    const reader = new MessageReader({ onInvalidJson });
    const badPayload = Buffer.from('{not json', 'utf8');
    const badHeader = Buffer.alloc(4);
    badHeader.writeUInt32LE(badPayload.length, 0);
    const chunk = Buffer.concat([badHeader, badPayload, encodeMessage({ ok: 1 })]);
    expect(reader.feed(chunk)).toEqual([{ ok: 1 }]);
    expect(onInvalidJson).toHaveBeenCalledTimes(1);
  });

  it('rethrows invalid JSON when no handler is configured', () => {
    const reader = new MessageReader();
    const badPayload = Buffer.from('nope', 'utf8');
    const badHeader = Buffer.alloc(4);
    badHeader.writeUInt32LE(badPayload.length, 0);
    expect(() => reader.feed(Buffer.concat([badHeader, badPayload]))).toThrow(SyntaxError);
  });
});
