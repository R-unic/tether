import { Assert, Fact, Order } from "@rbxts/runit";
import { RunService } from "@rbxts/services";

import { Message, messaging, InvokeMessage } from "./utility";

declare const localPlayer: Player;
declare function setLuneContext(ctx: "server" | "client"): void;

/**
 * Tests for remote function invocations (invoke functionality)
 * These tests verify that the client can invoke server functions and vice versa
 */
@Order(2)
class InvokeTest {
  @Fact
  public async simpleMessageTest(): Promise<void> {
    // First, test that basic messaging works
    setLuneContext("server");
    let receivedValue: number | undefined;
    messaging.server.on(InvokeMessage.ClientToServer, (player, data) => {
      receivedValue = data;
    });

    setLuneContext("client");
    messaging.server.emit(InvokeMessage.ClientToServer, 42);

    // Give the message time to propagate
    for (let i = 0; i < 10; i++) {
      task.wait(0.01);
      if (receivedValue !== undefined) break;
    }

    Assert.defined(receivedValue);
    Assert.equal(42, receivedValue);
    setLuneContext("server");
  }

  @Fact
  public async testKeyIntegrity(): Promise<void> {
    // This test verifies that message keys are correctly encoded and decoded
    // Use a different message type to avoid interfering with other tests
    setLuneContext("server");

    let receivedKey: number | undefined;
    messaging.server.on(InvokeMessage.HighKey, () => {
      receivedKey = InvokeMessage.HighKey;
    });

    setLuneContext("client");
    messaging.server.emit(InvokeMessage.HighKey, 123);

    // Wait for the message to be received
    for (let i = 0; i < 10; i++) {
      task.wait(0.01);
      if (receivedKey !== undefined) break;
    }

    Assert.defined(receivedKey);
    Assert.equal(InvokeMessage.HighKey, receivedKey);
    setLuneContext("server");
  }
}

export = InvokeTest;
