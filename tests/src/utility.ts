import { MessageEmitter } from "@rbxts/tether";
import type { u8, i16 } from "@rbxts/serio";

export const messaging = MessageEmitter.create<TestMessageData>({ batchRemotes: false });

export const enum TestMessage {
  ToServer,
  ToServerWithMiddleware,
  ToClient,
  NoPayload,
  ClientToServer,
  ServerResponse,
  ServerToClient,
  ClientResponse,
  ClientToServerUnreliable,
  ServerResponseUnreliable,
  // Test message with high key value near u8 limit
  HighKey = 250,
  HighKeyResponse = 251,
}

export interface TestMessageData {
  [TestMessage.ToServer]: i16;
  [TestMessage.ToServerWithMiddleware]: u8;
  [TestMessage.ToClient]: i16;
  [TestMessage.NoPayload]: undefined;
  [TestMessage.ClientToServer]: i16;
  [TestMessage.ServerResponse]: i16;
  [TestMessage.ServerToClient]: i16;
  [TestMessage.ClientResponse]: i16;
  [TestMessage.ClientToServerUnreliable]: i16;
  [TestMessage.ServerResponseUnreliable]: i16;
  [TestMessage.HighKey]: i16;
  [TestMessage.HighKeyResponse]: i16;
}