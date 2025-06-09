import { Assert, Fact, Order } from "@rbxts/runit";
import { Message, messaging } from "./utility";

declare function setLuneContext(ctx: "server" | "client"): void;

function waitForCollected(collection: unknown[]): void {
  while (collection.size() === 0)
    task.wait();
}

function getCollectedMessage<T extends defined>(collection: T[], predicate: (data: T) => boolean): T {
  waitForCollected(collection);

  const index = collection.findIndex(predicate);
  Assert.notEqual(-1, index);

  const collected = collection.remove(index);
  Assert.defined(collected);

  return collected;
}

const collectedFromServer: defined[] = [];
const collectedFromClient: [Player, unknown][] = [];

setLuneContext("client");
messaging.client.on(Message.ToClient, received => collectedFromServer.push(received));

setLuneContext("server");
messaging.server.on(Message.ToServer, (player, received) => collectedFromClient.push([player, received]));

@Order(1)
class MessageReceiveTest {
  @Fact
  public async receivesFromClient(): Promise<void> {
    const expectedValue = 69;
    const collected = getCollectedMessage(collectedFromClient, ([_, data]) => data === expectedValue);
    const [player, data] = collected!;
    Assert.defined(player);
    Assert.equal("Player", player.Name);
    Assert.equal(expectedValue, data);
  }

  @Fact
  public async receivesUnreliableFromClient(): Promise<void> {
    const expectedValue = -420;
    const collected = getCollectedMessage(collectedFromClient, ([_, data]) => data === expectedValue);
    const [player, data] = collected!;
    Assert.defined(player);
    Assert.equal("Player", player.Name);
    Assert.equal(expectedValue, data);
  }

  @Fact
  public async receivesFromServer(): Promise<void> {
    const expectedValue = 69;
    const data = getCollectedMessage(collectedFromServer, data => data === expectedValue);
    Assert.equal(expectedValue, data);
  }

  @Fact
  public async receivesUnreliableFromServer(): Promise<void> {
    const expectedValue = -420;
    const data = getCollectedMessage(collectedFromServer, data => data === expectedValue);
    Assert.equal(expectedValue, data);
  }
}

export = MessageReceiveTest;