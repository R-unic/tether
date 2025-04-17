# Tether
A message-based networking solution for Roblox with automatic binary serialization and type validation.

> [!CAUTION]
> Depends on `rbxts-transformer-flamework`!

## Usage

### In `shared/messaging.ts`
```ts
import type { DataType } from "@rbxts/flamework-binary-serializer";
import { MessageEmitter } from "@rbxts/tether";

export const messaging = MessageEmitter.create<MessageData>();

export const enum Message {
  Test,
  Packed
}

export interface MessageData {
  [Message.Test]: {
    readonly foo: string;
    readonly n: DataType.u8;
  };
  [Message.Packed]: DataType.Packed<{
    boolean1: boolean;
    boolean2: boolean;
    boolean3: boolean;
    boolean4: boolean;
    boolean5: boolean;
    boolean6: boolean;
    boolean7: boolean;
    boolean8: boolean;
  }>;
}
```

> [!CAUTION]
> Every single message kind must implement an interface for it's data (in the example that would be the object with the `foo` and `bar` fields). Message serialization (as well as your message itself) will not work if you don't do this.

### Server
```ts
import { Message, messaging } from "shared/messaging";

messaging.server.on(Message.Test, (player, data) => {
  print(player, "sent data:", data);
});
```

### Client
```ts
import { Message, messaging } from "shared/messaging";

messaging.server.emit(Message.Test, {
  foo: "bar",
  n: 69
});
```

## Simulated Remote Functions
Tether does not directly use RemoteFunctions since it's based on the MessageEmitter structure. However I have created a small framework to simulate remote functions, as shown below.

For each function you will need two messages. One to invoke the function, and one to send the return value back (which is done automatically).

### In `shared/messaging.ts`
```ts
import type { DataType } from "@rbxts/flamework-binary-serializer";
import { MessageEmitter } from "@rbxts/tether";

export const messaging = MessageEmitter.create<MessageData>();

export const enum Message {
  Increment,
  IncrementReturn
}

export interface MessageData {
  [Message.Increment]: DataType.u8;
  [Message.IncrementReturn]: DataType.u8;
}
```

### Server
```ts
import { Message, messaging } from "shared/messaging";

messaging.server.setCallback(Message.Increment, Message.IncrementReturn, (_, n) => n + 1);
```

### Client
```ts
import { Message, messaging } from "shared/messaging";

messaging.server
  .invoke(Message.Increment, Message.IncrementReturn, 69)
  .then(print); // 70 - incremented by the server

// or use await style
async function main(): Promise<void> {
  const value = await messaging.server.invoke(Message.Increment, Message.IncrementReturn, 69);
  print(value) // 70
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
  return message => (player, data) => print(`[LOG]: Sent message '${message}' to player ${player} with data:`, data);
}
```

#### Server
```ts
import type { ServerMiddleware } from "@rbxts/tether";

export function logServer(): ServerMiddleware {
  return message => data => print(`[LOG]: Sent message '${message}' to server with data:`, data);
}
```

#### Shared
```ts
import { type SharedMiddleware, DropRequest } from "@rbxts/tether";

export function rateLimit(interval: number): SharedMiddleware {
  let lastRequest = 0;

  return message => // message attempting to be sent
    () => { // no data/player - it's a shared middleware
      if (os.clock() - lastRequest < interval)
        return DropRequest;

      lastRequest = os.clock();
    };
}
```

#### Transforming data
```ts
import type { ServerMiddleware } from "@rbxts/tether";

export function incrementNumberData(): ServerMiddleware<number> {
  // sets the data to be used by the any subsequent middlewares as well as sent through the remote
  return () => (data, updateData) => updateData(data + 1);
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
  .useServer(Message.Test, BuiltinMiddlewares.rateLimit(5)) 
  .useShared(Message.Packed, () => (_, __, getRawData) => print("Packed object size:", buffer.len(getRawData()))); // will be just one byte!
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
    readonly n: DataType.u8;
  };
  [Message.Packed]: DataType.Packed<{
    boolean1: boolean;
    boolean2: boolean;
    boolean3: boolean;
    boolean4: boolean;
    boolean5: boolean;
    boolean6: boolean;
    boolean7: boolean;
    boolean8: boolean;
  }>;
}
```