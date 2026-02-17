import { Assert, Fact } from "@rbxts/runit"
import { MessageEmitter } from "@rbxts/tether"
import type { i16 } from "@rbxts/serio"

class MiscTest {
  @Fact
  public getSchema(): void {
    const emitter = MessageEmitter.create<{ [0]: i16 }>();
    const schema = emitter.getSchema(0);
    Assert.single(schema);
    Assert.isCheckableType(schema[0], "string");
    Assert.equal("i16", schema[0]);
  }
}

export = MiscTest