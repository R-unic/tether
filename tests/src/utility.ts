import { MessageEmitter } from "@rbxts/tether";
import type { u8, i16 } from "@rbxts/serio";

// declare function setLuneContext(ctx: "server" | "client" | "both"): void;

// setLuneContext("both");
export const messaging = MessageEmitter.create<TestMessageData>({ batchRemotes: false });

export const enum Message {
  ToServer,
  ToClient
}

export interface TestMessageData {
  [Message.ToServer]: u8 | i16;
  [Message.ToClient]: u8 | i16;
}