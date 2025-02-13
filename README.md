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