# Tether
A message-based networking solution for Roblox with automatic binary serialization.

## Usage

### In `shared/messaging.ts`
```ts
import type { DataType } from "@rbxts/flamework-binary-serializer";
import { MessageEmitter } from "@rbxts/tether";

export const messaging = MessageEmitter.create<MessageData>();

export const enum Message {
  Test
}

export interface MessageData {
  [Message.Test]: {
    readonly foo: string;
    readonly n: DataType.u8;
  };
}
```

> [!CAUTION]
> Every single message kind must implement an interface for it's data (in the example that would be the object with the `foo` and `bar` fields). Message serialization (as well as your message itself) will not work if you don't do this.

### Server
```ts
import { Message, messaging } from "shared/messaging";

messaging.onServerMessage(Message.Test, (player, data) => {
  print(player, "sent data:", data);
});
```

### Client
```ts
import { Message, messaging } from "shared/messaging";

messaging.emitServer(Message.Test, {
  foo: "bar",
  n: 69
});
```

## Middleware
Drop or delay requests

### Creating middleware

#### Client
```ts
import { type ClientMiddleware, DropRequest } from "@rbxts/tether";

export function logClient(): ClientMiddleware {
  return message =>
    (player, data) =>
      print(`[LOG]: Message ${message} sent to player ${player} with data ${data}`);
}
```

#### Server
```ts
import { type ServerMiddleware, DropRequest } from "@rbxts/tether";

export function logServer(): ServerMiddleware {
  return message =>
    data =>
      print(`[LOG]: Message ${message} sent to server with data ${data}`);
}
```

#### Shared
```ts
import { type SharedMiddleware, DropRequest } from "@rbxts/tether";

export function rateLimit(interval: number): SharedMiddleware<MessageData> {
  let lastRequest = 0;

  return message =>
    () => {
      if (os.clock() - lastRequest < interval)
        return DropRequest;

      lastRequest = os.clock();
    };
}
```

### Using middleware
```ts
import type { DataType } from "@rbxts/flamework-binary-serializer";
import { MessageEmitter, BuiltinMiddlewares } from "@rbxts/tether";

export const messaging = MessageEmitter.create<MessageData>();
messaging.middleware
  // only allows requests to the server every 5 seconds,
  // drops any requests that occur within 5 seconds of each other
  .useServer(Message.Test, [BuiltinMiddlewares.rateLimit(5)]) 
  // automatically validates that the data sent through the remote matches
  // the data associated with the message at runtime using type guards
  .useShared(Message.Test, [BuiltinMiddlewares.validateClient()])
  .useClientGlobal([BuiltinMiddlewares.logClient()]);
  .useServerGlobal([BuiltinMiddlewares.logServer()]);

export const enum Message {
  Test
}

export interface MessageData {
  [Message.Test]: {
    readonly foo: string;
    readonly n: DataType.u8;
  };
}
```