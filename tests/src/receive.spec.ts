import { Assert, Fact, Order } from "@rbxts/runit";
import { Message, messaging } from "./utility";

declare function setLuneContext(ctx: "server" | "client"): void;

const collectedFromServer: [Player, unknown][] = [];
setLuneContext("server");
messaging.server.on(Message.ToServer, (player, received) => {
  collectedFromServer.push([player, received]);
});

@Order(1)
class MessageReceiveTest {
  @Fact
  public async receivesFromClient(): Promise<void> {
    while (collectedFromServer.size() === 0)
      task.wait();

    const collected = collectedFromServer.shift();
    Assert.defined(collected);

    const [player, data] = collected!;
    Assert.defined(player)
    Assert.equal("Player", player.Name);
    Assert.equal(69, data);
  }
}

export = MessageReceiveTest;