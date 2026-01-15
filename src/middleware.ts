import type { BaseMessage, SerializedPacket } from "./structs";

declare function newproxy<T extends symbol = symbol>(): T;

type DropRequestSymbol = symbol & { _drop_req?: undefined };
export const DropRequest = newproxy<DropRequestSymbol>();

export type ClientMiddleware<Data = unknown> = { _client?: void }
  & ((player: Player | Player[], ctx: MiddlewareContext<Data>) => DropRequestSymbol | void);

export type ServerMiddleware<Data = unknown> = { _server?: void } & SharedMiddleware<Data>;

export type SharedMiddleware<Data = unknown> = (ctx: MiddlewareContext<Data>) => DropRequestSymbol | void;

export type Middleware<Data = unknown> = ServerMiddleware<Data> & ClientMiddleware<Data> & SharedMiddleware<Data>;

export interface MiddlewareContext<Data = unknown, Message extends BaseMessage = BaseMessage> {
  readonly message: Message;
  data: Data;
  getRawData: () => SerializedPacket;
}

type RequestDropCallback = (message: BaseMessage, reason?: string) => void;

// TODO: middlewares upon received message
export class MiddlewareProvider<MessageData> {
  private readonly clientGlobalMiddlewares: Middleware[] = [];
  private readonly serverGlobalMiddlewares: Middleware[] = [];
  private readonly clientSendMiddlewares: Record<BaseMessage, Middleware[]> = {};
  private readonly serverSendMiddlewares: Record<BaseMessage, Middleware[]> = {};
  private readonly serverReceiveMiddlewares: Record<BaseMessage, Middleware[]> = {};
  private readonly clientReceiveMiddlewares: Record<BaseMessage, Middleware[]> = {};
  private readonly requestDroppedCallbacks = new Set<RequestDropCallback>;

  /**
   * Registers a callback to be called whenever a message is dropped.
   * The callback will receive the message that was dropped and an optional reason string.
   *
   * @returns A function that can be called to unregister the callback.
   */
  public onRequestDropped(callback: RequestDropCallback): () => void {
    this.requestDroppedCallbacks.add(callback);
    return () => this.requestDroppedCallbacks.delete(callback);
  }

  /** @hidden */
  public notifyRequestDropped(message: BaseMessage, reason?: string): void {
    for (const callback of this.requestDroppedCallbacks)
      callback(message, reason);
  }

  /** @hidden */
  public getClient<Kind extends keyof MessageData>(message: Kind & BaseMessage): ClientMiddleware<MessageData[Kind]>[] {
    return (this.clientSendMiddlewares[message] ??= []) as never;
  }

  /** @hidden */
  public getServer<Kind extends keyof MessageData>(message: Kind & BaseMessage): ServerMiddleware<MessageData[Kind]>[] {
    return (this.serverSendMiddlewares[message] ??= []) as never;
  }

  /** @hidden */
  public getClientGlobal<Data>(): ClientMiddleware<Data>[] {
    return this.clientGlobalMiddlewares as ClientMiddleware<Data>[];
  }

  /** @hidden */
  public getServerGlobal<Data>(): ServerMiddleware<Data>[] {
    return this.serverGlobalMiddlewares as ServerMiddleware<Data>[];
  }

  /** @hidden */
  public getClientReceive<Kind extends keyof MessageData>(message: Kind & BaseMessage): ServerMiddleware<MessageData[Kind]>[] {
    return (this.clientReceiveMiddlewares[message] ??= []) as never;
  }

  /** @hidden */
  public getServerReceive<Kind extends keyof MessageData>(message: Kind & BaseMessage): ClientMiddleware<MessageData[Kind]>[] {
    return (this.serverReceiveMiddlewares[message] ??= []) as never;
  }

  public useClient<Kind extends keyof MessageData>(
    message: Kind & BaseMessage,
    middlewares: ClientMiddleware<MessageData[Kind]> | readonly ClientMiddleware<MessageData[Kind]>[] | ClientMiddleware | readonly ClientMiddleware[],
    order?: number
  ): this {
    const messageMiddleware = this.getClient(message);
    if (typeIs(middlewares, "function"))
      messageMiddleware.insert(order ?? messageMiddleware.size() - 1, middlewares as never);
    else
      for (const middleware of middlewares)
        this.useClient(message, middleware, order);

    return this;
  }

  public useServer<Kind extends keyof MessageData>(
    message: Kind & BaseMessage,
    middlewares: ServerMiddleware<MessageData[Kind]> | readonly ServerMiddleware<MessageData[Kind]>[] | ServerMiddleware | readonly ServerMiddleware[],
    order?: number
  ): this {
    const messageMiddleware = this.getServer(message);
    if (typeIs(middlewares, "function"))
      messageMiddleware.insert(order ?? messageMiddleware.size() - 1, middlewares as never);
    else
      for (const middleware of middlewares)
        this.useServer(message, middleware, order);

    return this;
  }

