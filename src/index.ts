import { Modding } from "@flamework/core";
import { Networking } from "@flamework/networking";
import { createBinarySerializer, type Serializer, type SerializerMetadata } from "@rbxts/flamework-binary-serializer";
import { RunService } from "@rbxts/services";
import Destroyable from "@rbxts/destroyable";

import type { SerializedPacket, ClientEvents, ClientMessageCallback, ServerEvents, ServerMessageCallback } from "./structs";

const GlobalEvents = Networking.createEvent<ServerEvents, ClientEvents>();
export class MessageEmitter<MessageData> extends Destroyable {
  private readonly clientCallbacks = new Map<keyof MessageData, Set<ClientMessageCallback>>;
  private readonly serverCallbacks = new Map<keyof MessageData, Set<ServerMessageCallback>>;
  private serializers: Partial<Record<keyof MessageData, Serializer<MessageData[keyof MessageData]>>> = {};
  private serverEvents!: ReturnType<typeof GlobalEvents.createServer>;
  private clientEvents!: ReturnType<typeof GlobalEvents.createClient>;

  /** @metadata macro */
  public static create<MessageData>(
    metaForEachMessage?: Modding.Many<{
      [Kind in keyof MessageData]: Modding.Many<SerializerMetadata<MessageData[Kind]>>
    }>
  ): MessageEmitter<MessageData> {
    const emitter = new MessageEmitter<MessageData>;
    if (metaForEachMessage === undefined) {
      warn("[Tether]: Failed to generate serializer metadata for MessageEmitter");
      return emitter.initialize();
    }

    for (const [kind, meta] of pairs(metaForEachMessage))
      emitter.addSerializer(kind as keyof MessageData, meta as Modding.Many<SerializerMetadata<MessageData[keyof MessageData]>>);

    return emitter.initialize();
  }

  private constructor() {
    super();
    this.janitor.Add(() => {
      this.clientCallbacks.clear();
      this.serverCallbacks.clear();
      this.serializers = undefined!;
      this.serverEvents = undefined!;
      this.clientEvents = undefined!;
    });
    if (RunService.IsServer())
      this.serverEvents = GlobalEvents.createServer({});
    else
      this.clientEvents = GlobalEvents.createClient({});
  }

  public onServerMessage<Kind extends keyof MessageData>(message: Kind, callback: ServerMessageCallback<MessageData[Kind]>): () => void {
    if (!this.serverCallbacks.has(message))
      this.serverCallbacks.set(message, new Set);

    const callbacks = this.serverCallbacks.get(message)!;
    callbacks.add(callback as ClientMessageCallback);
    this.serverCallbacks.set(message, callbacks);
    return () => callbacks.delete(callback as ClientMessageCallback);
  }

  public onClientMessage<Kind extends keyof MessageData>(message: Kind, callback: ClientMessageCallback<MessageData[Kind]>): () => void {
    if (!this.clientCallbacks.has(message))
      this.clientCallbacks.set(message, new Set);

    const callbacks = this.clientCallbacks.get(message)!;
    callbacks.add(callback as ClientMessageCallback);
    this.clientCallbacks.set(message, callbacks);
    return () => callbacks.delete(callback as ClientMessageCallback);
  }

  public emitServer<Kind extends keyof MessageData>(message: Kind, data: MessageData[Kind], unreliable = false): void {
    const send = unreliable
      ? this.clientEvents.sendUnreliableServerMessage
      : this.clientEvents.sendServerMessage;

    send(message, this.getPacket(message, data));
  }

  public emitClient<Kind extends keyof MessageData>(player: Player, message: Kind, data: MessageData[Kind], unreliable = false): void {
    const send = unreliable
      ? this.serverEvents.sendUnreliableClientMessage
      : this.serverEvents.sendClientMessage;

    send(player, message, this.getPacket(message, data));
  }

  public emitAllClients<Kind extends keyof MessageData>(message: Kind, data: MessageData[Kind], unreliable = false): void {
    const send = unreliable ? this.serverEvents.sendUnreliableClientMessage : this.serverEvents.sendClientMessage;
    send.broadcast(message, this.getPacket(message, data));
  }

  private initialize(): this {
    if (RunService.IsClient())
      this.janitor.Add(this.clientEvents.sendClientMessage.connect((sentMessage, { buffer, blobs }) => {
        const messageCallbacks = this.clientCallbacks.get(sentMessage as keyof MessageData) ?? new Set;
        if (messageCallbacks.size() === 0) return;

        const serializer = this.getSerializer(sentMessage as keyof MessageData);
        const data = serializer.deserialize(buffer, blobs);
        for (const callback of messageCallbacks)
          callback(data);
      }));
    else
      this.janitor.Add(this.serverEvents.sendServerMessage.connect((player, sentMessage, { buffer, blobs }) => {
        const messageCallbacks = this.serverCallbacks.get(sentMessage as keyof MessageData) ?? new Set;
        if (messageCallbacks.size() === 0) return;

        const serializer = this.getSerializer(sentMessage as keyof MessageData);
        const data = serializer.deserialize(buffer, blobs);
        for (const callback of messageCallbacks)
          callback(player, data);
      }));

    return this;
  }

  private getPacket<Kind extends keyof MessageData>(message: Kind, data: MessageData[Kind], unreliable = false): SerializedPacket {
    const serializer = this.getSerializer(message);
    return serializer.serialize(data);
  }

  /** @metadata macro */
  private addSerializer<Kind extends keyof MessageData>(message: Kind, meta?: Modding.Many<SerializerMetadata<MessageData[Kind]>>): void {
    this.serializers[message] = this.createMessageSerializer(meta) as unknown as Serializer<MessageData[keyof MessageData]>;
  }

  /** @metadata macro */
  private createMessageSerializer<Kind extends keyof MessageData>(meta?: Modding.Many<SerializerMetadata<MessageData[Kind]>>): Serializer<MessageData[Kind]> {
    return createBinarySerializer(meta);
  }

  private getSerializer<Kind extends keyof MessageData>(message: Kind): Serializer<MessageData[Kind]> {
    return this.serializers[tostring(message) as Kind] as unknown as Serializer<MessageData[Kind]>;
  }
}