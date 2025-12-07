import { Modding } from "@flamework/core";
import { Players, ReplicatedStorage, RunService } from "@rbxts/services";
import type { Serializer, SerializerMetadata } from "@rbxts/serio";
import Destroyable from "@rbxts/destroyable";
import Object from "@rbxts/object-utils";
import createSerializer from "@rbxts/serio";
import repr from "@rbxts/repr";

import { DropRequest, MiddlewareProvider, type MiddlewareContext } from "./middleware";
import type {
  SerializedPacket,
  ClientMessageCallback,
  ServerMessageCallback,
  MessageCallback,
  BaseMessage,
  Guard,
  MessageEmitterMetadata,
  MessageMetadata,
  ClientMessageFunctionCallback,
  ServerMessageFunctionCallback,
  PacketInfo,
  MessageEvent
} from "./structs";

const IS_LUNE = string.sub(_VERSION, 1, 4) === "Lune";
declare let setLuneContext: (ctx: "server" | "client" | "both") => void;
setLuneContext ??= () => { };

setLuneContext("both");
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

let sendMessage: RemoteEvent<MessageEvent>;
{
  const name = "sendMessage";
  const existing = ReplicatedStorage.FindFirstChild(name);
  const remote = (existing ?? new Instance("RemoteEvent", ReplicatedStorage)) as RemoteEvent<MessageEvent>;
  if (existing === undefined)
    remote.Name = name;

  sendMessage = remote;
}
let sendUnreliableMessage: UnreliableRemoteEvent<MessageEvent>;
{
  const name = "unreliableMessage";
  const existing = ReplicatedStorage.FindFirstChild(name);
  const remote = (existing ?? new Instance("UnreliableRemoteEvent", ReplicatedStorage)) as UnreliableRemoteEvent<MessageEvent>;
  if (existing === undefined)
    remote.Name = name;

  sendUnreliableMessage = remote;
}

export class MessageEmitter<MessageData> extends Destroyable {
  public readonly middleware = new MiddlewareProvider<MessageData>;

  private readonly guards = new Map<keyof MessageData, Guard>;
  private serializers: Partial<Record<keyof MessageData, Serializer<MessageData[keyof MessageData]>>> = {};
  private clientCallbacks = new Map<keyof MessageData, Set<ClientMessageCallback>>;
  private clientFunctions = new Map<keyof MessageData, Set<(data: unknown) => void>>;
  private serverCallbacks = new Map<keyof MessageData, Set<ServerMessageCallback>>;
  private serverFunctions = new Map<keyof MessageData, Set<(data: unknown) => void>>;
  private serverQueue: [keyof MessageData & BaseMessage, MessageData[keyof MessageData], boolean][] = [];
  private clientBroadcastQueue: [keyof MessageData & BaseMessage, MessageData[keyof MessageData], boolean][] = [];
  private clientQueue: [Player | Player[], keyof MessageData & BaseMessage, MessageData[keyof MessageData], boolean][] = [];

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
    this.trash.add(() => {
      this.clientCallbacks = new Map;
      this.serverCallbacks = new Map;
      this.clientFunctions = new Map;
      this.clientCallbacks = new Map;
      this.serializers = {};
      setmetatable(this, undefined);
    });
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
      const responseCallback = (data: unknown) => returnValue = data as never;
      functions.add(responseCallback);
      this.server.emit(message, data, unreliable);

      while (returnValue === undefined)
        RunService.Heartbeat.Wait();

      // Clean up the callback after receiving the response
      functions.delete(responseCallback);

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
        // Defer the response emission to end of frame and swap context to avoid context check issues
        // task.defer guarantees response is sent by end of current frame, ensuring predictable timing in production
        task.defer(() => {
          setLuneContext("server");
          this.client.emit(player, returnMessage, returnValue);
          setLuneContext("both");
        });
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
      const responseCallback = (data: unknown) => returnValue = data as never;
      functions.add(responseCallback);
      this.client.emit(player, message, data, unreliable);

      while (returnValue === undefined)
        RunService.Heartbeat.Wait();

