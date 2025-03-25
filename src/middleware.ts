import type { BaseMessage } from "./structs";

declare function newproxy<T extends symbol = symbol>(): T;

type DropRequestSymbol = symbol & { _skip_middleware?: undefined };
export const DropRequest = newproxy<DropRequestSymbol>();

export type ClientMiddleware<Data = unknown> = (message: BaseMessage) => (player: Player, data: Readonly<Data> | undefined) => DropRequestSymbol | void;
export type ServerMiddleware<Data = unknown> = (message: BaseMessage) => (data: Readonly<Data> | undefined) => DropRequestSymbol | void;
export type SharedMiddleware = (message: BaseMessage) => () => DropRequestSymbol | void;
export type Middleware<Data = unknown> = ServerMiddleware<Data> & ClientMiddleware<Data>;

export type ClientGlobalMiddleware<Data = unknown> = (player: Player, data: Readonly<Data> | undefined) => DropRequestSymbol | void;
export type ServerGlobalMiddleware<Data = unknown> = (data: Readonly<Data> | undefined) => DropRequestSymbol | void;
export type SharedGlobalMiddleware = () => DropRequestSymbol | void;
export type GlobalMiddleware<Data = unknown> = ServerGlobalMiddleware<Data> & ClientGlobalMiddleware<Data>;

export class MiddlewareProvider<MessageData> {
  private readonly clientGlobalMiddlewares: GlobalMiddleware[] = [];
  private readonly serverGlobalMiddlewares: GlobalMiddleware[] = [];
  private readonly clientMiddlewares: Record<BaseMessage, Middleware[]> = {};
  private readonly serverMiddlewares: Record<BaseMessage, Middleware[]> = {};

  /** @hidden */
  public getClient<Kind extends keyof MessageData>(message: Kind): ClientMiddleware<MessageData[Kind]>[] {
    if (this.clientMiddlewares[message] === undefined)
      this.clientMiddlewares[message] = [];

    return this.clientMiddlewares[message];
  }

  /** @hidden */
  public getServer<Kind extends keyof MessageData>(message: Kind): ServerMiddleware<MessageData[Kind]>[] {
    if (this.serverMiddlewares[message] === undefined)
      this.serverMiddlewares[message] = [];

    return this.serverMiddlewares[message];
  }

  /** @hidden */
  public getClientGlobal<Data>(): ClientGlobalMiddleware<Data>[] {
    return this.clientGlobalMiddlewares;
  }

  /** @hidden */
  public getServerGlobal<Data>(): ServerGlobalMiddleware<Data>[] {
    return this.serverGlobalMiddlewares;
  }

  public useClient<Kind extends keyof MessageData>(
    message: Kind,
    middlewares: ClientMiddleware<MessageData[Kind]> | readonly ClientMiddleware<MessageData[Kind]>[],
    order?: number
  ): this {
    const messageMiddleware = this.getClient(message);
    if (typeOf(middlewares) === "function")
      messageMiddleware.insert(order ?? messageMiddleware.size() - 1, middlewares as Middleware);
    else
      for (const middleware of middlewares as Middleware[])
        this.useClient(message, middleware, order);

    return this;
  }

  public useServer<Kind extends keyof MessageData>(
    message: Kind,
    middlewares: ServerMiddleware<MessageData[Kind]> | readonly ServerMiddleware<MessageData[Kind]>[],
    order?: number
  ): this {
    const messageMiddleware = this.getServer(message);
    if (typeOf(middlewares) === "function")
      messageMiddleware.insert(order ?? messageMiddleware.size() - 1, middlewares as Middleware);
    else
      for (const middleware of middlewares as Middleware[])
        this.useServer(message, middleware, order);

    return this;
  }

  public useShared<Kind extends keyof MessageData>(
    message: Kind,
    middlewares: SharedMiddleware | readonly SharedMiddleware[],
    order?: number
  ): this {
    this.useClient(message, middlewares, order);
    this.useServer(message, middlewares, order);
    return this;
  }

  public useClientGlobal<Data>(
    middlewares: ClientGlobalMiddleware<Data> | readonly ClientGlobalMiddleware<Data>[],
    order?: number
  ): this {
    const globalMiddleware = this.getClientGlobal();
    if (typeIs(middlewares, "function"))
      globalMiddleware.insert(order ?? globalMiddleware.size() - 1, middlewares as GlobalMiddleware);
    else
      for (const middleware of middlewares as GlobalMiddleware[])
        this.useClientGlobal(middleware, order);

    return this;
  }

  public useServerGlobal<Data>(
    middlewares: ServerGlobalMiddleware<Data> | readonly ServerGlobalMiddleware<Data>[],
    order?: number
  ): this {
    const globalMiddleware = this.getServerGlobal();
    if (typeIs(middlewares, "function"))
      globalMiddleware.insert(order ?? globalMiddleware.size() - 1, middlewares as GlobalMiddleware);
    else
      for (const middleware of middlewares as GlobalMiddleware[])
        this.useServerGlobal(middleware, order);

    return this;
  }

  public useSharedGlobal(
    middlewares: SharedGlobalMiddleware | readonly SharedGlobalMiddleware[],
    order?: number
  ): this {
    this.useClientGlobal(middlewares, order);
    this.useServerGlobal(middlewares, order);
    return this;
  }
}