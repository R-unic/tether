import { Assert, Fact, Order } from "@rbxts/runit";
import type { SharedMiddleware } from "@rbxts/tether";

import { Message, messaging, TestMessageData } from "./utility";

declare const localPlayer: Player;
declare function setLuneContext(ctx: "server" | "client"): void;

@Order(0)
class MessageSendTest {
  @Fact
  public middlewareUpdatesData(): void {
    const value = 70;
    setLuneContext("client");
    messaging.middleware.useServer(
      Message.ToServerWithMiddleware,
      (ctx => {
        Assert.equal(value, ctx.data);
        Assert.equal(Message.ToServerWithMiddleware, ctx.message);

        const { messageBuf, buf, blobs } = ctx.getRawData();
        Assert.defined(buf);
        Assert.undefined(blobs);
        Assert.equal(1, buffer.len(messageBuf));
        Assert.equal(1, buffer.len(buf));
        Assert.equal(value - 1, --ctx.data);
      }) as SharedMiddleware<TestMessageData[Message.ToServer]>,
    );
    Assert.doesNotThrow(() => messaging.server.emit(Message.ToServerWithMiddleware, value));
    setLuneContext("server");
  }

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

  @Fact
  public sendsToClient(): void {
    setLuneContext("server");
    Assert.doesNotThrow(() => messaging.client.emit(localPlayer, Message.ToClient, 69));
    setLuneContext("client");
  }

  @Fact
  public sendsUnreliableToClient(): void {
    setLuneContext("server");
    Assert.doesNotThrow(() => messaging.client.emit(localPlayer, Message.ToClient, -420, true));
    setLuneContext("client");
  }
}

export = MessageSendTest;