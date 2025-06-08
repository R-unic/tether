import { Assert, Fact } from "@rbxts/runit";

import { Message, messaging } from "./utility";

declare const newproxy: (mt?: boolean) => symbol;

const UNRECEIVED = newproxy();

class MessageEmitterTest {
  @Fact
  public async receivesFromClient(): Promise<void> {
    return new Promise(resolve => {
      let data: unknown = UNRECEIVED;
      messaging.server.on(Message.ToServer, (_, received) => data = received);

      resolve(); // we're listening, now resolve the promise and move on to the test which calls .emit()
      while (data === UNRECEIVED)
        task.wait();

      Assert.equal(69, data);
    });
  }

  @Fact
  public sendsToServer(): void {
    messaging.server.emit(Message.ToServer, 69);
  }
}

export = MessageEmitterTest;