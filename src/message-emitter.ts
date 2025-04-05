import { Modding } from "@flamework/core";
import { Networking } from "@flamework/networking";
import { createBinarySerializer, type Serializer, type SerializerMetadata } from "@rbxts/flamework-binary-serializer";
import { Players, RunService } from "@rbxts/services";
import Destroyable from "@rbxts/destroyable";

import { DropRequest, MiddlewareProvider } from "./middleware";
import type { TetherPacket, SerializedPacket, ClientEvents, ClientMessageCallback, ServerEvents, ServerMessageCallback, MessageCallback, BaseMessage } from "./structs";

const GlobalEvents = Networking.createEvent<ServerEvents, ClientEvents>();
export class MessageEmitter<MessageData> extends Destroyable {
  public readonly middleware = new MiddlewareProvider<MessageData>;

  private readonly clientCallbacks = new Map<keyof MessageData, Set<ClientMessageCallback>>;
  private readonly serverCallbacks = new Map<keyof MessageData, Set<ServerMessageCallback>>;
  private serializers: Partial<Record<keyof MessageData, Serializer<TetherPacket<MessageData[keyof MessageData]>>>> = {};
  private serverEvents!: ReturnType<typeof GlobalEvents.createServer>;
  private clientEvents!: ReturnType<typeof GlobalEvents.createClient>;

