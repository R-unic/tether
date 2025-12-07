import { MessageEmitter } from "@rbxts/tether";
import type { u8, i16 } from "@rbxts/serio";

// declare function setLuneContext(ctx: "server" | "client" | "both"): void;

// setLuneContext("both");
export const messaging = MessageEmitter.create<TestMessageData>({ batchRemotes: false });

export const enum Message {
  ToServer,
  ToServerWithMiddleware,
  ToClient,
}

export const enum InvokeMessage {
  ClientToServer = 10,
  ServerResponse = 11,
  ServerToClient = 12,
  ClientResponse = 13,
  ClientToServerUnreliable = 14,
  ServerResponseUnreliable = 15,
  // Test message with high key value near u8 limit
  HighKey = 250,
  HighKeyResponse = 251,
}

export interface TestMessageData {
  [Message.ToServer]: i16;
  [Message.ToServerWithMiddleware]: u8;
  [Message.ToClient]: i16;
  [InvokeMessage.ClientToServer]: i16;
  [InvokeMessage.ServerResponse]: i16;
  [InvokeMessage.ServerToClient]: i16;
  [InvokeMessage.ClientResponse]: i16;
  [InvokeMessage.ClientToServerUnreliable]: i16;
  [InvokeMessage.ServerResponseUnreliable]: i16;
  [InvokeMessage.HighKey]: i16;
  [InvokeMessage.HighKeyResponse]: i16;
}
