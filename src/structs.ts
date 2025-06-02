import { Modding } from "@flamework/core";
import type { Networking } from "@flamework/networking";
import type { SerializerMetadata } from "@rbxts/flamework-binary-serializer";

export type MessageCallback<T = unknown> = ServerMessageCallback<T> | ClientMessageCallback<T>;
export type ClientMessageCallback<T = unknown> = (data: T) => void;
export type ClientMessageFunctionCallback<T = unknown, R = unknown> = (data: T) => R;
export type ServerMessageCallback<T = unknown> = (player: Player, data: T) => void;
export type ServerMessageFunctionCallback<T = unknown, R = unknown> = (player: Player, data: T) => R;
export type BaseMessage = number;

export interface PacketInfo {
  readonly packet: SerializedPacket;
  readonly unreliable: boolean;
}

export interface SerializedPacket {
  readonly messageBuffer: buffer;
  readonly buffer: buffer;
  readonly blobs: defined[];
}

export type MessageEvent = (packets: SerializedPacket[]) => void;
export type UnreliableMessageEvent = Networking.Unreliable<MessageEvent>;

export interface ServerEvents {
  readonly sendServerMessage: MessageEvent;
  readonly sendUnreliableServerMessage: UnreliableMessageEvent;
}

export interface ClientEvents {
  readonly sendClientMessage: MessageEvent;
  readonly sendUnreliableClientMessage: UnreliableMessageEvent;
}
export interface MessageMetadata<MessageData, Kind extends keyof MessageData> {
  readonly guard: Modding.Generic<MessageData[Kind], "guard">;
  readonly serializerMetadata: MessageData[Kind] extends undefined ? undefined : Modding.Many<SerializerMetadata<MessageData[Kind]>>;
}

export type Guard<T = unknown> = (value: unknown) => value is T;
export type MessageEmitterMetadata<MessageData> = {
  readonly [Kind in keyof MessageData]: MessageMetadata<MessageData, Kind>;
};
