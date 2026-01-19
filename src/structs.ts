import type { Modding } from "@flamework/core";
import type { SerializerMetadata, SerializedData, StripMeta } from "@rbxts/serio";

export type MessageCallback<T = unknown> = ServerMessageCallback<T> | ClientMessageCallback<T>;
export type FunctionMessageCallback<T = unknown, R = unknown> = ServerFunctionMessageCallback<T, R> | ClientFunctionMessageCallback<T, R>;
export type ClientMessageCallback<T = unknown> = (data: T) => void;
export type ClientFunctionMessageCallback<T = unknown, R = unknown> = (data: T) => R;
export type ServerMessageCallback<T = unknown> = (player: Player, data: T) => void;
export type ServerFunctionMessageCallback<T = unknown, R = unknown> = (player: Player, data: T) => R;
export type BaseMessage = number;

export interface PacketInfo {
  readonly packet: SerializedPacket;
  readonly unreliable: boolean;
}

export interface SerializedPacket extends SerializedData {
  readonly messageBuf: buffer;
}

export type MessageEvent = (...packets: SerializedPacket[]) => void;

export interface MessageMetadata<MessageData, Kind extends keyof MessageData> {
  readonly guard: Modding.Generic<StripMeta<MessageData[Kind]>, "guard">;
  readonly serializerMetadata: MessageData[Kind] extends undefined
  ? undefined
  : Modding.Many<SerializerMetadata<MessageData[Kind]>>;
}

export type Guard<T = unknown> = (value: unknown) => value is T;
export type MessageEmitterMetadata<MessageData> = {
  readonly [Kind in keyof MessageData]: MessageMetadata<MessageData, Kind>;
};
