import type { BaseMessage, SerializedPacket } from "./structs";

const COEFF = 0xFA

export function bufferToString(buf?: buffer): string {
  const s: string[] = ["{ "];
  if (buf !== undefined)
    for (let i = 0; i < buffer.len(buf); i++) {
      const byte = buffer.readu8(buf, i);
      s.push(tostring(byte));
      s.push(i < buffer.len(buf) - 1 ? ", " : "");
    }

  s.push("}");
  return s.join("");
}

export function encodeMessage(message: BaseMessage): number {
  message = (message ^ COEFF) & 0xFF;
  return (message << 3) | (message >> 5);
}

export function decodeMessage(encoded: number): BaseMessage {
  encoded = (encoded >> 3) | (encoded << 5);
  return (encoded ^ COEFF) & 0xFF;
}

export function writeMessage(buf: buffer, message: BaseMessage): void {
  assert(buffer.len(buf) === 1);
  buffer.writeu8(buf, 0, encodeMessage(message));
}

export function readMessage(packet: SerializedPacket | buffer): BaseMessage {
  const buf = typeIs(packet, "buffer") ? packet : packet.messageBuf;
  return decodeMessage(buffer.readu8(buf, 0));
}