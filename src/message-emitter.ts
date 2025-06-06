import { Modding } from "@flamework/core";
import { Networking } from "@flamework/networking";
import { Players, RunService } from "@rbxts/services";
import type { Serializer, SerializerMetadata } from "@rbxts/serio";
import Destroyable from "@rbxts/destroyable";
import Object from "@rbxts/object-utils";
import createSerializer from "@rbxts/serio";
import repr from "@rbxts/repr";

import { DropRequest, MiddlewareProvider, type MiddlewareContext } from "./middleware";
import type {
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
  ServerMessageFunctionCallback,
  PacketInfo
} from "./structs";

const remotes = Networking.createEvent<ServerEvents, ClientEvents>();
const noServerListen = "[@rbxts/tether]: Cannot listen to server message from client";
const noClientListen = "[@rbxts/tether]: Cannot listen to client message from server";
const metaGenerationFailed =
  "[@rbxts/tether]: Failed to generate message metadata - make sure you have the Flamework transformer and are using Flamework macro-friendly types in your schemas";
const guardFailed = (message: BaseMessage, data: unknown) =>
  `[@rbxts/tether]: Type validation guard failed for message '${message}' - check your sent data\nSent data: ${repr(data)}`;

const defaultMesssageEmitterOptions: MessageEmitterOptions = {
  batchRemotes: true,
  batchRate: 1 / 24
}
interface MessageEmitterOptions {
  readonly batchRemotes: boolean;
  readonly batchRate: number;
}

export class MessageEmitter<MessageData> extends Destroyable {
  public readonly middleware = new MiddlewareProvider<MessageData>;

  private readonly clientCallbacks = new Map<keyof MessageData, Set<ClientMessageCallback>>;
  private readonly clientFunctions = new Map<keyof MessageData, Set<(data: unknown) => void>>;
  private readonly serverCallbacks = new Map<keyof MessageData, Set<ServerMessageCallback>>;
  private readonly serverFunctions = new Map<keyof MessageData, Set<(data: unknown) => void>>;
  private readonly guards = new Map<keyof MessageData, Guard>;
  private readonly serializers: Partial<Record<keyof MessageData, Serializer<MessageData[keyof MessageData]>>> = {};
  private serverQueue: [keyof MessageData & BaseMessage, MessageData[keyof MessageData], boolean][] = [];
  private clientBroadcastQueue: [keyof MessageData & BaseMessage, MessageData[keyof MessageData], boolean][] = [];
  private clientQueue: [Player | Player[], keyof MessageData & BaseMessage, MessageData[keyof MessageData], boolean][] = [];
  private serverEvents!: ReturnType<typeof remotes.createServer>;
  private clientEvents!: ReturnType<typeof remotes.createClient>;

  /** @metadata macro */
  public static create<MessageData>(
    options?: Partial<MessageEmitterOptions>,
    meta?: Modding.Many<MessageEmitterMetadata<MessageData>>
  ): MessageEmitter<MessageData> {
    const emitter = new MessageEmitter<MessageData>(Object.assign({}, defaultMesssageEmitterOptions, options));
    if (meta === undefined) {
      warn(metaGenerationFailed);
      return emitter.initialize();
    }

    type SorryLittensy = Record<BaseMessage, MessageMetadata<Record<BaseMessage, unknown>, BaseMessage>>;
    for (const [kind, { guard, serializerMetadata }] of pairs(meta as SorryLittensy)) {
      const numberKind = tonumber(kind) as keyof MessageData & BaseMessage;
      emitter.guards.set(numberKind, guard);

      if (serializerMetadata === undefined) continue;
      emitter.addSerializer(numberKind, serializerMetadata as never);
    }

    return emitter.initialize();
  }

