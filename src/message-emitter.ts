import { Flamework, Modding } from "@flamework/core";
import { Networking } from "@flamework/networking";
import { createBinarySerializer, type Serializer, type SerializerMetadata } from "@rbxts/flamework-binary-serializer";
import { Players, RunService } from "@rbxts/services";
import Destroyable from "@rbxts/destroyable";

import { DropRequest, MiddlewareProvider } from "./middleware";
import type {
  TetherPacket,
  SerializedPacket,
  ClientEvents,
  ClientMessageCallback,
  ServerEvents,
  ServerMessageCallback,
  MessageCallback,
  BaseMessage,
  Guard,
  MessageEmitterMetadata,
  MessageMetadata
} from "./structs";

const remotes = Networking.createEvent<ServerEvents, ClientEvents>();
const metaGenerationFailed =
  "[@rbxts/tether]: Failed to generate message metadata - make sure you are using Flamework macro-friendly types in your schemas";
const guardFailed = (message: BaseMessage) =>
  `[@rbxts/tether]: Type validation guard failed for message '${message}' - check your sent data`;

export class MessageEmitter<MessageData> extends Destroyable {
  public readonly middleware = new MiddlewareProvider<MessageData>;

  private readonly clientCallbacks = new Map<keyof MessageData, Set<ClientMessageCallback>>;
  private readonly serverCallbacks = new Map<keyof MessageData, Set<ServerMessageCallback>>;
  private readonly guards = new Map<keyof MessageData, Guard>;
  private serializers: Partial<Record<keyof MessageData, Serializer<TetherPacket<MessageData[keyof MessageData]>>>> = {};
  private serverEvents!: ReturnType<typeof remotes.createServer>;
  private clientEvents!: ReturnType<typeof remotes.createClient>;

