# Tether

A message-based networking solution for Roblox with automatic binary serialization and type validation.

This package uses [Serio](https://www.npmjs.com/package/@rbxts/serio) for binary serialization, so to find more info on schemas, check it out!

> [!CAUTION]
> Depends on `rbxts-transformer-flamework`!

## Usage

### In `shared/messaging.ts`

```ts
import { MessageEmitter } from "@rbxts/tether";
import type { Packed, u8 } from "@rbxts/serio";

export const messaging = MessageEmitter.create<MessageData>();

export const enum Message {
  Test,
  Packed,
}

export interface MessageData {
  [Message.Test]: {
    readonly foo: string;
    readonly n: u8;
  };
  [Message.Packed]: Packed<{
    readonly boolean1: boolean;
    readonly boolean2: boolean;
    readonly boolean3: boolean;
    readonly boolean4: boolean;
    readonly boolean5: boolean;
    readonly boolean6: boolean;
    readonly boolean7: boolean;
    readonly boolean8: boolean;
  }>;
}
```

> [!CAUTION]
> Every single message kind must implement an interface for it's data (in the example that would be the object types in `MessageData`). Message serialization (as well as your message itself) will not work if you don't do this.

### Server

```ts
import { Message, messaging } from "shared/messaging";

messaging.server.on(Message.Test, (player, data) =>
  print(player, "sent data:", data)
);
```

### Client

```ts
import { Message, messaging } from "shared/messaging";

messaging.server.emit(Message.Test, {
  foo: "bar",
  n: 69,
});
```

## Simulated Remote Functions

Tether does not directly use RemoteFunctions since it's based on the MessageEmitter structure. However I have created a small framework to simulate remote functions, as shown below.

For each function you will need two messages. One to invoke the function, and one to send the return value back (which is done automatically).

### In `shared/messaging.ts`

```ts
import { MessageEmitter } from "@rbxts/tether";
import type { u8 } from "@rbxts/serio";

export const messaging = MessageEmitter.create<MessageData>();

export const enum Message {
  Increment,
  IncrementReturn,
}

export interface MessageData {
  [Message.Increment]: u8;
  [Message.IncrementReturn]: u8;
}
```

### Server

```ts
import { Message, messaging } from "shared/messaging";

messaging.server.setCallback(
  Message.Increment,
  Message.IncrementReturn,
  (_, n) => n + 1
);
```

### Client

```ts
import { Message, messaging } from "shared/messaging";

messaging.server
  .invoke(Message.Increment, Message.IncrementReturn, 69)
  .then(print); // 70 - incremented by the server

// or use await style
async function main(): Promise<void> {
  const value = await messaging.server.invoke(
    Message.Increment,
    Message.IncrementReturn,
    69
  );
  print(value); // 70
}

main();
```

## Middleware

Drop, delay, or modify requests

### Creating middleware

**Note:** These client/server middlewares can be implemented as shared middlewares. This is strictly an example.

#### Client

```ts
import type { ClientMiddleware } from "@rbxts/tether";

export function logClient(): ClientMiddleware {
  return (player, ctx) =>
    print(
      `[LOG]: Sent message '${ctx.message}' to player ${player} with data:`,
      ctx.data
    );
}
```

#### Server

```ts
import type { ServerMiddleware } from "@rbxts/tether";

export function logServer(): ServerMiddleware {
  return (ctx) =>
    print(
      `[LOG]: Sent message '${ctx.message}' to server with data:`,
      ctx.data
    );
}
```

#### Shared

```ts
import { type SharedMiddleware, DropRequest } from "@rbxts/tether";

export function rateLimit(interval: number): SharedMiddleware {
  let lastRequest = 0;

  return () => {
    if (os.clock() - lastRequest < interval) return DropRequest;

    lastRequest = os.clock();
  };
}
```

#### Transforming data

```ts
import type { ServerMiddleware } from "@rbxts/tether";

export function incrementNumberData(): ServerMiddleware<number> {
  // sets the data to be used by the any subsequent middlewares as well as sent through the remote
  return ({ data, updateData }) => updateData(data + 1);
}
```

### Using middleware

```ts
import { MessageEmitter, BuiltinMiddlewares } from "@rbxts/tether";
import type { Packed, u8 } from "@rbxts/serio";

export const messaging = MessageEmitter.create<MessageData>();
messaging.middleware
  // only allows requests to the server every 5 seconds,
  // drops any requests that occur within 5 seconds of each other
  .useServer(Message.Test, BuiltinMiddlewares.rateLimit(5))
  // will be just one byte!
  .useShared(Message.Packed, ctx => print("Packed object size:", buffer.len(ctx.getRawData().buffer)));
  // logs every message fired
  .useServerGlobal(logServer())
  .useClientGlobal(logClient())
  .useSharedGlobal(BuiltinMiddlewares.debug()); // verbosely logs every packet sent
  .useServer(Message.Test, incrementNumberData()) // error! - data for Message.Test is not a number
  .useServerGlobal(incrementNumberData()); // error! - global data type is always 'unknown', we cannot guarantee a number

export const enum Message {
  Test,
  Packed
}

export interface MessageData {
  [Message.Test]: {
    readonly foo: string;
    readonly n: u8;
  };
  [Message.Packed]: Packed<{
    readonly boolean1: boolean;
    readonly boolean2: boolean;
    readonly boolean3: boolean;
    readonly boolean4: boolean;
    readonly boolean5: boolean;
    readonly boolean6: boolean;
    readonly boolean7: boolean;
    readonly boolean8: boolean;
  }>;
}
```
