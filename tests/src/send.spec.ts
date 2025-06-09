import { Assert, Fact, Order } from "@rbxts/runit";

import { Message, messaging } from "./utility";

declare function setLuneContext(ctx: "server" | "client"): void;

@Order(0)
class MessageSendTest {
  @Fact
  public sendsToServer(): void {
    setLuneContext("client");
    Assert.doesNotThrow(() => messaging.server.emit(Message.ToServer, 69));
    setLuneContext("server");
  }

  @Fact
  public sendsUnreliableToServer(): void {
    setLuneContext("client");
    Assert.doesNotThrow(() => messaging.server.emit(Message.ToServer, -420, true));
    setLuneContext("server");
  }
}

export = MessageSendTest;