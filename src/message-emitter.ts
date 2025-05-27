import { Modding } from "@flamework/core";
import { Networking } from "@flamework/networking";
import { createBinarySerializer, type Serializer, type SerializerMetadata } from "@rbxts/flamework-binary-serializer";
import { Players, RunService } from "@rbxts/services";
import Destroyable from "@rbxts/destroyable";
import repr from "@rbxts/repr";

import { DropRequest, MiddlewareProvider, type MiddlewareContext } from "./middleware";
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
  MessageMetadata,
  ClientMessageFunctionCallback,
  ServerMessageFunctionCallback
} from "./structs";

// TODO: error when trying to do something like server.emit() from the server

const messageSerializer = createBinarySerializer<TetherPacket<undefined>>();
const remotes = Networking.createEvent<ServerEvents, ClientEvents>();
const metaGenerationFailed =
  "[@rbxts/tether]: Failed to generate message metadata - make sure you have the Flamework transformer and are using Flamework macro-friendly types in your schemas";
const guardFailed = (message: BaseMessage, data: unknown) =>
  `[@rbxts/tether]: Type validation guard failed for message '${message}' - check your sent data\nSent data: ${repr(data)}`;

export class MessageEmitter<MessageData> extends Destroyable {
  public readonly middleware = new MiddlewareProvider<MessageData>;

  private readonly clientCallbacks = new Map<keyof MessageData, Set<ClientMessageCallback>>;
  private readonly clientFunctions = new Map<keyof MessageData, Set<(data: unknown) => void>>;
  private readonly serverCallbacks = new Map<keyof MessageData, Set<ServerMessageCallback>>;
  private readonly serverFunctions = new Map<keyof MessageData, Set<(data: unknown) => void>>;
  private readonly guards = new Map<keyof MessageData, Guard>;
  private readonly serializers: Partial<Record<keyof MessageData, Serializer<TetherPacket<MessageData[keyof MessageData]>>>> = {};
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

    type SorryLittensy = Record<BaseMessage, MessageMetadata<Record<BaseMessage, unknown>, BaseMessage>>;
    for (const [kind, { guard, serializerMetadata }] of pairs(meta as SorryLittensy)) {
      const numberKind = tonumber(kind) as keyof MessageData & BaseMessage;
      emitter.guards.set(numberKind, guard);

      if (serializerMetadata === undefined) { // this is true for undefined data!!
        emitter.serializers[numberKind] = messageSerializer as never;
        continue;
      }

      emitter.addSerializer(numberKind, serializerMetadata as never);
    }

