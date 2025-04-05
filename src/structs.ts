import type { Networking } from "@flamework/networking";
import type { DataType } from "@rbxts/flamework-binary-serializer";

export type MessageCallback<T = unknown> = ServerMessageCallback<T> | ClientMessageCallback<T>;
export type ClientMessageCallback<T = unknown> = (data: T) => void;
export type ServerMessageCallback<T = unknown> = (player: Player, data: T) => void;
export type BaseMessage = number;

export interface SerializedPacket {
  readonly buffer: buffer;
  readonly blobs: defined[];
}

export interface TetherPacket<Data> {
  readonly message: DataType.u8;
  readonly data: Data;
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