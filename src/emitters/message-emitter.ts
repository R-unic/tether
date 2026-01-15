import { Modding } from "@flamework/core";
import { Players } from "@rbxts/services";
import { Trash } from "@rbxts/trash";
import Destroyable from "@rbxts/destroyable";
import Object from "@rbxts/object-utils";
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
  MessageMetadata
} from "../structs";
import { ServerEmitter } from "./server-emitter";
import { ClientEmitter } from "./client-emitter";
import { Warning } from "../logging";
import { Relayer } from "../relayer";
import { Serdes } from "../serdes";
import { readMessage } from "../utility";

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

export interface MessageEmitterOptions<MessageData> {
  readonly batchRemotes: boolean;
  readonly batchRate: number;
  readonly doNotBatch: Set<keyof MessageData>;
}

export class MessageEmitter<MessageData> extends Destroyable {
  public readonly server = new ServerEmitter(this);
  public readonly client = new ClientEmitter(this);
  public readonly middleware = new MiddlewareProvider<MessageData>;

  /** @hidden */ declare public readonly trash: Trash;
  /** @hidden */ public readonly relayer = new Relayer(this);
  /** @hidden */ public readonly serdes = new Serdes<MessageData>;
  /** @hidden */ public clientCallbacks = new Map<keyof MessageData, Set<ClientMessageCallback>>;
  /** @hidden */ public clientFunctions = new Map<keyof MessageData, Set<(data: unknown) => void>>;
  /** @hidden */ public serverCallbacks = new Map<keyof MessageData, Set<ServerMessageCallback>>;
  /** @hidden */ public serverFunctions = new Map<keyof MessageData, Set<(data: unknown) => void>>;

  private readonly guards = new Map<keyof MessageData, Guard>;

  /** @metadata macro */
  public static create<MessageData>(
    options?: Partial<MessageEmitterOptions<MessageData>>,
    meta?: Modding.Many<MessageEmitterMetadata<MessageData>>
  ): MessageEmitter<MessageData> {
    const emitter = new MessageEmitter<MessageData>(Object.assign({}, defaultMesssageEmitterOptions, options));
    if (meta === undefined) {
      warn(Warning.MetaGenerationFailed);
      return emitter;
    }

    // lore
    // https://discord.com/channels/476080952636997633/506983834877689856/1363938149486821577
    type SorryLittensy = Record<BaseMessage, MessageMetadata<Record<BaseMessage, unknown>, BaseMessage>>;
    for (const [kind, { guard, serializerMetadata }] of pairs(meta as SorryLittensy)) {
      const numberKind = tonumber(kind) as keyof MessageData & BaseMessage;
      emitter.guards.set(numberKind, guard);

      if (serializerMetadata === undefined) continue;
      emitter.serdes.addSerializer(numberKind, serializerMetadata as never);
    }

    return emitter;
  }

  private constructor(
    public readonly options: MessageEmitterOptions<MessageData> = defaultMesssageEmitterOptions
  ) {
    super();
    this.trash.add(() => {
      this.clientCallbacks = new Map;
      this.serverCallbacks = new Map;
      this.clientFunctions = new Map;
      this.clientCallbacks = new Map;
      this.serdes.serializers = {};
      this.relayer.relayAll(); // empty all message queues
      setmetatable(this, undefined);
    });
  }

  /** @hidden */
  public runClientSendMiddlewares<Kind extends keyof MessageData>(
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
      getRawData: () => this.serdes.serializePacket(message, data)
    };

    for (const globalMiddleware of this.middleware.getClientGlobal<MessageData[Kind]>()) {
      const result = globalMiddleware(players, ctx);
      if (!this.validateData(message, ctx.data, "Invalid data after global client middleware"))
        return [true, ctx.data];

      if (result === DropRequest) {
        this.middleware.notifyRequestDropped(message, "Global client middleware");
        return [true, ctx.data];
      }
    }

