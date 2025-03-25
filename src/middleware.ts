import type { BaseMessage } from "./structs";

declare function newproxy<T extends symbol = symbol>(): T;

type DropRequestSymbol = symbol & { _skip_middleware?: undefined };
export const DropRequest = newproxy<DropRequestSymbol>();

export type ClientMiddleware<Data = unknown> = (message: BaseMessage) => (player: Player, data: Readonly<Data> | undefined) => DropRequestSymbol | void;
export type ServerMiddleware<Data = unknown> = (message: BaseMessage) => (data: Readonly<Data> | undefined) => DropRequestSymbol | void;
export type SharedMiddleware = (message: BaseMessage) => () => DropRequestSymbol | void;
export type Middleware<Data = unknown> = ServerMiddleware<Data> & ClientMiddleware<Data>;

export class MiddlewareProvider<MessageData> {
  /** @metadata poop */
  private readonly clientGlobalMiddlewares: Middleware[] = [];
  private readonly serverGlobalMiddlewares: Middleware[] = [];
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
  public getClientGlobal<Data>(): ClientMiddleware<Data>[] {
    return this.clientGlobalMiddlewares;
  }

  /** @hidden */
  public getServerGlobal<Data>(): ServerMiddleware<Data>[] {
    return this.serverGlobalMiddlewares;
  }

  public useClient<Kind extends keyof MessageData>(
    message: Kind,
    middlewares: ClientMiddleware<MessageData[Kind]> | readonly ClientMiddleware<MessageData[Kind]>[],
    order?: number
  ): this {
    const messageMiddleware = this.getClient(message);
    if (typeIs(middlewares, "function"))
      messageMiddleware.insert(order ?? messageMiddleware.size() - 1, middlewares);
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
    if (typeIs(middlewares, "function"))
      messageMiddleware.insert(order ?? messageMiddleware.size() - 1, middlewares);
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
    middlewares: ClientMiddleware<Data> | readonly ClientMiddleware<Data>[],
    order?: number
  ): this {
    const globalMiddleware = this.getClientGlobal();
    if (typeIs(middlewares, "function"))
      globalMiddleware.insert(order ?? globalMiddleware.size() - 1, middlewares as Middleware);
    else
      for (const middleware of middlewares as Middleware[])
        this.useClientGlobal(middleware, order);

    return this;
  }

  public useServerGlobal<Data>(
    middlewares: ServerMiddleware<Data> | readonly ServerMiddleware<Data>[],
    order?: number
  ): this {
    const globalMiddleware = this.getServerGlobal();
    if (typeIs(middlewares, "function"))
      globalMiddleware.insert(order ?? globalMiddleware.size() - 1, middlewares as Middleware);
    else
      for (const middleware of middlewares as Middleware[])
        this.useServerGlobal(middleware, order);

    return this;
  }

  public useSharedGlobal(
    middlewares: SharedMiddleware | readonly SharedMiddleware[],
    order?: number
  ): this {
    this.useClientGlobal(middlewares, order);
    this.useServerGlobal(middlewares, order);
    return this;
  }
}