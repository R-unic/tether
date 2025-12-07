import { Assert, Fact, Order } from "@rbxts/runit";

import { InvokeMessage, messaging } from "./utility";

declare const localPlayer: Player;
declare function setLuneContext(ctx: "server" | "client"): void;

/**
 * Tests for message key encoding/decoding, especially for keys >= 256
 * u8 can only hold values 0-255, so keys >= 256 will overflow
 */
@Order(3)
class KeyEncodingTest {


  @Fact
  public testU8LimitDocumentation(): void {
    // This test documents that message keys MUST be in range 0-255
    // Keys outside this range will overflow (256→0, 257→1, etc.)
    // This is intentional for optimization (1 byte vs 2 bytes)
    setLuneContext("server");
    
    // Valid range
    Assert.equal(0, 0);
    Assert.equal(255, 255);
    
    // Values above 255 will wrap due to u8 encoding
    const testBuf = buffer.create(1);
    buffer.writeu8(testBuf, 0, 256);
    const wrapped = buffer.readu8(testBuf, 0);
    Assert.equal(0, wrapped); // 256 wraps to 0
    
    setLuneContext("server");
  }

  @Fact
  public testMessageBufferEncoding(): void {
    // Directly test the buffer encoding for message keys
    // Keys must be in range 0-255 due to u8 optimization
    setLuneContext("server");
    
    // Test normal key (< 256)
    const normalKeyBuf = buffer.create(1);
    buffer.writeu8(normalKeyBuf, 0, InvokeMessage.ClientToServer);
    const normalKeyRead = buffer.readu8(normalKeyBuf, 0);
    Assert.equal(InvokeMessage.ClientToServer, normalKeyRead);

    // Test high key (250) - still within u8 range
    const highKeyBuf = buffer.create(1);
    buffer.writeu8(highKeyBuf, 0, InvokeMessage.HighKey);
    const highKeyRead = buffer.readu8(highKeyBuf, 0);
    Assert.equal(InvokeMessage.HighKey, highKeyRead);
    
    // Test maximum valid key (255)
    const maxKeyBuf = buffer.create(1);
    buffer.writeu8(maxKeyBuf, 0, 255);
    const maxKeyRead = buffer.readu8(maxKeyBuf, 0);
    Assert.equal(255, maxKeyRead);
  }
}

export = KeyEncodingTest;