    for (const middleware of this.middleware.getClient(message)) {
      const result = middleware(players, ctx);
      if (!this.validateData(message, ctx.data, "Invalid data after client middleware"))
        return [true, ctx.data];

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
  public runServerSendMiddlewares<Kind extends keyof MessageData>(
    message: Kind & BaseMessage,
    data?: MessageData[Kind]
  ): [boolean, MessageData[Kind]] {
    if (!this.validateData(message, data))
      return [true, data!];

    const ctx: MiddlewareContext<MessageData[Kind], Kind & BaseMessage> = {
      message,
      data: data!,
      getRawData: () => this.serdes.serializePacket(message, data)
    };

    for (const globalMiddleware of this.middleware.getServerGlobal<MessageData[Kind]>()) {
      if (!this.validateData(message, ctx.data, "Invalid data after global server middleware"))
        return [true, ctx.data];

      const result = globalMiddleware(ctx);
      if (result === DropRequest) {
        this.middleware.notifyRequestDropped(message, "Global server middleware");
        return [true, ctx.data];
      }
    }

    for (const middleware of this.middleware.getServer(message)) {
      if (!this.validateData(message, ctx.data, "Invalid data after server middleware"))
        return [true, ctx.data];

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

  /** @hidden */
  public onRemoteFire(isServer: boolean, serializedPackets: SerializedPacket[], player?: Player): void {
    for (const packet of serializedPackets) {
      if (buffer.len(packet.messageBuf) > 1)
        return warn(Warning.MessageBufferTooLong); // TODO: disable in production (so an exploiter wont know why the message was dropped)

      const message = readMessage(packet) as never;
      this.executeEventCallbacks(isServer, message, packet, player);
      this.executeFunctions(isServer, message, packet);
    }
  }

  private runServerReceiveMiddlewares<Kind extends keyof MessageData>(
    message: Kind & BaseMessage,
    player: Player | Player[],
    data?: MessageData[Kind]
  ): [boolean, MessageData[Kind]] {
    const ctx: MiddlewareContext<MessageData[Kind], Kind & BaseMessage> = {
      message,
      data: data!,
      getRawData: () => this.serdes.serializePacket(message, data)
    };

    for (const middleware of this.middleware.getServerReceive(message)) {
      const result = middleware(player, ctx);
      if (!this.validateData(message, ctx.data, "Invalid data after server receive middleware"))
        return [true, ctx.data];

      if (result === DropRequest) { // TODO: fix this really stupid behavior since its not actually dropping the request
        this.middleware.notifyRequestDropped(message, "Server receive middleware");
        return [true, ctx.data];
      }
    }

    if (!this.validateData(message, ctx.data))
      return [true, ctx.data];

    return [false, ctx.data];
  }

  private runClientReceiveMiddlewares<Kind extends keyof MessageData>(
    message: Kind & BaseMessage,
    data?: MessageData[Kind]
  ): [boolean, MessageData[Kind]] {
    const ctx: MiddlewareContext<MessageData[Kind], Kind & BaseMessage> = {
      message,
      data: data!,
      getRawData: () => this.serdes.serializePacket(message, data)
    };

    for (const middleware of this.middleware.getClientReceive(message)) {
      const result = middleware(ctx);
      if (!this.validateData(message, ctx.data, "Invalid data after client receive middleware"))
        return [true, ctx.data];

      if (result === DropRequest) { // TODO: fix this really stupid behavior since its not actually dropping the request
        this.middleware.notifyRequestDropped(message, "Client receive middleware");
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

  private executeFunctions(isServer: boolean, message: keyof MessageData & BaseMessage, serializedPacket: SerializedPacket): void {
    const functionsMap = isServer ? this.serverFunctions : this.clientFunctions;
    const functions = functionsMap.get(message);
    if (functions === undefined) return;

    const data = this.serdes.deserializePacket(message, serializedPacket);
    for (const callback of functions)
      this.executeClientCallback(callback, message, data); // not strictly client the type just fits
  }

  private executeEventCallbacks(isServer: boolean, message: keyof MessageData & BaseMessage, serializedPacket: SerializedPacket, player?: Player): void {
    const callbacksMap = isServer ? this.serverCallbacks : this.clientCallbacks;
    const callbacks: Set<MessageCallback> | undefined = callbacksMap.get(message);
    if (callbacks === undefined) return;

    const data = this.serdes.deserializePacket(message, serializedPacket);
    for (const callback of callbacks)
      if (isServer) {
        assert(player !== undefined);
        this.executeServerCallback(callback, player, message, data);
      } else
        this.executeClientCallback(callback as ClientMessageCallback, message, data);
  }

  private executeServerCallback<Kind extends keyof MessageData>(
    callback: ServerMessageCallback,
    player: Player,
    message: Kind & BaseMessage,
    data?: MessageData[Kind]
  ): void {
    const [dropRequest, newData] = this.runServerReceiveMiddlewares(message, player, data);
    if (dropRequest) return;

    callback(player, newData);
  }

  private executeClientCallback<Kind extends keyof MessageData>(
    callback: ClientMessageCallback,
    message: Kind & BaseMessage,
    data?: MessageData[Kind]
  ): void {
    const [dropRequest, newData] = this.runClientReceiveMiddlewares(message, data);
    if (dropRequest) return;

    callback(newData);
  }
}