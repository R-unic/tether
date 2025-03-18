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

messaging.onServerMessage(Message.TEST, (player, data) => {
  print(player, "sent data:", data);
});
```

### Client
```ts
import { Message, messaging } from "shared/messaging";

messaging.emitServer(Message.TEST, {
  foo: "bar",
  n: 69
});
```

## Middleware

### Creating middleware
```ts
import { type Middleware, DropRequest } from "@rbxts/tether";

export function rateLimit(interval: number): Middleware {
  let lastRequest = 0;

  return () => {
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
  .useUniversal(Message.Test, [BuiltinMiddlewares.rateLimit(5)])
  .useClient(Message.Test, [BuiltinMiddlewares.validateClient()]);

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