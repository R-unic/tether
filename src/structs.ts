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
export type Guard<T = unknown> = (value: unknown) => value is T;

export interface MessageMetadata<T> {
  readonly guard: Modding.Generic<StripMeta<T>, "guard">;
  readonly serializerMetadata: T extends undefined ? undefined : SerializerMetadata<T>;
}

export type MessageEmitterMetadata<MessageData> = {
  readonly [K in keyof MessageData as K]: MessageMetadata<MessageData[K]>;
};