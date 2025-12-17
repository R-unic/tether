import type { BaseMessage, PacketInfo, SerializedPacket } from "./structs";
import type { MessageEmitterOptions } from "./emitters/message-emitter";

const COEFF = 0xFA

export function bufferToString(buf?: buffer): string {
  const s: string[] = ["{ "];
  if (buf !== undefined)
    for (let i = 0; i < buffer.len(buf); i++) {
      const byte = buffer.readu8(buf, i);
      s.push(tostring(byte));
      s.push(i < buffer.len(buf) - 1 ? ", " : "");
    }

  s.push(" }");
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

export function createMessageBuffer(message: BaseMessage): buffer {
  const messageBuf = buffer.create(1);
  writeMessage(messageBuf, message);

  return messageBuf;
}

export function getAllPacketsWhich(infos: PacketInfo[], predicate: (info: PacketInfo) => boolean): SerializedPacket[] {
  return infos.filter(predicate).map(getPacket);
}

export function isUnreliable(info: PacketInfo): boolean {
  return info.unreliable;
}
export function isReliable(info: PacketInfo): boolean {
  return !info.unreliable;
}

export function getPacket(info: PacketInfo): SerializedPacket {
  return info.packet;
}

export function shouldBatch<MessageData>(message: keyof MessageData & BaseMessage, options: MessageEmitterOptions<MessageData>): boolean {
  return options.batchRemotes && !options.doNotBatch.has(message);
}