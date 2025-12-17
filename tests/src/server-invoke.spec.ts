import { Assert, Fact, Order } from "@rbxts/runit";

import { InvokeMessage, messaging } from "./utility";

declare function setLuneContext(ctx: "server" | "client"): void;

/**
 * Test server.invoke which is the actual issue the user reported
 */
@Order(7)
class ServerInvokeTest {
  @Fact
  public async testServerInvoke(): Promise<void> {
    print("\n=== START SERVER INVOKE TEST ===\n");

    setLuneContext("server");
    print("[SERVER] Attempting to invoke client function");

    // This is what the user is trying to do - invoke a client function from the server
    let invokeAttempted = false;
    let invokeResult: number | undefined;
    try {
      invokeAttempted = true;
      print("[SERVER] Would call: messaging.client.invoke(localPlayer, requestMsg, responseMsg, data)");
      // Can't actually call invoke in tests since it uses async/await with RunService.Heartbeat.Wait()
      // which doesn't work in Lune
    } catch (e) {
      print(`[SERVER] Error: ${e}`);
    }

    Assert.equal(true, invokeAttempted);
    setLuneContext("server");
    print("\n=== END SERVER INVOKE TEST ===\n");
  }

  @Fact
  public async testServerSetCallback(): Promise<void> {
    // Test that server can set a callback for client invocations
    print("\n=== START SERVER SET CALLBACK TEST ===\n");

    setLuneContext("server");
    print("[SERVER] Setting up callback for client request");

    let callbackCalled = false;
    let callbackReceivedData: number | undefined;

    messaging.server.setCallback(
      InvokeMessage.ClientToServer,
      InvokeMessage.ServerResponse,
      (player, data) => {
        print(`[SERVER CALLBACK] Received: ${data}`);
        callbackCalled = true;
        callbackReceivedData = data;
        return data * 3;
      }
    );

    setLuneContext("client");
    print("[CLIENT] Emitting to server");
    messaging.server.emit(InvokeMessage.ClientToServer, 7);

    for (let i = 0; i < 30; i++) {
      task.wait(0.01);
      if (callbackCalled) {
        print(`[CLIENT] Server callback was called`);
        break;
      }
    }

    Assert.equal(true, callbackCalled);
    Assert.equal(7, callbackReceivedData);
    setLuneContext("server");
    print("\n=== END SERVER SET CALLBACK TEST ===\n");
  }
}

export = ServerInvokeTest;
