import type { BaseMessage } from "./structs";

declare function newproxy(createMt?: boolean): symbol;

function createSymbol<T extends symbol = symbol>(name: string): T {
  const symbol = newproxy(true);
  const mt = getmetatable(symbol as never) as Record<string, unknown>;

  mt.__tostring = () => name;

  return symbol as T;
}

type DropRequestSymbol = symbol & { _skip_middleware?: undefined };
export const DropRequest = createSymbol<DropRequestSymbol>("DropRequest");

export type ClientMiddleware<Data = unknown> = (player: Player, data: Data | undefined) => DropRequestSymbol | void;
export type ServerMiddleware<Data = unknown> = (data: Data | undefined) => DropRequestSymbol | void;
export type Middleware<Data = unknown> = ServerMiddleware<Data> & ClientMiddleware<Data>;

export class MiddlewareProvider<MessageData> {
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

  public useClient<Kind extends keyof MessageData>(
    message: Kind,
    middlewares: ClientMiddleware<MessageData[Kind]> | ClientMiddleware<MessageData[Kind]>[],
    order?: number
  ): this {
    const messageMiddleware = this.getClient(message);
    if (typeOf(middlewares) === "function")
      messageMiddleware.insert(order ?? messageMiddleware.size() - 1, middlewares as Middleware);
    else
      for (const middleware of middlewares as Middleware[])
        this.useClient(message, middleware);

    return this;
  }

  public useServer<Kind extends keyof MessageData>(
    message: Kind,
    middlewares: ServerMiddleware<MessageData[Kind]> | ServerMiddleware<MessageData[Kind]>[],
    order?: number
  ): this {
    const messageMiddleware = this.getServer(message);
    if (typeOf(middlewares) === "function")
      messageMiddleware.insert(order ?? messageMiddleware.size() - 1, middlewares as Middleware);
    else
      for (const middleware of middlewares as Middleware[])
        this.useServer(message, middleware);

    return this;
  }
}