  /** @metadata macro */
  public static create<MessageData>(
    meta?: Modding.Many<MessageEmitterMetadata<MessageData>>
  ): MessageEmitter<MessageData> {
    const emitter = new MessageEmitter<MessageData>;
    if (meta === undefined) {
      warn(metaGenerationFailed);
      return emitter.initialize();
    }

    type FuckYouPairs = Record<BaseMessage, MessageMetadata<Record<BaseMessage, unknown>, BaseMessage>>;
    for (const [kind, { guard, serializerMetadata }] of pairs(meta as FuckYouPairs)) {
      const numberKind = tonumber(kind) as keyof MessageData & BaseMessage;
      emitter.guards.set(numberKind, guard);
      if (serializerMetadata === undefined) continue;
      emitter.addSerializer(numberKind, serializerMetadata as never);
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
      this.serverEvents = remotes.createServer({});
    else
      this.clientEvents = remotes.createClient({});
  }

  public readonly server = {
    /**.
     * @returns A destructor function that disconnects the callback from the message
     */
    on: <Kind extends keyof MessageData>(
      message: Kind & BaseMessage,
      callback: ServerMessageCallback<MessageData[Kind]>
    ) => this.on(message, callback),
    /**.
     * Disconnects the callback as soon as it is called for the first time
     *
     * @returns A destructor function that disconnects the callback from the message
     */
    once: <Kind extends keyof MessageData>(
      message: Kind & BaseMessage,
      callback: ServerMessageCallback<MessageData[Kind]>
    ) => this.once(message, callback),
    /**
     * Emits a message to the server
     *
     * @param message The message kind to be sent
     * @param data The data associated with the message
     * @param unreliable Whether the message should be sent unreliably
     */
    emit: <Kind extends keyof MessageData>(message: Kind & BaseMessage, data?: MessageData[Kind], unreliable = false): void => {
      const updateData = (newData?: MessageData[Kind]) => void (data = newData);
      const getPacket = () => this.getPacket(message, data);

      if (!this.validateData(message, data)) return;
      task.spawn(() => {
        for (const globalMiddleware of this.middleware.getServerGlobal<MessageData[Kind]>()) {
          if (!this.validateData(message, data)) return;
          const result = globalMiddleware(message)(data!, updateData, getPacket);
          if (result === DropRequest) return;
        }
        for (const middleware of this.middleware.getServer(message)) {
          if (!this.validateData(message, data)) return;
          const result = middleware(message)(data!, updateData, getPacket);
          if (result === DropRequest) return;
        }

        if (!this.validateData(message, data)) return;
        const send = unreliable
          ? this.clientEvents.sendUnreliableServerMessage
          : this.clientEvents.sendServerMessage;

        send(getPacket());
      });
    }
  };

  public readonly client = {
    /**.
     * @returns A destructor function that disconnects the callback from the message
     */
    on: <Kind extends keyof MessageData>(
      message: Kind & BaseMessage,
      callback: ClientMessageCallback<MessageData[Kind]>
    ) => this.on(message, callback),
    /**.
     * Disconnects the callback as soon as it is called for the first time
     *
     * @returns A destructor function that disconnects the callback from the message
     */
    once: <Kind extends keyof MessageData>(
      message: Kind & BaseMessage,
      callback: ClientMessageCallback<MessageData[Kind]>
    ) => this.once(message, callback),
    /**
     * Emits a message to a specific client
     *
     * @param player The player to whom the message is sent
     * @param message The message kind to be sent
     * @param data The data associated with the message
     * @param unreliable Whether the message should be sent unreliably
     */
    emit: <Kind extends keyof MessageData>(player: Player | Player[], message: Kind & BaseMessage, data?: MessageData[Kind], unreliable = false): void => {
      const updateData = (newData?: MessageData[Kind]) => void (data = newData);
      const getPacket = () => this.getPacket(message, data);

      if (!this.validateData(message, data)) return;
      task.spawn(() => {
        for (const globalMiddleware of this.middleware.getClientGlobal<MessageData[Kind]>()) {
          if (!this.validateData(message, data)) return;
          const result = globalMiddleware(message)(player, data!, updateData, getPacket);
          if (result === DropRequest) return;
        }
        for (const middleware of this.middleware.getClient(message)) {
          if (!this.validateData(message, data)) return;
          const result = middleware(message)(player, data!, updateData, getPacket);
          if (result === DropRequest) return;
        }

        if (!this.validateData(message, data)) return;
        const send = unreliable
          ? this.serverEvents.sendUnreliableClientMessage
          : this.serverEvents.sendClientMessage;

        send(player, getPacket());
      });
    },
    /**
     * Emits a message to all connected clients
     *
     * @param message The message kind to be sent
     * @param data The data associated with the message
     * @param unreliable Whether the message should be sent unreliably
     */
    emitAll: <Kind extends keyof MessageData>(message: Kind & BaseMessage, data?: MessageData[Kind], unreliable = false): void => {
      const updateData = (newData?: MessageData[Kind]) => void (data = newData);
      const getPacket = () => this.getPacket(message, data);

      if (!this.validateData(message, data)) return;
      task.spawn(() => {
        for (const globalMiddleware of this.middleware.getClientGlobal<MessageData[Kind]>())
          for (const player of Players.GetPlayers()) {
            if (!this.validateData(message, data)) return;
            const result = globalMiddleware(message)(player, data!, updateData, getPacket);
            if (result === DropRequest) return;
          }
        for (const middleware of this.middleware.getClient(message))
          for (const player of Players.GetPlayers()) {
            if (!this.validateData(message, data)) return;
            const result = middleware(message)(player, data!, updateData, getPacket);
            if (result === DropRequest) return;
          }

        if (!this.validateData(message, data)) return;
        const send = unreliable
          ? this.serverEvents.sendUnreliableClientMessage
          : this.serverEvents.sendClientMessage;

        send.broadcast(getPacket());
      });
    }
  };

  private validateData(message: keyof MessageData & BaseMessage, data: unknown): boolean {
    const guard = this.guards.get(message)!;
    const guardPassed = guard(data);
    if (!guardPassed)
      warn(guardFailed(message));

    return guardPassed
  }

  private initialize(): this {
    if (RunService.IsClient())
      this.janitor.Add(this.clientEvents.sendClientMessage.connect(serializedPacket => {
        const sentMessage = this.readMessageFromPacket(serializedPacket);
        this.executeCallbacks(sentMessage, serializedPacket);
      }));
    else
      this.janitor.Add(this.serverEvents.sendServerMessage.connect((player, serializedPacket) => {
        const sentMessage = this.readMessageFromPacket(serializedPacket);
        this.executeCallbacks(sentMessage, serializedPacket, player);
      }));

    return this;
  }

  private readMessageFromPacket(serializedPacket: SerializedPacket): keyof MessageData & BaseMessage {
    return buffer.readu8(serializedPacket.buffer, 0) as never;
  }

  private executeCallbacks(message: keyof MessageData & BaseMessage, serializedPacket: SerializedPacket, player?: Player): void {
    const callbacksMap = RunService.IsServer() ? this.serverCallbacks : this.clientCallbacks;
    const messageCallbacks: Set<MessageCallback> | undefined = callbacksMap.get(message);
    if (messageCallbacks === undefined) return;

    const serializer = this.getSerializer(message);
    const packet = serializer?.deserialize(serializedPacket.buffer, serializedPacket.blobs);
    for (const callback of messageCallbacks)
      if (Flamework.createGuard<ServerMessageCallback>()(callback))
        callback(player!, packet?.data);
      else
        (callback as ClientMessageCallback)(packet?.data); // why doesn't it infer this?!?!?!
  }

  private on<Kind extends keyof MessageData>(message: Kind, callback: MessageCallback<MessageData[Kind]>): () => void {
    const callbacksMap = RunService.IsServer() ? this.serverCallbacks : this.clientCallbacks;
    if (!callbacksMap.has(message))
      callbacksMap.set(message, new Set);

    const callbacks: Set<MessageCallback> = callbacksMap.get(message)!;
    callbacks.add(callback as MessageCallback);
    callbacksMap.set(message, callbacks);
    return () => callbacks.delete(callback as MessageCallback);
  }

  private once<Kind extends keyof MessageData>(message: Kind, callback: MessageCallback<MessageData[Kind]>): () => void {
    const callbacksMap = RunService.IsServer() ? this.serverCallbacks : this.clientCallbacks;
    if (!callbacksMap.has(message))
      callbacksMap.set(message, new Set);

    const callbacks: Set<MessageCallback> = callbacksMap.get(message)!;
    const destructor = () => callbacks.delete(callback as MessageCallback);
    callbacks.add((player, data) => {
      (callback as MessageCallback)(player, data);
      destructor();
    });
    callbacksMap.set(message, callbacks);
    return destructor;
  }

  private getPacket<Kind extends keyof MessageData>(message: Kind & BaseMessage, data?: MessageData[Kind]): SerializedPacket {
    const serializer = this.getSerializer(message);
    if (serializer !== undefined && data !== undefined)
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