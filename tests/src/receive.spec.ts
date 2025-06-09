import { Assert, Fact, Order } from "@rbxts/runit";
import { Message, messaging } from "./utility";

declare function setLuneContext(ctx: "server" | "client"): void;

function waitForCollectedServerMessage(): void {
  while (collectedFromServer.size() === 0)
    task.wait();
}

function getCollectedServerMessage(predicate: (data: unknown) => boolean): [Player, unknown] {
  waitForCollectedServerMessage();

  const index = collectedFromServer.findIndex(([_, data]) => predicate(data));
  Assert.notEqual(-1, index);

  const collected = collectedFromServer.remove(index);
  Assert.defined(collected);

  return collected;
}

const collectedFromServer: [Player, unknown][] = [];
setLuneContext("server");
messaging.server.on(Message.ToServer, (player, received) =>
  collectedFromServer.push([player, received])
);

@Order(1)
class MessageReceiveTest {
  @Fact
  public async receivesFromClient(): Promise<void> {
    const expectedValue = 69;
    const collected = getCollectedServerMessage(data => data === expectedValue);
    const [player, data] = collected!;
    Assert.defined(player)
    Assert.equal("Player", player.Name);
    Assert.equal(expectedValue, data);
  }

  @Fact
  public async receivesUnreliableFromClient(): Promise<void> {
    const expectedValue = -420;
    const collected = getCollectedServerMessage(data => data === expectedValue);
    const [player, data] = collected!;
    Assert.defined(player)
    Assert.equal("Player", player.Name);
    Assert.equal(expectedValue, data);
  }
}

export = MessageReceiveTest;