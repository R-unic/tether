import { Assert, Fact, Order } from "@rbxts/runit";
import type { BaseMessage } from "@rbxts/tether/structs";

import { Message, messaging } from "./utility";

declare function setLuneContext(ctx: "server" | "client"): void;

function waitForCollected(collection: unknown[]): void {
  let i = 0;
  while (collection.size() === 0 && i < 1)
    i += task.wait();
}

function getCollectedMessage<T extends defined>(collection: T[], predicate: (data: T) => boolean): T {
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
messaging.client.on(Message.ToClient, received => collectedFromServer.push([Message.ToClient, received]));

setLuneContext("server");
messaging.server.on(Message.ToServer, (player, received) =>
  collectedFromClient.push([Message.ToServer, player, received]));

messaging.server.on(Message.ToServerWithMiddleware, (player, received) =>
  collectedFromClient.push([Message.ToServerWithMiddleware, player, received]));

messaging.server.on(Message.NoPayload, player =>
  collectedFromClient.push([Message.NoPayload, player, undefined]));

@Order(1)
class MessageReceiveTest {
  @Fact
  public async middlewareUpdatesData(): Promise<void> {
    const expectedValue = 69;
    const collected = getCollectedMessage(
      collectedFromClient,
      ([message, _, data]) => message === Message.ToServerWithMiddleware
    );

    const [_, player, data] = collected!;
    Assert.defined(player);
    Assert.equal("Player", player.Name);
    Assert.equal(expectedValue, data);
  }

  @Fact
  public async receivesFromClient(): Promise<void> {
    const expectedValue = 69;
    const collected = getCollectedMessage(
      collectedFromClient,
      ([message, _, data]) => message === Message.ToServer && data === expectedValue
    );

    const [_, player, data] = collected!;
    Assert.defined(player);
    Assert.equal("Player", player.Name);
    Assert.equal(expectedValue, data);
  }

  @Fact
  public async receivesUnreliableFromClient(): Promise<void> {
    const expectedValue = -420;
    const collected = getCollectedMessage(
      collectedFromClient,
      ([message, _, data]) => message === Message.ToServer
    );

    const [_, player, data] = collected!;
    Assert.defined(player);
    Assert.equal("Player", player.Name);
    Assert.equal(expectedValue, data);
  }

  @Fact
  public async receivesEmptyPayloadFromClient(): Promise<void> {
    const collected = getCollectedMessage(
      collectedFromClient,
      ([message]) => message === Message.NoPayload
    );

    const [_, player, data] = collected!;
    Assert.defined(player);
    Assert.equal("Player", player.Name);
    Assert.undefined(data);
  }

  @Fact
  public async receivesFromServer(): Promise<void> {
    const expectedValue = 69;
    const [_, data] = getCollectedMessage(
      collectedFromServer,
      ([message, data]) => message === Message.ToClient && data === expectedValue
    );

    Assert.equal(expectedValue, data);
  }

  @Fact
  public async receivesUnreliableFromServer(): Promise<void> {
    const expectedValue = -420;
    const [_, data] = getCollectedMessage(
      collectedFromServer,
      ([message, data]) => message === Message.ToClient && data === expectedValue
    );

    Assert.equal(expectedValue, data);
  }
}

export = MessageReceiveTest;