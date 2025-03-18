import { Modding } from "@flamework/core";
import { Networking } from "@flamework/networking";
import { createBinarySerializer, type Serializer, type SerializerMetadata } from "@rbxts/flamework-binary-serializer";
import { RunService } from "@rbxts/services";
import Destroyable from "@rbxts/destroyable";

import type { SerializedPacket, ClientEvents, ClientMessageCallback, ServerEvents, ServerMessageCallback, MessageCallback } from "./structs";

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

  /**.
   * @returns A destructor function that disconnects the callback from the message
   */
  public on<Kind extends keyof MessageData>(message: Kind, callback: MessageCallback<MessageData[Kind]>): () => void {
    const callbacksMap = RunService.IsServer() ? this.serverCallbacks : this.clientCallbacks;
    if (!callbacksMap.has(message))
      callbacksMap.set(message, new Set);

    const callbacks = callbacksMap.get(message)!;
    callbacks.add(callback as MessageCallback);
    callbacksMap.set(message, callbacks);
    return () => callbacks.delete(callback as MessageCallback);
  }

  /**
   * Emits a message to all connected clients.
   *
   * @param message - The message kind to be sent.
   * @param data - The data associated with the message.
   * @param unreliable - Optional flag indicating if the message should be sent unreliably.
   */
  public emitServer<Kind extends keyof MessageData>(message: Kind, data?: MessageData[Kind], unreliable = false): void {
    const send = unreliable
      ? this.clientEvents.sendUnreliableServerMessage
      : this.clientEvents.sendServerMessage;

    send(message, this.getPacket(message, data));
  }

  /**
   * Emits a message to a specific client.
   *
   * @param player - The player to whom the message is sent.
   * @param message - The message kind to be sent.
   * @param data - The data associated with the message.
   * @param unreliable - Optional flag indicating if the message should be sent unreliably.
   */
  public emitClient<Kind extends keyof MessageData>(player: Player, message: Kind, data?: MessageData[Kind], unreliable = false): void {
    const send = unreliable
      ? this.serverEvents.sendUnreliableClientMessage
      : this.serverEvents.sendClientMessage;

    send(player, message, this.getPacket(message, data));
  }

  /**
   * Emits a message to all connected clients.
   *
   * @param message - The message kind to be sent.
   * @param data - The data associated with the message.
   * @param unreliable - Optional flag indicating if the message should be sent unreliably.
   */
  public emitAllClients<Kind extends keyof MessageData>(message: Kind, data?: MessageData[Kind], unreliable = false): void {
    const send = unreliable ? this.serverEvents.sendUnreliableClientMessage : this.serverEvents.sendClientMessage;
    send.broadcast(message, this.getPacket(message, data));
  }

  private initialize(): this {
    if (RunService.IsClient())
      this.janitor.Add(this.clientEvents.sendClientMessage.connect((sentMessage, packet) => {
        const messageCallbacks = this.clientCallbacks.get(sentMessage as keyof MessageData) ?? new Set;
        if (messageCallbacks.size() === 0) return;

        const serializer = this.getSerializer(sentMessage as keyof MessageData);
        const data = packet !== undefined ? serializer.deserialize(packet.buffer, packet.blobs) : undefined;
        for (const callback of messageCallbacks)
          callback(data);
      }));
    else
      this.janitor.Add(this.serverEvents.sendServerMessage.connect((player, sentMessage, packet) => {
        const messageCallbacks = this.serverCallbacks.get(sentMessage as keyof MessageData) ?? new Set;
        if (messageCallbacks.size() === 0) return;

        const serializer = this.getSerializer(sentMessage as keyof MessageData);
        const data = packet !== undefined ? serializer.deserialize(packet.buffer, packet.blobs) : undefined;
        for (const callback of messageCallbacks)
          callback(player, data);
      }));

    return this;
  }

  private getPacket<Kind extends keyof MessageData>(message: Kind, data?: MessageData[Kind]): SerializedPacket | undefined {
    const serializer = this.getSerializer(message);
    return data === undefined ? undefined : serializer.serialize(data);
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