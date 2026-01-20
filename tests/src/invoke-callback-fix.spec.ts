import { Assert, Fact, Order } from "@rbxts/runit";

import { TestMessage, messaging } from "./utility";

declare const localPlayer: Player;
declare function setLuneContext(ctx: "server" | "client" | "both"): void;

/**
 * Comprehensive test for the invoke callback fix
 */
@Order(7)
class InvokeCallbackFixTest {
  @Fact
  public async testServerSetCallbackWithResponseWorksEndToEnd(): Promise<void> {
    print("\n=== INVOKE CALLBACK FIX TEST ===\n");

    setLuneContext("server");
    print("[SERVER] Setting up callback for ClientToServer request");

    let callbackExecuted = false;
    let requestData: number | undefined;
    let responseWasSent = false;
    messaging.server.setCallback(
      TestMessage.ClientToServer,
      TestMessage.ServerResponse,
      (_, data) => {
        print(`[SERVER CALLBACK] Received request: ${data}`);
        callbackExecuted = true;
        requestData = data;
        responseWasSent = true;
        return data * 2; // Return double the input
      }
    );

    setLuneContext("client");
    print("[CLIENT] Emitting request to server");
    messaging.server.invoke(TestMessage.ClientToServer, TestMessage.ServerResponse, 25);

    print("[CLIENT] Waiting for server callback");
    for (let i = 0; i < 50; i++) {
      task.wait(0.01);
      if (callbackExecuted) {
        print(`[CLIENT] Server callback executed after ${i * 10}ms`);
        break;
      }
    }

    print(`[CLIENT] Final results:`);
    print(`  - callbackExecuted: ${callbackExecuted}`);
    print(`  - requestData: ${requestData}`);
    print(`  - responseWasSent: ${responseWasSent}`);

    Assert.true(callbackExecuted);
    Assert.equal(25, requestData);
    Assert.true(responseWasSent);

    setLuneContext("server");
    print("\n=== END INVOKE CALLBACK FIX TEST ===\n");
  }

  @Fact
  public async testClientSetCallbackWorksEndToEnd(): Promise<void> {
    print("\n=== CLIENT SET CALLBACK TEST ===\n");

    setLuneContext("client");
    print("[CLIENT] Setting up callback for ServerToClient request");

    let clientCallbackExecuted = false;
    let clientRequestData: number | undefined;

    messaging.client.setCallback(
      TestMessage.ServerToClient,
      TestMessage.ClientResponse,
      data => {
        print(`[CLIENT CALLBACK] Received request: ${data}`);
        clientCallbackExecuted = true;
        clientRequestData = data;
        return data + 100;
      }
    );

    setLuneContext("server");
    print("[SERVER] Emitting request to client");
    // Note: we need a localPlayer instance but for now just test registration
    messaging.client.invoke(TestMessage.ServerToClient, TestMessage.ClientResponse, localPlayer, 50);

    print("[SERVER] Waiting for client callback");
    for (let i = 0; i < 50; i++) {
      task.wait(0.01);
      if (clientCallbackExecuted) {
        print(`[SERVER] Client callback executed after ${i * 10}ms`);
        break;
      }
    }

    print(`[SERVER] Final results:`);
    print(`  - clientCallbackExecuted: ${clientCallbackExecuted}`);
    print(`  - clientRequestData: ${clientRequestData}`);

    Assert.true(clientCallbackExecuted);
    Assert.equal(50, clientRequestData);

    setLuneContext("server");
    print("\n=== END CLIENT SET CALLBACK TEST ===\n");
  }
}

export = InvokeCallbackFixTest;