    return emitter.initialize();
  }

  private constructor() {
    super();
    this.janitor.Add(() => {
      this.clientCallbacks.clear();
      this.serverCallbacks.clear();
      table.clear(this.serializers);
      this.serverEvents = undefined!;
      this.clientEvents = undefined!;
    });

    if (RunService.IsServer())
      this.serverEvents = remotes.createServer({});
    else
      this.clientEvents = remotes.createClient({});
  }

  public readonly server = {
    /**
     * @returns A destructor function that disconnects the callback from the message
     */
    on: <Kind extends keyof MessageData>(
      message: Kind & BaseMessage,
      callback: ServerMessageCallback<MessageData[Kind]>
    ) => this.on(message, callback, this.serverCallbacks),
    /**
     * Disconnects the callback as soon as it is called for the first time
     *
     * @returns A destructor function that disconnects the callback from the message
     */
    once: <Kind extends keyof MessageData>(
      message: Kind & BaseMessage,
      callback: ServerMessageCallback<MessageData[Kind]>
    ) => this.once(message, callback, this.serverCallbacks),
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
        const ctx: MiddlewareContext<MessageData[Kind]> = { data: data!, updateData, getRawData: getPacket };
        for (const globalMiddleware of this.middleware.getServerGlobal<MessageData[Kind]>()) {
          if (!this.validateData(message, data)) return;
          const result = globalMiddleware(message)(ctx);
          if (result === DropRequest) return;
        }
        for (const middleware of this.middleware.getServer(message)) {
          if (!this.validateData(message, data)) return;
          const result = middleware(message)(ctx);
          if (result === DropRequest) return;
        }

        if (!this.validateData(message, data)) return;
        const send = unreliable
          ? this.clientEvents.sendUnreliableServerMessage
          : this.clientEvents.sendServerMessage;

        send(getPacket());
      });
    },

    /**
     * Simulates a remote function invocation.
     *
     * @param message The message kind to be sent
     * @param data The data associated with the message
     * @param unreliable Whether the message should be sent unreliably
     */
    invoke: async <Kind extends keyof MessageData, ReturnKind extends keyof MessageData>(
      message: Kind & BaseMessage,
      returnMessage: ReturnKind & BaseMessage,
      data?: MessageData[Kind],
      unreliable = false
    ): Promise<MessageData[ReturnKind]> => {
      if (!this.clientFunctions.has(returnMessage))
        this.clientFunctions.set(returnMessage, new Set);

      const functions = this.clientFunctions.get(returnMessage)!;
      let returnValue: MessageData[ReturnKind] | undefined;
      functions.add(data => returnValue = data as never);
      this.server.emit(message, data, unreliable);

      while (returnValue === undefined)
        RunService.Heartbeat.Wait();

      return returnValue;
    },
    /**
     * Sets a callback for a simulated remote function
     *
     * @returns A destructor function that disconnects the callback from the message
     */
    setCallback: <Kind extends keyof MessageData, ReturnKind extends keyof MessageData>(
      message: Kind & BaseMessage,
      returnMessage: ReturnKind & BaseMessage,
      callback: ServerMessageFunctionCallback<MessageData[Kind], MessageData[ReturnKind]>
    ) => this.server.on(message, (player, data) => {
      const returnValue = callback(player, data);
      this.client.emit(player, returnMessage, returnValue);
    })
  };

  public readonly client = {
    /**
     * @returns A destructor function that disconnects the callback from the message
     */
    on: <Kind extends keyof MessageData>(
      message: Kind & BaseMessage,
      callback: ClientMessageCallback<MessageData[Kind]>
    ) => this.on(message, callback, this.clientCallbacks),
    /**
     * Disconnects the callback as soon as it is called for the first time
     *
     * @returns A destructor function that disconnects the callback from the message
     */
    once: <Kind extends keyof MessageData>(
      message: Kind & BaseMessage,
      callback: ClientMessageCallback<MessageData[Kind]>
    ) => this.once(message, callback, this.clientCallbacks),
    /**
     * Emits a message to a specific client or multiple clients
     *
     * @param player The player(s) to whom the message is sent
     * @param message The message kind to be sent
     * @param data The data associated with the message
     * @param unreliable Whether the message should be sent unreliably
     */
    emit: <Kind extends keyof MessageData>(player: Player | Player[], message: Kind & BaseMessage, data?: MessageData[Kind], unreliable = false): void => {
      const updateData = (newData?: MessageData[Kind]) => void (data = newData);
      const getPacket = () => this.getPacket(message, data);

      if (!this.validateData(message, data)) return;
      task.spawn(() => {
        const ctx: MiddlewareContext<MessageData[Kind]> = { data: data!, updateData, getRawData: getPacket };
        for (const globalMiddleware of this.middleware.getClientGlobal<MessageData[Kind]>()) {
          if (!this.validateData(message, data)) return;
          const result = globalMiddleware(message)(player, ctx);
          if (result === DropRequest) return;
        }
        for (const middleware of this.middleware.getClient(message)) {
          if (!this.validateData(message, data)) return;
          const result = middleware(message)(player, ctx);
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
     * Emits a message to all clients except the specified client(s)
     *
     * @param player The player(s) to whom the message is not sent
     * @param message The message kind to be sent
     * @param data The data associated with the message
     * @param unreliable Whether the message should be sent unreliably
     */
    emitExcept: <Kind extends keyof MessageData>(player: Player | Player[], message: Kind & BaseMessage, data?: MessageData[Kind], unreliable = false): void => {
      const shouldSendTo = (p: Player) => typeIs(player, "Instance") ? p !== player : !player.includes(p);
      this.client.emit(Players.GetPlayers().filter(shouldSendTo), message, data, unreliable);
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
        const ctx: MiddlewareContext<MessageData[Kind]> = { data: data!, updateData, getRawData: getPacket };
        const players = Players.GetPlayers();

        for (const globalMiddleware of this.middleware.getClientGlobal<MessageData[Kind]>())
          for (const player of players) {
            if (!this.validateData(message, data)) return;
            const result = globalMiddleware(message)(player, ctx);
            if (result === DropRequest) return;
          }
        for (const middleware of this.middleware.getClient(message))
          for (const player of players) {
            if (!this.validateData(message, data)) return;
            const result = middleware(message)(player, ctx);
            if (result === DropRequest) return;
          }

        if (!this.validateData(message, data)) return;
        const send = unreliable
          ? this.serverEvents.sendUnreliableClientMessage
          : this.serverEvents.sendClientMessage;

        send.broadcast(getPacket());
      });
    },

    /**
     * Simulates a remote function invocation.
     *
     * @param message The message kind to be sent
     * @param data The data associated with the message
     * @param unreliable Whether the message should be sent unreliably
     */
    invoke: async <Kind extends keyof MessageData, ReturnKind extends keyof MessageData>(
      message: Kind & BaseMessage,
      returnMessage: ReturnKind & BaseMessage,
      player: Player,
      data?: MessageData[Kind],
      unreliable = false
    ): Promise<MessageData[ReturnKind]> => {
      if (!this.serverFunctions.has(returnMessage))
        this.serverFunctions.set(returnMessage, new Set);

      const functions = this.serverFunctions.get(returnMessage)!;
      let returnValue: MessageData[ReturnKind] | undefined;
      functions.add(data => returnValue = data as never);
      this.client.emit(player, message, data, unreliable);

      while (returnValue === undefined)
        RunService.Heartbeat.Wait();

      return returnValue;
    },
    /**
     * Sets a callback for a simulated remote function
     *
     * @returns A destructor function that disconnects the callback from the message
     */
    setCallback: <Kind extends keyof MessageData, ReturnKind extends keyof MessageData>(
      message: Kind & BaseMessage,
      returnMessage: ReturnKind & BaseMessage,
      callback: ClientMessageFunctionCallback<MessageData[Kind], MessageData[ReturnKind]>
    ) => this.client.on(message, data => {
      const returnValue = callback(data);
      this.server.emit(returnMessage, returnValue);
    }),
  };

  private validateData(message: keyof MessageData & BaseMessage, data: unknown): boolean {
    const guard = this.guards.get(message)!;
    const guardPassed = guard(data);
    if (!guardPassed)
      warn(guardFailed(message, data));

    return guardPassed
  }

  private initialize(): this {
    if (RunService.IsClient()) {
      this.janitor.Add(this.clientEvents.sendClientMessage.connect(serializedPacket => this.onRemoteFire(serializedPacket)));
      this.janitor.Add(this.clientEvents.sendUnreliableClientMessage.connect(serializedPacket => this.onRemoteFire(serializedPacket)));
    } else {
      this.janitor.Add(this.serverEvents.sendServerMessage.connect((player, serializedPacket) => this.onRemoteFire(serializedPacket, player)));
      this.janitor.Add(this.serverEvents.sendUnreliableServerMessage.connect((player, serializedPacket) => this.onRemoteFire(serializedPacket, player)));
    }

    return this;
  }

  private onRemoteFire(serializedPacket: SerializedPacket, player?: Player): void {
    const { message } = messageSerializer.deserialize(serializedPacket.buffer, serializedPacket.blobs);

    this.executeEventCallbacks(message as never, serializedPacket, player);
    this.executeFunctions(message as never, serializedPacket);
  }

  private executeFunctions(message: keyof MessageData & BaseMessage, serializedPacket: SerializedPacket): void {
    const isServer = RunService.IsServer();
    const functionsMap = isServer ? this.serverFunctions : this.clientFunctions;
    const functions = functionsMap.get(message);
    if (functions === undefined) return;

    const serializer = this.getSerializer(message);
    const packet = serializer?.deserialize(serializedPacket.buffer, serializedPacket.blobs);
    for (const callback of functions)
      callback(packet?.data);
  }

  private executeEventCallbacks(message: keyof MessageData & BaseMessage, serializedPacket: SerializedPacket, player?: Player): void {
    const isServer = RunService.IsServer();
    const callbacksMap = isServer ? this.serverCallbacks : this.clientCallbacks;
    const callbacks: Set<MessageCallback> | undefined = callbacksMap.get(message);
    if (callbacks === undefined) return;

    const serializer = this.getSerializer(message);
    const packet = serializer?.deserialize(serializedPacket.buffer, serializedPacket.blobs);
    for (const callback of callbacks)
      if (isServer)
        callback(player!, packet?.data);
      else
        (callback as ClientMessageCallback)(packet?.data); // why doesn't it infer this?!?!?!
  }

  private once<Kind extends keyof MessageData>(
    message: Kind,
    callback: MessageCallback<MessageData[Kind]>,
    callbacksMap: Map<keyof MessageData, Set<MessageCallback>>
  ): () => void {
    const destructor = this.on(message, (player, data) => {
      destructor();
      (callback as MessageCallback)(player, data);
    }, callbacksMap);

    return destructor;
  }

  private on<Kind extends keyof MessageData>(
    message: Kind,
    callback: MessageCallback<MessageData[Kind]>,
    callbacksMap: Map<keyof MessageData, Set<MessageCallback>>
  ): () => void {
    if (!callbacksMap.has(message))
      callbacksMap.set(message, new Set);

    const callbacks: Set<MessageCallback> = callbacksMap.get(message)!;
    callbacks.add(callback as MessageCallback);
    callbacksMap.set(message, callbacks);
    return () => callbacks.delete(callback as MessageCallback);
  }

  private getPacket<Kind extends keyof MessageData>(message: Kind & BaseMessage, data?: MessageData[Kind]): SerializedPacket {
    const serializer = this.getSerializer(message);
    if (serializer === undefined) {
      warn(`[@rbxts/tether]: Failed to get packet for message '${message}', no serializer was found`);
      return messageSerializer.serialize({ message, data: undefined });
    }

    return serializer.serialize({ message, data: data! });
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