  /** @metadata macro */
  public static create<MessageData>(
    metaForEachMessage?: Modding.Many<{
      [Kind in keyof MessageData]: MessageData[Kind] extends undefined
      ? undefined
      : Modding.Many<SerializerMetadata<TetherPacket<MessageData[Kind]>>>
    }>
  ): MessageEmitter<MessageData> {
    const emitter = new MessageEmitter<MessageData>;
    if (metaForEachMessage === undefined) {
      warn("[@rbxts/tether]: Failed to generate serializer metadata for MessageEmitter");
      return emitter.initialize();
    }

    for (const [kind, meta] of pairs(metaForEachMessage)) {
      if (meta === undefined) continue;
      emitter.addSerializer(tonumber(kind) as keyof MessageData & BaseMessage, meta as Modding.Many<SerializerMetadata<TetherPacket<MessageData[keyof MessageData]>>>);
    }

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
  public onServerMessage<Kind extends keyof MessageData>(message: Kind & BaseMessage, callback: ServerMessageCallback<MessageData[Kind]>): () => void {
    return this.on(message, callback);
  }

  /**.
   * @returns A destructor function that disconnects the callback from the message
   */
  public onClientMessage<Kind extends keyof MessageData>(message: Kind & BaseMessage, callback: ClientMessageCallback<MessageData[Kind]>): () => void {
    return this.on(message, callback);
  }

  /**
   * Emits a message to all connected clients
   *
   * @param message The message kind to be sent
   * @param data The data associated with the message
   * @param unreliable Whether the message should be sent unreliably
   */
  public emitServer<Kind extends keyof MessageData>(message: Kind & BaseMessage, data?: MessageData[Kind], unreliable = false): void {
    const updateData = (newData?: MessageData[Kind]) => void (data = newData);
    const getPacket = () => this.getPacket(message, data);

    for (const globalMiddleware of this.middleware.getServerGlobal<MessageData[Kind]>()) {
      const result = globalMiddleware(message)(data!, updateData, getPacket);
      if (result === DropRequest) return;
    }
    for (const middleware of this.middleware.getServer(message)) {
      const result = middleware(message)(data!, updateData, getPacket);
      if (result === DropRequest) return;
    }

    const send = unreliable
      ? this.clientEvents.sendUnreliableServerMessage
      : this.clientEvents.sendServerMessage;

    send(getPacket());
  }

  /**
   * Emits a message to a specific client
   *
   * @param player The player to whom the message is sent
   * @param message The message kind to be sent
   * @param data The data associated with the message
   * @param unreliable Whether the message should be sent unreliably
   */
  public emitClient<Kind extends keyof MessageData>(player: Player | Player[], message: Kind & BaseMessage, data?: MessageData[Kind], unreliable = false): void {
    const updateData = (newData?: MessageData[Kind]) => void (data = newData);
    const getPacket = () => this.getPacket(message, data);

    for (const globalMiddleware of this.middleware.getClientGlobal<MessageData[Kind]>()) {
      const result = globalMiddleware(message)(player, data!, updateData, getPacket);
      if (result === DropRequest) return;
    }
    for (const middleware of this.middleware.getClient(message)) {
      const result = middleware(message)(player, data!, updateData, getPacket);
      if (result === DropRequest) return;
    }

    const send = unreliable
      ? this.serverEvents.sendUnreliableClientMessage
      : this.serverEvents.sendClientMessage;

    send(player, getPacket());
  }

  /**
   * Emits a message to all connected clients
   *
   * @param message The message kind to be sent
   * @param data The data associated with the message
   * @param unreliable Whether the message should be sent unreliably
   */
  public emitAllClients<Kind extends keyof MessageData>(message: Kind & BaseMessage, data?: MessageData[Kind], unreliable = false): void {
    const updateData = (newData?: MessageData[Kind]) => void (data = newData);
    const getPacket = () => this.getPacket(message, data);

    for (const globalMiddleware of this.middleware.getClientGlobal<MessageData[Kind]>())
      for (const player of Players.GetPlayers()) {
        const result = globalMiddleware(message)(player, data!, updateData, getPacket);
        if (result === DropRequest) return;
      }
    for (const middleware of this.middleware.getClient(message))
      for (const player of Players.GetPlayers()) {
        const result = middleware(message)(player, data!, updateData, getPacket);
        if (result === DropRequest) return;
      }

    const send = unreliable
      ? this.serverEvents.sendUnreliableClientMessage
      : this.serverEvents.sendClientMessage;

    send.broadcast(this.getPacket(message, data));
  }

  private initialize(): this {
    if (RunService.IsClient())
      this.janitor.Add(this.clientEvents.sendClientMessage.connect(serializedPacket => {
        const sentMessage = buffer.readu8(serializedPacket.buffer, 0);
        const messageCallbacks = this.clientCallbacks.get(sentMessage as keyof MessageData) ?? new Set;
        if (messageCallbacks.size() === 0) return;

        const serializer = this.getSerializer(sentMessage as keyof MessageData & BaseMessage);
        const packet = serializer?.deserialize(serializedPacket.buffer, serializedPacket.blobs);
        for (const callback of messageCallbacks)
          callback(packet?.data);
      }));
    else
      this.janitor.Add(this.serverEvents.sendServerMessage.connect((player, serializedPacket) => {
        const sentMessage = buffer.readu8(serializedPacket.buffer, 0);
        const messageCallbacks = this.serverCallbacks.get(sentMessage as keyof MessageData) ?? new Set;
        if (messageCallbacks.size() === 0) return;

        const serializer = this.getSerializer(sentMessage as keyof MessageData & BaseMessage);
        const packet = serializer?.deserialize(serializedPacket.buffer, serializedPacket.blobs);
        for (const callback of messageCallbacks)
          callback(player, packet?.data);
      }));

    return this;
  }

  private on<Kind extends keyof MessageData>(message: Kind, callback: MessageCallback<MessageData[Kind]>): () => void {
    const callbacksMap = RunService.IsServer() ? this.serverCallbacks : this.clientCallbacks;
    if (!callbacksMap.has(message))
      callbacksMap.set(message, new Set);

    const callbacks = callbacksMap.get(message)!;
    callbacks.add(callback as MessageCallback);
    callbacksMap.set(message, callbacks);
    return () => callbacks.delete(callback as MessageCallback);
  }

  private getPacket<Kind extends keyof MessageData>(message: Kind & BaseMessage, data?: MessageData[Kind]): SerializedPacket {
    const serializer = this.getSerializer(message);
    if (serializer !== undefined)
      return serializer.serialize({ message, data });

    const buf = buffer.create(1);
    buffer.writeu8(buf, 0, message);
    return {
      buffer: buf,
      blobs: []
    };
  }

  /** @metadata macro */
  private addSerializer<Kind extends keyof MessageData>(message: Kind & BaseMessage, meta?: Modding.Many<SerializerMetadata<TetherPacket<MessageData[Kind]>>>): void {
    this.serializers[message] = this.createMessageSerializer(meta) as unknown as Serializer<TetherPacket<MessageData[keyof MessageData]>>;
  }

  /** @metadata macro */
  private createMessageSerializer<Kind extends keyof MessageData>(meta?: Modding.Many<SerializerMetadata<TetherPacket<MessageData[Kind]>>>): Serializer<TetherPacket<MessageData[Kind]>> {
    return createBinarySerializer<TetherPacket<MessageData[Kind]>>(meta);
  }

  private getSerializer<Kind extends keyof MessageData>(message: Kind & BaseMessage): Serializer<TetherPacket<MessageData[Kind]>> | undefined {
    return this.serializers[message] as never;
  }
}