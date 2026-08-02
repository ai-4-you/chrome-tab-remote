import { Buffer } from 'node:buffer';

/**
 * Chrome native messaging framing: each message is a 4-byte little-endian
 * unsigned length prefix followed by that many bytes of UTF-8 JSON.
 * Chrome caps host->browser messages at 1 MB (enforced by encodeMessage).
 * Inbound (browser->host) messages may legally be far larger; the reader
 * skips oversized frames without losing stream sync.
 */
export const MAX_MESSAGE_BYTES = 1024 * 1024;

export class MessageTooLargeError extends Error {
  constructor(readonly byteLength: number, readonly maxBytes: number) {
    super(`native message of ${byteLength} bytes exceeds limit of ${maxBytes} bytes`);
    this.name = 'MessageTooLargeError';
  }
}

/** Serialize one message with the native messaging length prefix. */
export function encodeMessage(obj: unknown, maxBytes: number = MAX_MESSAGE_BYTES): Buffer {
  const payload = Buffer.from(JSON.stringify(obj), 'utf8');
  if (payload.length > maxBytes) {
    throw new MessageTooLargeError(payload.length, maxBytes);
  }
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

export interface MessageReaderOptions {
  maxBytes?: number;
  /**
   * Called for a frame whose payload is not valid JSON; the frame is skipped
   * and reading continues. Default behavior (no handler): rethrow the error.
   */
  onInvalidJson?: (error: SyntaxError, rawPayload: string) => void;
  /**
   * Called when a frame declares a payload larger than maxBytes. Exactly that
   * many payload bytes are discarded and reading continues in sync — the
   * stream must never desynchronize, because Chrome allows browser->host
   * messages far beyond the 1 MB host->browser cap.
   */
  onOversizedFrame?: (byteLength: number) => void;
}

/**
 * Incremental decoder for the native messaging stream. Feed it stdin chunks in
 * order; it returns every complete message contained so far and buffers any
 * partial trailing frame. Pure and stream-agnostic.
 */
export class MessageReader {
  private buffer: Buffer = Buffer.alloc(0);
  /** Remaining payload bytes of an oversized frame still to be discarded. */
  private skipRemaining = 0;
  private readonly maxBytes: number;
  private readonly onInvalidJson?: MessageReaderOptions['onInvalidJson'];
  private readonly onOversizedFrame?: MessageReaderOptions['onOversizedFrame'];

  constructor(options: MessageReaderOptions = {}) {
    this.maxBytes = options.maxBytes ?? MAX_MESSAGE_BYTES;
    this.onInvalidJson = options.onInvalidJson;
    this.onOversizedFrame = options.onOversizedFrame;
  }

  /**
   * Consume one chunk and return all complete messages now available.
   * A frame declaring a payload beyond maxBytes is reported via
   * onOversizedFrame and its payload bytes are skipped exactly, keeping the
   * stream in sync; already-parsed messages of the same chunk are preserved.
   */
  feed(chunk: Buffer): unknown[] {
    this.buffer = this.buffer.length === 0 ? Buffer.from(chunk) : Buffer.concat([this.buffer, chunk]);
    const messages: unknown[] = [];
    for (;;) {
      if (this.skipRemaining > 0) {
        const drop = Math.min(this.skipRemaining, this.buffer.length);
        this.buffer = Buffer.from(this.buffer.subarray(drop));
        this.skipRemaining -= drop;
        if (this.skipRemaining > 0) return messages;
      }
      if (this.buffer.length < 4) return messages;
      const length = this.buffer.readUInt32LE(0);
      if (length > this.maxBytes) {
        this.buffer = Buffer.from(this.buffer.subarray(4));
        this.skipRemaining = length;
        this.onOversizedFrame?.(length);
        continue;
      }
      if (this.buffer.length < 4 + length) return messages;
      const rawPayload = this.buffer.subarray(4, 4 + length).toString('utf8');
      this.buffer = Buffer.from(this.buffer.subarray(4 + length));
      try {
        messages.push(JSON.parse(rawPayload));
      } catch (error) {
        if (this.onInvalidJson && error instanceof SyntaxError) {
          this.onInvalidJson(error, rawPayload);
        } else {
          throw error;
        }
      }
    }
  }
}
