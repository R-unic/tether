import type { Modding } from "@flamework/core";
import type {
  SerializerMetadata, SerializedData,
  Transform, Vector, String,
  u8, u16, u24, u32, i8, i16, i24, i32, f16, f24, f32, f64
} from "@rbxts/serio";

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

export interface SerializedPacket extends SerializedData {
  readonly messageBuf: buffer;
}

export type MessageEvent = (...packets: SerializedPacket[]) => void;

type Prev = [never, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24];
type ReplaceByMapWithDepth<T, Depth extends number = 24> =
  [Depth] extends [never]
  ? T // stop recursion
  : T extends Callback
  ? T
  : T extends Vector
  ? Vector3
  : T extends Transform
  ? CFrame
  : T extends String
  ? string
  : T extends buffer
  ? buffer
  : T extends { _packed: [infer V] }
  ? ReplaceByMapWithDepth<V, Prev[Depth]>
  : T extends { _list: [infer V] }
  ? ReplaceByMapWithDepth<V, Depth>
  : T extends { _tuple: [infer A] }
  ? ReplaceByMapWithDepth<A, Prev[Depth]>
  : T extends { _set: [infer V] }
  ? Set<ReplaceByMapWithDepth<V, Prev[Depth]>>
  : T extends { _set: infer T extends unknown[] }
  ? Map<ReplaceByMapWithDepth<T[number], Prev[Depth]>, ReplaceByMapWithDepth<T[number], Prev[Depth]>>
  : T extends { _map: [infer K, infer V] }
  ? Map<ReplaceByMapWithDepth<K, Prev[Depth]>, ReplaceByMapWithDepth<V, Prev[Depth]>>
  : T extends { _map: [infer V] }
  ? Map<ReplaceByMapWithDepth<V, Prev[Depth]>, ReplaceByMapWithDepth<V, Prev[Depth]>>
  : T extends u8 | u16 | u24 | u32 | i8 | i16 | i24 | i32 | f16 | f24 | f32 | f64
  ? number
  : T extends Color3
  ? { R: number, G: number, B: number }
  : T extends any[]
  ? ReplaceByMapWithDepth<T[number], Prev[Depth]>[]
  : T extends ReadonlyMap<unknown, unknown>
  ? T
  : T extends object
  ? { [K in keyof T]: ReplaceByMapWithDepth<T[K], Prev[Depth]>; }
  : T;

export interface MessageMetadata<MessageData, Kind extends keyof MessageData> {
  readonly guard: Modding.Generic<
    ReplaceByMapWithDepth<MessageData[Kind]>,
    "guard"
  >;
  readonly serializerMetadata: MessageData[Kind] extends undefined
  ? undefined
  : Modding.Many<SerializerMetadata<MessageData[Kind]>>;
}

export type Guard<T = unknown> = (value: unknown) => value is T;
export type MessageEmitterMetadata<MessageData> = {
  readonly [Kind in keyof MessageData]: MessageMetadata<MessageData, Kind>;
};