  public useShared<Kind extends keyof MessageData>(
    message: Kind & BaseMessage,
    middlewares: SharedMiddleware<MessageData[Kind]> | readonly SharedMiddleware<MessageData[Kind]>[] | SharedMiddleware | readonly SharedMiddleware[],
    order?: number
  ): this {
    const server = middlewares as ServerMiddleware<MessageData[Kind]> | ServerMiddleware<MessageData[Kind]>[];
    const client = (typeIs(middlewares, "function") ? [middlewares] : middlewares)
      .map<ClientMiddleware<MessageData[Kind]>>(middleware => (_, ctx) => middleware(ctx as never));

    this.useServer(message, server, order);
    return this.useClient(message, client, order);
  }

  public useClientGlobal(
    middlewares: ClientMiddleware | readonly ClientMiddleware[],
    order?: number
  ): this {
    const globalMiddleware = this.getClientGlobal();
    if (typeIs(middlewares, "function"))
      globalMiddleware.insert(order ?? globalMiddleware.size() - 1, middlewares);
    else
      for (const middleware of middlewares)
        this.useClientGlobal(middleware, order);

    return this;
  }

  public useServerGlobal(
    middlewares: ServerMiddleware | readonly ServerMiddleware[],
    order?: number
  ): this {
    const globalMiddleware = this.getServerGlobal();
    if (typeIs(middlewares, "function"))
      globalMiddleware.insert(order ?? globalMiddleware.size() - 1, middlewares);
    else
      for (const middleware of middlewares)
        this.useServerGlobal(middleware, order);

    return this;
  }

  public useSharedGlobal(
    middlewares: SharedMiddleware | readonly SharedMiddleware[],
    order?: number
  ): this {
    const client = (typeIs(middlewares, "function") ? [middlewares] : middlewares)
      .map<ClientMiddleware>(middleware => (_, ctx) => middleware(ctx));

    this.useClientGlobal(client, order);
    return this.useServerGlobal(middlewares, order);
  }

  public deleteSharedGlobal<Kind extends keyof MessageData>(
    middlewares: SharedMiddleware<MessageData[Kind]> | readonly SharedMiddleware<MessageData[Kind]>[] | SharedMiddleware | readonly SharedMiddleware[]
  ): void {
    const server = middlewares as ServerMiddleware<MessageData[Kind]> | ServerMiddleware<MessageData[Kind]>[];
    const client = (typeIs(middlewares, "function") ? [middlewares] : middlewares)
      .map<ClientMiddleware<MessageData[Kind]>>(middleware => (_, ctx) => middleware(ctx as never));

    this.deleteClientGlobal(client);
    this.deleteServerGlobal(server);
  }

  public deleteClientGlobal<Kind extends keyof MessageData>(
    middlewares: ClientMiddleware<MessageData[Kind]> | readonly ClientMiddleware<MessageData[Kind]>[] | ClientMiddleware | readonly ClientMiddleware[]
  ): void {
    const clientMiddlewares = this.getClientGlobal();
    if (typeIs(middlewares, "function"))
      clientMiddlewares.remove(clientMiddlewares.indexOf(middlewares as never));
    else
      for (const middleware of middlewares)
        this.deleteClientGlobal(middleware);
  }

  public deleteServerGlobal<Kind extends keyof MessageData>(
    middlewares: ServerMiddleware<MessageData[Kind]> | readonly ServerMiddleware<MessageData[Kind]>[] | ServerMiddleware | readonly ServerMiddleware[]
  ): void {
    const serverMiddlewares = this.getServerGlobal();
    if (typeIs(middlewares, "function"))
      serverMiddlewares.remove(serverMiddlewares.indexOf(middlewares as never));
    else
      for (const middleware of middlewares)
        this.deleteServerGlobal(middleware);
  }

  public deleteShared<Kind extends keyof MessageData>(
    message: Kind & BaseMessage,
    middlewares: SharedMiddleware<MessageData[Kind]> | readonly SharedMiddleware<MessageData[Kind]>[] | SharedMiddleware | readonly SharedMiddleware[]
  ): void {
    const server = middlewares as ServerMiddleware<MessageData[Kind]> | ServerMiddleware<MessageData[Kind]>[];
    const client = (typeIs(middlewares, "function") ? [middlewares] : middlewares)
      .map<ClientMiddleware<MessageData[Kind]>>(middleware => (_, ctx) => middleware(ctx as never));

    this.deleteClient(message, client);
    this.deleteServer(message, server);
  }

  public deleteClient<Kind extends keyof MessageData>(
    message: Kind & BaseMessage,
    middlewares: ClientMiddleware<MessageData[Kind]> | readonly ClientMiddleware<MessageData[Kind]>[] | ClientMiddleware | readonly ClientMiddleware[]
  ): void {
    const clientMiddlewares = this.getClient(message);
    if (typeIs(middlewares, "function"))
      clientMiddlewares.remove(clientMiddlewares.indexOf(middlewares as never));
    else
      for (const middleware of middlewares)
        this.deleteClient(message, middleware);
  }

  public deleteServer<Kind extends keyof MessageData>(
    message: Kind & BaseMessage,
    middlewares: ServerMiddleware<MessageData[Kind]> | readonly ServerMiddleware<MessageData[Kind]>[] | ServerMiddleware | readonly ServerMiddleware[]
  ): void {
    const serverMiddlewares = this.getServer(message);
    if (typeIs(middlewares, "function"))
      serverMiddlewares.remove(serverMiddlewares.indexOf(middlewares as never));
    else
      for (const middleware of middlewares)
        this.deleteServer(message, middleware);
  }
}