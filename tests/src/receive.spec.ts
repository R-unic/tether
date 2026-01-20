import { Assert, Fact, Order } from "@rbxts/runit";
import type { BaseMessage } from "@rbxts/tether/structs";

import { TestMessage, messaging } from "./utility";

declare function setLuneContext(ctx: "server" | "client"): void;

function waitForCollected(collection: unknown[]): void {
  let i = 0;
  while (collection.size() === 0 && i < 1)
    i += task.wait(0.2);
}

function waitForCollectedMessage<T extends defined>(collection: T[], predicate: (data: T) => boolean): T {
  waitForCollected(collection);
  Assert.notEmpty(collection);

  const index = collection.findIndex(predicate);
  Assert.notEqual(-1, index);

  const collected = collection.remove(index);
  Assert.defined(collected);

  return collected;
}

const collectedFromServer: [BaseMessage, unknown][] = [];
const collectedFromClient: [BaseMessage, Player, unknown][] = [];

setLuneContext("client");
messaging.client.on(TestMessage.ToClient, received => collectedFromServer.push([TestMessage.ToClient, received]));

setLuneContext("server");
messaging.server.on(TestMessage.ToServer, (player, received) =>
  collectedFromClient.push([TestMessage.ToServer, player, received]));

messaging.server.on(TestMessage.ToServerWithMiddleware, (player, received) =>
  collectedFromClient.push([TestMessage.ToServerWithMiddleware, player, received]));

messaging.server.on(TestMessage.NoPayload, player =>
  collectedFromClient.push([TestMessage.NoPayload, player, undefined]));

@Order(1)
class MessageReceiveTest {
  @Fact
  public async middlewareUpdatesData(): Promise<void> {
    const expectedValue = 69;
    const collected = waitForCollectedMessage(
      collectedFromClient,
      ([message, _, data]) => message === TestMessage.ToServerWithMiddleware && data === expectedValue
    );

    const [_, player, data] = collected!;
    Assert.defined(player);
    Assert.equal("Player", player.Name);
    Assert.equal(expectedValue, data);
  }

  @Fact
  public async receivesFromClient(): Promise<void> {
    const expectedValue = 69;
    const collected = waitForCollectedMessage(
      collectedFromClient,
      ([message, _, data]) => message === TestMessage.ToServer && data === expectedValue
    );

    const [_, player, data] = collected!;
    Assert.defined(player);
    Assert.equal("Player", player.Name);
    Assert.equal(expectedValue, data);
  }

  @Fact
  public async receivesUnreliableFromClient(): Promise<void> {
    const expectedValue = -420;
    const collected = waitForCollectedMessage(
      collectedFromClient,
      ([message, _, data]) => message === TestMessage.ToServer && data === expectedValue
    );

    const [_, player, data] = collected!;
    Assert.defined(player);
    Assert.equal("Player", player.Name);
    Assert.equal(expectedValue, data);
  }

  @Fact
  public async receivesEmptyPayloadFromClient(): Promise<void> {
    const collected = waitForCollectedMessage(
      collectedFromClient,
      ([message]) => message === TestMessage.NoPayload
    );

    const [_, player, data] = collected!;
    Assert.defined(player);
    Assert.equal("Player", player.Name);
    Assert.undefined(data);
  }

  @Fact
  public async receivesFromServer(): Promise<void> {
    const expectedValue = 69;
    const [_, data] = waitForCollectedMessage(
      collectedFromServer,
      ([message, data]) => message === TestMessage.ToClient && data === expectedValue
    );

    Assert.equal(expectedValue, data);
  }

  @Fact
  public async receivesUnreliableFromServer(): Promise<void> {
    const expectedValue = -420;
    const [_, data] = waitForCollectedMessage(
      collectedFromServer,
      ([message, data]) => message === TestMessage.ToClient && data === expectedValue
    );

    Assert.equal(expectedValue, data);
  }
}

export = MessageReceiveTest;