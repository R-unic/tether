import { Fact } from "@rbxts/runit";

import { Message, messaging } from "../utility";

class MessageEmitterClientTest {
  @Fact
  public emitsToServer(): void {
    messaging.server.emit(Message.ToServer, 69);
  }
}

export = MessageEmitterClientTest;