import { Modding } from "@flamework/core";
import { Players, ReplicatedStorage, RunService } from "@rbxts/services";
import type { Serializer, SerializerMetadata } from "@rbxts/serio";
import Destroyable from "@rbxts/destroyable";
import Object from "@rbxts/object-utils";
import createSerializer from "@rbxts/serio";
import repr from "@rbxts/repr";

import { DropRequest, MiddlewareProvider, type MiddlewareContext } from "../middleware";
import type {
  SerializedPacket,
  ClientMessageCallback,
  ServerMessageCallback,
  MessageCallback,
  BaseMessage,
  Guard,
  MessageEmitterMetadata,
  MessageMetadata,
  ClientFunctionMessageCallback,
  ServerFunctionMessageCallback,
  PacketInfo,
  MessageEvent
} from "../structs";
import { ServerEmitter } from "./server-emitter";
import { ClientEmitter } from "./client-emitter";
import { Warning } from "../logging";

declare let setLuneContext: (ctx: "server" | "client" | "both") => void;
setLuneContext ??= () => { };

setLuneContext("both");
const guardFailed = (message: BaseMessage, data: unknown) =>
  `[tether::warning]: Type validation guard failed for message '${message}' - check your sent data\nSent data: ${repr(data)}`;

const defaultMesssageEmitterOptions: MessageEmitterOptions<unknown> = {
  batchRemotes: true,
  batchRate: 1 / 24,
  doNotBatch: new Set
};

interface MessageEmitterOptions<MessageData> {
  readonly batchRemotes: boolean;
  readonly batchRate: number;
  readonly doNotBatch: Set<keyof MessageData>;
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
  public readonly server = new ServerEmitter(this);
  public readonly client = new ClientEmitter(this);
  public readonly middleware = new MiddlewareProvider<MessageData>;
  /** @hidden */ public clientCallbacks = new Map<keyof MessageData, Set<ClientMessageCallback>>;
  /** @hidden */ public clientFunctions = new Map<keyof MessageData, Set<(data: unknown) => void>>;
  /** @hidden */ public serverCallbacks = new Map<keyof MessageData, Set<ServerMessageCallback>>;
  /** @hidden */ public serverFunctions = new Map<keyof MessageData, Set<(data: unknown) => void>>;

  private readonly guards = new Map<keyof MessageData, Guard>;
  private serializers: Partial<Record<keyof MessageData, Serializer<MessageData[keyof MessageData]>>> = {};
  private serverQueue: [keyof MessageData & BaseMessage, MessageData[keyof MessageData], boolean][] = [];
  private clientBroadcastQueue: [keyof MessageData & BaseMessage, MessageData[keyof MessageData], boolean][] = [];
  private clientQueue: [Player | Player[], keyof MessageData & BaseMessage, MessageData[keyof MessageData], boolean][] = [];

  /** @metadata macro */
  public static create<MessageData>(
    options?: Partial<MessageEmitterOptions<MessageData>>,
    meta?: Modding.Many<MessageEmitterMetadata<MessageData>>
  ): MessageEmitter<MessageData> {
    const emitter = new MessageEmitter<MessageData>(Object.assign({}, defaultMesssageEmitterOptions, options));
    if (meta === undefined) {
      warn(Warning.MetaGenerationFailed);
      return emitter.initialize();
    }

    // https://discord.com/channels/476080952636997633/506983834877689856/1363938149486821577
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
    private readonly options: MessageEmitterOptions<MessageData> = defaultMesssageEmitterOptions
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

  /** @hidden */
  public queueMessage<K extends keyof MessageData>(
    context: "client" | "server" | true,
    message: K & BaseMessage,
    data: (MessageEmitter<MessageData>["clientQueue"] | MessageEmitter<MessageData>["serverQueue"])[number]
  ): void {
    const queue = context === "client"
      ? this.clientQueue
      : context === true
        ? this.clientBroadcastQueue
        : this.serverQueue;

    queue.push(data as never);
    if (!this.shouldBatch(message))
      this.relay();
  }

  /** @hidden */
  public runClientMiddlewares<Kind extends keyof MessageData>(
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

  /** @hidden */
  public runServerMiddlewares<Kind extends keyof MessageData>(
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

  /** Set up emitter connections */
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
      this.relay();
    }));

    return this;
  }

  /** Send all queued data across the network simultaneously */
  private relay(): void {
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
        return warn(Warning.MessageBufferTooLong); // TODO: disable in production (so an exploiter wont know why the message was dropped)

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

  private shouldBatch<K extends keyof MessageData>(message: K & BaseMessage): boolean {
    return this.options.batchRemotes && !this.options.doNotBatch.has(message);
  }

  private deserializeAndValidate(message: keyof MessageData & number, serializedPacket: SerializedPacket) {
    const serializer = this.getSerializer(message);
    const packet = serializer?.deserialize(serializedPacket);
    this.validateData(message, packet);

    return packet;
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