      // Clean up the callback after receiving the response
      functions.delete(responseCallback);

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
        // Defer the response emission to end of frame and swap context to avoid context check issues
        // task.defer guarantees response is sent by end of current frame, ensuring predictable timing in production
        task.defer(() => {
          setLuneContext("client");
          this.server.emit(returnMessage, returnValue);
          setLuneContext("both");
        });
      });
    },
  };

  private initialize(): this {
    setLuneContext("client");
    if (RunService.IsClient()) {
      this.trash.add(sendMessage.OnClientEvent.Connect(
        (...serializedPacket) => this.onRemoteFire(false, serializedPacket))
      );
      this.trash.add(sendUnreliableMessage.OnClientEvent.Connect(
        (...serializedPacket) => this.onRemoteFire(false, serializedPacket))
      );
    }

    setLuneContext("server");
    if (RunService.IsServer()) {
      this.trash.add(sendMessage.OnServerEvent.Connect(
        (player, ...serializedPacket) => this.onRemoteFire(true, serializedPacket as never, player))
      );
      this.trash.add(sendUnreliableMessage.OnServerEvent.Connect(
        (player, ...serializedPacket) => this.onRemoteFire(true, serializedPacket as never, player))
      );
    }

    let elapsed = 0;
    const { batchRemotes, batchRate } = this.options;
    if (!batchRemotes)
      return this;

    this.trash.add(RunService.Heartbeat.Connect(dt => {
      elapsed += dt;
      if (elapsed < batchRate) return;

      elapsed -= batchRate;
      this.update();
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
        sendUnreliableMessage.FireServer(...unreliableServerPackets);
      if (!serverPackets.isEmpty())
        sendMessage.FireServer(...serverPackets);

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
        sendUnreliableMessage.FireAllClients(...unreliableBroadcastPackets);
      if (!broadcastPackets.isEmpty())
        sendMessage.FireAllClients(...broadcastPackets);

      this.clientBroadcastQueue = [];
    }

    if (!this.clientQueue.isEmpty()) {
      for (const [player, packetInfo] of clientPackets) {
        if (packetInfo.isEmpty()) continue;
        if (packetInfo.isEmpty()) continue;
        const unreliablePackets = packetInfo.filter(info => info.unreliable).map(getPacket);
        const packets = packetInfo.filter(info => !info.unreliable).map(getPacket);
        if (!unreliablePackets.isEmpty())
          sendUnreliableMessage.FireClient(player, ...unreliablePackets);
        if (!packets.isEmpty())
          sendMessage.FireClient(player, ...packets);
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
      getRawData: () => this.getPacket(message, data)
    };

    for (const globalMiddleware of this.middleware.getClientGlobal<MessageData[Kind]>()) {
      const result = globalMiddleware(players, ctx);
      if (!this.validateData(message, ctx.data, "Invalid data after global client middleware"))
        return [false, ctx.data];

      if (result === DropRequest) {
        this.middleware.notifyRequestDropped(message, "Global client middleware");
        return [true, ctx.data];
      }
    }

    for (const middleware of this.middleware.getClient(message)) {
      const result = middleware(players, ctx);
      if (!this.validateData(message, ctx.data, "Invalid data after client middleware"))
        return [false, ctx.data];

      if (result === DropRequest) {
        this.middleware.notifyRequestDropped(message, "Client middleware");
        return [true, ctx.data];
      }
    }

    if (!this.validateData(message, ctx.data))
      return [true, ctx.data];

    return [false, ctx.data];
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
      getRawData: () => this.getPacket(message, data)
    };

    for (const globalMiddleware of this.middleware.getServerGlobal<MessageData[Kind]>()) {
      if (!this.validateData(message, ctx.data, "Invalid data after global server middleware"))
        return [false, ctx.data];

      const result = globalMiddleware(ctx);
      if (result === DropRequest) {
        this.middleware.notifyRequestDropped(message, "Global server middleware");
        return [true, ctx.data];
      }
    }

    for (const middleware of this.middleware.getServer(message)) {
      if (!this.validateData(message, ctx.data, "Invalid data after server middleware"))
        return [false, ctx.data];

      const result = middleware(ctx);
      if (result === DropRequest) {
        this.middleware.notifyRequestDropped(message, "Server middleware");
        return [true, ctx.data];
      }
    }

    if (!this.validateData(message, ctx.data))
      return [true, ctx.data];

    return [false, ctx.data];
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

  private onRemoteFire(isServer: boolean, serializedPackets: SerializedPacket[], player?: Player): void {
    for (const packet of serializedPackets) {
      if (buffer.len(packet.messageBuf) > 1)
        return warn("[@rbxts/tether]: Rejected packet because message buffer was larger than one byte");

      const message = buffer.readu8(packet.messageBuf, 0) as never;
      this.executeEventCallbacks(isServer, message, packet, player);
      this.executeFunctions(isServer, message, packet);
    }
  }

  private executeFunctions(isServer: boolean, message: keyof MessageData & BaseMessage, serializedPacket: SerializedPacket): void {
    const functionsMap = isServer ? this.serverFunctions : this.clientFunctions;
    const functions = functionsMap.get(message);
    if (functions === undefined) return;

    const packet = this.deserializeAndValidate(message, serializedPacket);
    for (const callback of functions)
      callback(packet);
  }

  private executeEventCallbacks(isServer: boolean, message: keyof MessageData & BaseMessage, serializedPacket: SerializedPacket, player?: Player): void {
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