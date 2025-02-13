# Tether
A message-based networking solution for Roblox with automatic binary serialization

### In `shared/messaging.ts`
```ts
import { DataType } from "@rbxts/flamework-binary-serializer";

export const messageEmitter = new MessageEmitter<Message, MessageData>;
messageEmitter.initialize();

export const enum Message {
  TEST
}

export interface MessageData {
  [Message.TEST]: {
    readonly foo: string;
    readonly n: DataType.u8;
  };
}

messageEmitter.addSerializer<Message.TOGGLE_MOVEMENT>(Message.TOGGLE_MOVEMENT);
```

> [!CAUTION]
> Every single message kind must implement an interface for it's data (in the example that would be the object with the `foo` and `bar` fields) as well as call `MessageEmitter.addSerializer()`. Messages will not work if you don't do this.

### Server
```ts
import { Message, messageEmitter } from "shared/messaging";

messageEmitter.onServerMessage(Message.TEST, (player, data) => {
  print(player, "sent data:", data);
});
```

### Client
```ts
import { Message, messageEmitter } from "shared/messaging";

messageEmitter.emitServer(Message.TEST, {
  foo: "bar",
  n: 69
});
```