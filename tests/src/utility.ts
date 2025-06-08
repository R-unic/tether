import { MessageEmitter } from "@rbxts/tether";
import type { u8 } from "@rbxts/serio";

export const messaging = MessageEmitter.create<TestMessageData>({ batchRemotes: false });

export const enum Message {
  ToServer
}

export interface TestMessageData {
  [Message.ToServer]: u8;
}