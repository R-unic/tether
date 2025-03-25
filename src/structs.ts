import type { Networking } from "@flamework/networking";

export type MessageCallback<T = unknown> = ServerMessageCallback<T> | ClientMessageCallback<T>;
export type ClientMessageCallback<T = unknown> = (data: T) => void;
export type ServerMessageCallback<T = unknown> = (player: Player, data: T) => void;
export type BaseMessage = number;

export interface SerializedPacket {
  readonly buffer: buffer;
  readonly blobs: defined[];
}

export type MessageEvent = (packet: SerializedPacket) => void;
export type UnreliableMessageEvent = Networking.Unreliable<MessageEvent>;

export interface ServerEvents {
  sendServerMessage: MessageEvent;
  sendUnreliableServerMessage: UnreliableMessageEvent;
}

export interface ClientEvents {
  sendClientMessage: MessageEvent;
  sendUnreliableClientMessage: UnreliableMessageEvent;
}