import type { Modding } from "@flamework/core";
import type { Serializer, SerializerMetadata } from "@rbxts/serio";
import createSerializer from "@rbxts/serio";

import { createMessageBuffer } from "./utility";
import type { BaseMessage, SerializedPacket } from "./structs";

export class Serdes<MessageData> {
  public serializers: Partial<Record<keyof MessageData, Serializer<MessageData[keyof MessageData]>>> = {};

  public serializePacket<Kind extends keyof MessageData>(message: Kind & BaseMessage, data?: MessageData[Kind]): SerializedPacket {
    const serializer = this.getSerializer(message);
    const messageBuf = createMessageBuffer(message);
    if (serializer === undefined)
      return {
        messageBuf,
        buf: buffer.create(0),
        blobs: []
      };

    return { messageBuf, ...serializer.serialize(data) };
  }

  public deserializePacket<K extends keyof MessageData>(message: K & BaseMessage, serializedPacket: SerializedPacket): MessageData[K] | undefined {
    const serializer = this.getSerializer(message);
    return serializer?.deserialize(serializedPacket);
  }

  /** @metadata macro */
  public addSerializer<K extends keyof MessageData>(message: K & BaseMessage, meta?: Modding.Many<SerializerMetadata<MessageData[K]>>): void {
    this.serializers[message] = this.createMessageSerializer(meta) as never;
  }

  /** @metadata macro */
  public createMessageSerializer<Kind extends keyof MessageData>(meta?: Modding.Many<SerializerMetadata<MessageData[Kind]>>): Serializer<MessageData[Kind]> {
    return createSerializer<MessageData[Kind]>(meta);
  }

  public getSerializer<Kind extends keyof MessageData>(message: Kind & BaseMessage): Serializer<MessageData[Kind] | undefined> | undefined {
    return this.serializers[message] as never;
  }
}