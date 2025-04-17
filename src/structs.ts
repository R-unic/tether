import { Modding } from "@flamework/core";
import type { Networking } from "@flamework/networking";
import type { DataType, SerializerMetadata } from "@rbxts/flamework-binary-serializer";

export type MessageCallback<T = unknown> = ServerMessageCallback<T> | ClientMessageCallback<T>;
export type ClientMessageCallback<T = unknown> = (data: T) => void;
export type ClientMessageFunctionCallback<T = unknown, R = unknown> = (data: T) => R;
export type ServerMessageCallback<T = unknown> = (player: Player, data: T) => void;
export type ServerMessageFunctionCallback<T = unknown, R = unknown> = (player: Player, data: T) => R;
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
export interface MessageMetadata<MessageData, Kind extends keyof MessageData> {
  readonly guard: Modding.Generic<MessageData[Kind], "guard">;
  readonly serializerMetadata: MessageData[Kind] extends undefined ? undefined : Modding.Many<SerializerMetadata<TetherPacket<MessageData[Kind]>>>;
}
export type Guard<T = unknown> = (value: unknown) => value is T;
export type MessageEmitterMetadata<MessageData> = {
  [Kind in keyof MessageData]: MessageMetadata<MessageData, Kind>;
};
