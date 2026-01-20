import { Assert, Fact, Order } from "@rbxts/runit";
import type { SharedMiddleware } from "@rbxts/tether";

import { TestMessage, messaging, TestMessageData } from "./utility";

declare const localPlayer: Player;
declare function setLuneContext(ctx: "server" | "client"): void;

@Order(0)
class MessageSendTest {
  @Fact
  public middlewareUpdatesData(): void {
    const value = 70;
    setLuneContext("client");
    const middleware = (ctx => {
      Assert.equal(value, ctx.data);
      Assert.equal(TestMessage.ToServerWithMiddleware, ctx.message);

      const { messageBuf, buf, blobs } = ctx.getRawData();
      Assert.defined(buf);
      Assert.undefined(blobs);
      Assert.equal(1, buffer.len(messageBuf));
      Assert.equal(1, buffer.len(buf));
      Assert.equal(value, ctx.data--);
    }) as SharedMiddleware<TestMessageData[TestMessage.ToServer]>;

    messaging.middleware.useServer(TestMessage.ToServerWithMiddleware, middleware);
    Assert.doesNotThrow(() => messaging.server.emit(TestMessage.ToServerWithMiddleware, value));
    messaging.middleware.deleteServer(TestMessage.ToServerWithMiddleware, middleware);
    setLuneContext("server");
  }

  @Fact
  public sendsToServer(): void {
    setLuneContext("client");
    Assert.doesNotThrow(() => messaging.server.emit(TestMessage.ToServer, 69));
    setLuneContext("server");
  }

  @Fact
  public sendsUnreliableToServer(): void {
    setLuneContext("client");
    Assert.doesNotThrow(() => messaging.server.emit(TestMessage.ToServer, -420, true));
    setLuneContext("server");
  }

  @Fact
  public sendsEmptyPayloadToServer(): void {
    setLuneContext("client");
    Assert.doesNotThrow(() => messaging.server.emit(TestMessage.NoPayload));
    setLuneContext("server");
  }

  @Fact
  public sendsToClient(): void {
    setLuneContext("server");
    Assert.doesNotThrow(() => messaging.client.emit(localPlayer, TestMessage.ToClient, 69));
    setLuneContext("client");
  }

  @Fact
  public sendsUnreliableToClient(): void {
    setLuneContext("server");
    Assert.doesNotThrow(() => messaging.client.emit(localPlayer, TestMessage.ToClient, -420, true));
    setLuneContext("client");
  }
}

export = MessageSendTest;