  private constructor(
    private readonly options = defaultMesssageEmitterOptions
  ) {
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
    ) => {
      if (RunService.IsClient())
        error(noServerListen);

      return this.on(message, callback, this.serverCallbacks);
    },
    /**
     * Disconnects the callback as soon as it is called for the first time
     *
     * @returns A destructor function that disconnects the callback from the message
     */
    once: <Kind extends keyof MessageData>(
      message: Kind & BaseMessage,
      callback: ServerMessageCallback<MessageData[Kind]>
    ) => {
      if (RunService.IsClient())
        error(noServerListen);

      return this.once(message, callback, this.serverCallbacks);
    },
    /**
     * Emits a message to the server
     *
     * @param message The message kind to be sent
     * @param data The data associated with the message
     * @param unreliable Whether the message should be sent unreliably
     */
    emit: <Kind extends keyof MessageData>(message: Kind & BaseMessage, data?: MessageData[Kind], unreliable = false): void => {
      if (RunService.IsServer())
        error("[@rbxts/tether]: Cannot emit message to server from server");

      task.spawn(() => {
        const [dropRequest, newData] = this.runServerMiddlewares(message, data);
        if (dropRequest) return;

        this.serverQueue.push([message, newData, unreliable]);
        if (!this.options.batchRemotes)
          this.update();
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
      if (RunService.IsServer())
        error("[@rbxts/tether]: Cannot invoke server function from server");

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
    ) => {
      if (RunService.IsClient())
        error(noServerListen);

      return this.server.on(message, (player, data) => {
        const returnValue = callback(player, data);
        this.client.emit(player, returnMessage, returnValue);
      });
    }
  };

  public readonly client = {
    /**
     * @returns A destructor function that disconnects the callback from the message
     */
    on: <Kind extends keyof MessageData>(
      message: Kind & BaseMessage,
      callback: ClientMessageCallback<MessageData[Kind]>
    ) => {
      if (RunService.IsServer())
        error(noClientListen);

      return this.on(message, callback, this.clientCallbacks);
    },
    /**
     * Disconnects the callback as soon as it is called for the first time
     *
     * @returns A destructor function that disconnects the callback from the message
     */
    once: <Kind extends keyof MessageData>(
      message: Kind & BaseMessage,
      callback: ClientMessageCallback<MessageData[Kind]>
    ) => {
      if (RunService.IsServer())
        error(noClientListen);

      return this.once(message, callback, this.clientCallbacks);
    },
    /**
     * Emits a message to a specific client or multiple clients
     *
     * @param player The player(s) to whom the message is sent
     * @param message The message kind to be sent
     * @param data The data associated with the message
     * @param unreliable Whether the message should be sent unreliably
     */
    emit: <Kind extends keyof MessageData>(player: Player | Player[], message: Kind & BaseMessage, data?: MessageData[Kind], unreliable = false): void => {
      if (RunService.IsClient())
        error("[@rbxts/tether]: Cannot emit message to client from client");

      task.spawn(() => {
        const [dropRequest, newData] = this.runClientMiddlewares(message, data);
        if (dropRequest) return;

        this.clientQueue.push([player, message, newData, unreliable]);
        if (!this.options.batchRemotes)
          this.update();
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
      if (RunService.IsClient())
        error("[@rbxts/tether]: Cannot emit message to all clients from client");

      task.spawn(() => {
        const [dropRequest, newData] = this.runClientMiddlewares(message, data);
        if (dropRequest) return;

        this.clientBroadcastQueue.push([message, newData, unreliable]);
        if (!this.options.batchRemotes)
          this.update();
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
      if (RunService.IsClient())
        error("[@rbxts/tether]: Cannot invoke client function from client");

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
    ) => {
      if (RunService.IsServer())
        error(noClientListen);

      return this.client.on(message, data => {
        const returnValue = callback(data);
        this.server.emit(returnMessage, returnValue);
      });
    },
  };

  private initialize(): this {
    if (RunService.IsClient()) {
      this.janitor.Add(this.clientEvents.sendClientMessage.connect(serializedPacket => this.onRemoteFire(serializedPacket)));
      this.janitor.Add(this.clientEvents.sendUnreliableClientMessage.connect(serializedPacket => this.onRemoteFire(serializedPacket)));
    } else {
      this.janitor.Add(this.serverEvents.sendServerMessage.connect((player, serializedPacket) => this.onRemoteFire(serializedPacket, player)));
      this.janitor.Add(this.serverEvents.sendUnreliableServerMessage.connect((player, serializedPacket) => this.onRemoteFire(serializedPacket, player)));
    }

    let elapsed = 0;
    const { batchRemotes, batchRate } = this.options;
    if (!batchRemotes)
      return this;

    this.janitor.Add(RunService.Heartbeat.Connect(dt => {
      elapsed += dt;
      if (elapsed >= batchRate) {
        elapsed -= batchRate;
        this.update();
      }
    }));

    return this;
  }

  private update(): void {
    const getPacket = (info: PacketInfo): SerializedPacket => info.packet;
    if (RunService.IsClient()) {
      if (this.serverQueue.isEmpty()) return;

      const serverPacketInfos = this.serverQueue.map<PacketInfo>(([message, data, unreliable]) => {
        const packet = this.getPacket(message, data);
        return { packet, unreliable };
      });

      const unreliableServerPackets = serverPacketInfos.filter(info => info.unreliable).map(getPacket);
      const serverPackets = serverPacketInfos.filter(info => !info.unreliable).map(getPacket);
      if (!unreliableServerPackets.isEmpty())
        this.clientEvents.sendUnreliableServerMessage(unreliableServerPackets);
      if (!serverPackets.isEmpty())
        this.clientEvents.sendServerMessage(serverPackets);

      this.serverQueue = [];
      return;
    }

    const clientPackets = new Map<Player, PacketInfo[]>;
    const addClientPacket = (player: Player, packetInfo: PacketInfo): void => {
      const packetList = clientPackets.get(player) ?? [];
      packetList.push(packetInfo);
      clientPackets.set(player, packetList);
    };

    for (const [player, message, data, unreliable] of this.clientQueue) {
      const packet = this.getPacket(message, data);
      const info = { packet, unreliable };
      if (typeIs(player, "Instance"))
        addClientPacket(player, info);
      else
        for (const p of player)
          addClientPacket(p, info);
    }

    if (!this.clientBroadcastQueue.isEmpty()) {
      const clientBroadcastPackets = this.clientBroadcastQueue.map<PacketInfo>(([message, data, unreliable]) => {
        const packet = this.getPacket(message, data);
        return { packet, unreliable };
      });

      const unreliableBroadcastPackets = clientBroadcastPackets.filter(info => info.unreliable).map(getPacket);
      const broadcastPackets = clientBroadcastPackets.filter(info => !info.unreliable).map(getPacket);
      if (!unreliableBroadcastPackets.isEmpty())
        this.serverEvents.sendUnreliableClientMessage.broadcast(unreliableBroadcastPackets);
      if (!broadcastPackets.isEmpty())
        this.serverEvents.sendClientMessage.broadcast(broadcastPackets);

      this.clientBroadcastQueue = [];
    }

    if (!this.clientQueue.isEmpty()) {
      for (const [player, packetInfo] of clientPackets) {
        if (packetInfo.isEmpty()) continue;
        if (packetInfo.isEmpty()) continue;
        const unreliablePackets = packetInfo.filter(info => info.unreliable).map(getPacket);
        const packets = packetInfo.filter(info => !info.unreliable).map(getPacket);
        if (!unreliablePackets.isEmpty())
          this.serverEvents.sendUnreliableClientMessage(player, unreliablePackets);
        if (!packets.isEmpty())
          this.serverEvents.sendClientMessage(player, packets);
      }

      this.clientQueue = [];
    }
  }

  private runClientMiddlewares<Kind extends keyof MessageData>(
    message: Kind & BaseMessage,
    data?: MessageData[Kind],
    player?: Player | Player[]
  ): [boolean, MessageData[Kind]] {
    if (!this.validateData(message, data))
      return [true, data!];

    const players = player ?? Players.GetPlayers();
    const ctx: MiddlewareContext<MessageData[Kind], Kind & BaseMessage> = {
      message,
      data: data!,
      updateData: (newData?: MessageData[Kind]) => void (data = newData),
      getRawData: () => this.getPacket(message, data)
    };

    for (const globalMiddleware of this.middleware.getClientGlobal<MessageData[Kind]>()) {
      const result = globalMiddleware(players, ctx);
      if (!this.validateData(message, data, "Invalid data after global client middleware"))
        return [false, data!];

      if (result === DropRequest) {
        this.middleware.notifyRequestDropped(message, "Global client middleware");
        return [true, data!];
      }
    }

    for (const middleware of this.middleware.getClient(message)) {
      const result = middleware(players, ctx);
      if (!this.validateData(message, data, "Invalid data after client middleware"))
        return [false, data!];

      if (result === DropRequest) {
        this.middleware.notifyRequestDropped(message, "Client middleware");
        return [true, data!];
      }
    }

    if (!this.validateData(message, data))
      return [true, data!];

    return [false, data!];
  }

  private runServerMiddlewares<Kind extends keyof MessageData>(
    message: Kind & BaseMessage,
    data?: MessageData[Kind]
  ): [boolean, MessageData[Kind]] {
    if (!this.validateData(message, data))
      return [true, data!];

    const ctx: MiddlewareContext<MessageData[Kind], Kind & BaseMessage> = {
      message,
      data: data!,
      updateData: (newData?: MessageData[Kind]) => void (data = newData),
      getRawData: () => this.getPacket(message, data)
    };

    for (const globalMiddleware of this.middleware.getServerGlobal<MessageData[Kind]>()) {
      if (!this.validateData(message, data, "Invalid data after global server middleware"))
        return [false, data!];

      const result = globalMiddleware(ctx);
      if (result === DropRequest) {
        this.middleware.notifyRequestDropped(message, "Global server middleware");
        return [true, data!];
      }
    }

    for (const middleware of this.middleware.getServer(message)) {
      if (!this.validateData(message, data, "Invalid data after server middleware"))
        return [false, data!];

      const result = middleware(ctx);
      if (result === DropRequest) {
        this.middleware.notifyRequestDropped(message, "Server middleware");
        return [true, data!];
      }
    }

    if (!this.validateData(message, data))
      return [true, data!];

    return [false, data!];
  }

  private validateData(message: keyof MessageData & BaseMessage, data: unknown, requestDropReason = "Invalid data"): boolean {
    const guard = this.guards.get(message)!;
    const guardPassed = guard(data);
    if (!guardPassed) {
      warn(guardFailed(message, data));
      this.middleware.notifyRequestDropped(message, requestDropReason);
    }

    return guardPassed
  }

  private onRemoteFire(serializedPackets: SerializedPacket[], player?: Player): void {
    for (const packet of serializedPackets) {
      if (buffer.len(packet.messageBuf) > 1)
        return warn("[@rbxts/tether]: Rejected packet because message buffer was larger than one byte");

      const message = buffer.readu8(packet.messageBuf, 0) as never;
      this.executeEventCallbacks(message, packet, player);
      this.executeFunctions(message, packet);
    }
  }

  private executeFunctions(message: keyof MessageData & BaseMessage, serializedPacket: SerializedPacket): void {
    const isServer = RunService.IsServer();
    const functionsMap = isServer ? this.serverFunctions : this.clientFunctions;
    const functions = functionsMap.get(message);
    if (functions === undefined) return;

    const packet = this.deserializeAndValidate(message, serializedPacket);
    for (const callback of functions)
      callback(packet);
  }

  private executeEventCallbacks(message: keyof MessageData & BaseMessage, serializedPacket: SerializedPacket, player?: Player): void {
    const isServer = RunService.IsServer();
    const callbacksMap = isServer ? this.serverCallbacks : this.clientCallbacks;
    const callbacks: Set<MessageCallback> | undefined = callbacksMap.get(message);
    if (callbacks === undefined) return;

    const packet = this.deserializeAndValidate(message, serializedPacket);
    for (const callback of callbacks)
      if (isServer)
        callback(player!, packet);
      else
        (callback as ClientMessageCallback)(packet); // why doesn't it infer this?!?!?!
  }

  private deserializeAndValidate(message: keyof MessageData & number, serializedPacket: SerializedPacket) {
    const serializer = this.getSerializer(message);
    const packet = serializer?.deserialize(serializedPacket);
    this.validateData(message, packet);
    return packet;
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
    const messageBuf = buffer.create(1);
    buffer.writeu8(messageBuf, 0, message);
    if (serializer === undefined)
      return {
        messageBuf,
        buf: buffer.create(0),
        blobs: []
      };

    return { messageBuf: messageBuf, ...serializer.serialize(data) };
  }

  /** @metadata macro */
  private addSerializer<Kind extends keyof MessageData>(message: Kind & BaseMessage, meta?: Modding.Many<SerializerMetadata<MessageData[Kind]>>): void {
    this.serializers[message] = this.createMessageSerializer(meta) as never;
  }

  /** @metadata macro */
  private createMessageSerializer<Kind extends keyof MessageData>(meta?: Modding.Many<SerializerMetadata<MessageData[Kind]>>): Serializer<MessageData[Kind]> {
    return createSerializer<MessageData[Kind]>(meta);
  }

  private getSerializer<Kind extends keyof MessageData>(message: Kind & BaseMessage): Serializer<MessageData[Kind] | undefined> | undefined {
    return this.serializers[message] as never;
  }
}