import type { BaseMessage, SerializedPacket } from "./structs";

declare function newproxy<T extends symbol = symbol>(): T;

type DropRequestSymbol = symbol & { _drop_req?: undefined };
export const DropRequest = newproxy<DropRequestSymbol>();

type UpdateDataFn<T> = (newData: T) => void;
type GetRawDataFn = () => SerializedPacket;
export type ClientMiddleware<Data = unknown> = { _client?: void }
  & ((message: BaseMessage) =>
    (player: Player | Player[], data: Readonly<Data>, updateData: UpdateDataFn<Data>, getRawData: GetRawDataFn) => DropRequestSymbol | void);

export type ServerMiddleware<Data = unknown> = SharedMiddleware<Data> & { _server?: void };

export type SharedMiddleware<Data = unknown> =
  (message: BaseMessage) =>
    (data: Readonly<Data>, updateData: UpdateDataFn<Data>, getRawData: GetRawDataFn) => DropRequestSymbol | void;

export type Middleware<Data = unknown> = ServerMiddleware<Data> & ClientMiddleware<Data> & SharedMiddleware<Data>;

export class MiddlewareProvider<MessageData> {
  private readonly clientGlobalMiddlewares: Middleware[] = [];
  private readonly serverGlobalMiddlewares: Middleware[] = [];
  private readonly clientMiddlewares: Record<BaseMessage, Middleware[]> = {};
  private readonly serverMiddlewares: Record<BaseMessage, Middleware[]> = {};

  /** @hidden */
  public getClient<Kind extends keyof MessageData>(message: Kind & BaseMessage): ClientMiddleware<MessageData[Kind]>[] {
    if (this.clientMiddlewares[message] === undefined)
      this.clientMiddlewares[message] = [];

    return this.clientMiddlewares[message] as ClientMiddleware<MessageData[Kind]>[];
  }

  /** @hidden */
  public getServer<Kind extends keyof MessageData>(message: Kind & BaseMessage): ServerMiddleware<MessageData[Kind]>[] {
    if (this.serverMiddlewares[message] === undefined)
      this.serverMiddlewares[message] = [];

    return this.serverMiddlewares[message] as ServerMiddleware<MessageData[Kind]>[];
  }

  /** @hidden */
  public getClientGlobal<Data>(): ClientMiddleware<Data>[] {
    return this.clientGlobalMiddlewares as ClientMiddleware<Data>[];
  }

  /** @hidden */
  public getServerGlobal<Data>(): ServerMiddleware<Data>[] {
    return this.serverGlobalMiddlewares as ServerMiddleware<Data>[];
  }

  public useClient<Kind extends keyof MessageData>(
    message: Kind & BaseMessage,
    middlewares: ClientMiddleware<MessageData[Kind]> | readonly ClientMiddleware<MessageData[Kind]>[],
    order?: number
  ): this {
    const messageMiddleware = this.getClient(message);
    if (typeIs(middlewares, "function"))
      messageMiddleware.insert(order ?? messageMiddleware.size() - 1, middlewares);
    else
      for (const middleware of middlewares)
        this.useClient(message, middleware, order);

    return this;
  }

  public useServer<Kind extends keyof MessageData>(
    message: Kind & BaseMessage,
    middlewares: ServerMiddleware<MessageData[Kind]> | readonly ServerMiddleware<MessageData[Kind]>[],
    order?: number
  ): this {
    const messageMiddleware = this.getServer(message);
    if (typeIs(middlewares, "function"))
      messageMiddleware.insert(order ?? messageMiddleware.size() - 1, middlewares);
    else
      for (const middleware of middlewares)
        this.useServer(message, middleware, order);

    return this;
  }

  public useShared<Kind extends keyof MessageData>(
    message: Kind & BaseMessage,
    middlewares: SharedMiddleware<MessageData[Kind]> | readonly SharedMiddleware<MessageData[Kind]>[],
    order?: number
  ): this {
    const server = middlewares as ServerMiddleware<MessageData[Kind]> | ServerMiddleware<MessageData[Kind]>[];
    const client = (typeIs(middlewares, "function") ? [middlewares] : middlewares)
      .map<ClientMiddleware<MessageData[Kind]>>(middleware =>
        message =>
          (_, data, updateData, getRawData) =>
            middleware(message)(data, updateData as UpdateDataFn<unknown>, getRawData));

    this.useServer(message, server, order);
    this.useClient(message, client, order);
    return this;
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
      .map<ClientMiddleware>(middleware =>
        message =>
          (_, data, updateData, getRawData) =>
            middleware(message)(data, updateData as UpdateDataFn<unknown>, getRawData));

    this.useClientGlobal(client, order);
    this.useServerGlobal(middlewares, order);
    return this;
  }
}