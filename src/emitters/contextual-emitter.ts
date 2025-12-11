import type { MessageEmitter } from "./message-emitter";
import type { BaseMessage, MessageCallback, FunctionMessageCallback } from "../structs";
import { RunService } from "@rbxts/services";
import { Error } from "../logging";

type Cleanup = () => void;

export abstract class ContextualEmitter<MessageData> {
  public abstract readonly context: "client" | "server";

  /**
   * Constructs a new ContextualEmitter.
   * @param master The master emitter to which messages are delegated.
   */
  public constructor(
    protected readonly master: MessageEmitter<MessageData>
  ) { }

  public abstract emit<K extends keyof MessageData>(player: (K & BaseMessage) | (Player | Player[]), message?: MessageData[K] | (K & BaseMessage), data?: MessageData[K] | boolean, unreliable?: boolean): void;
  public abstract setCallback<K extends keyof MessageData, R extends keyof MessageData>(
    message: K & BaseMessage,
    returnMessage: R & BaseMessage,
    callback: FunctionMessageCallback<MessageData[K], MessageData[R]>
  ): Cleanup;
  public abstract invoke<K extends keyof MessageData, R extends keyof MessageData>(
    message: K & BaseMessage,
    returnMessage: R & BaseMessage,
    player?: Player | MessageData[K],
    data?: MessageData[K] | boolean,
    unreliable?: boolean
  ): Promise<MessageData[R]>;

  /**
   * @returns A destructor function that disconnects the callback from the message
   */
  public on<K extends keyof MessageData>(
    message: K & BaseMessage,
    callback: MessageCallback<MessageData[K]>
  ): Cleanup {
    const isClient = this.context === "client";
    if (RunService.IsClient() && !isClient)
      return error(Error.NoServerListen);
    else if (RunService.IsServer() && isClient)
      return error(Error.NoClientListen);

    const callbacksMap = isClient ? this.master.clientCallbacks : this.master.serverCallbacks;
    if (!callbacksMap.has(message))
      callbacksMap.set(message, new Set);

    const callbacks: Set<MessageCallback> = callbacksMap.get(message)!;
    callbacks.add(callback as MessageCallback);
    callbacksMap.set(message, callbacks);
    return () => callbacks.delete(callback as MessageCallback);
  }

  /**
   * Disconnects the callback as soon as it is called for the first time
   *
   * @returns A destructor function that disconnects the callback from the message
   */
  public once<K extends keyof MessageData>(
    message: K & BaseMessage,
    callback: MessageCallback<MessageData[K]>
  ): Cleanup {
    const destructor = this.on(message, (player, data) => {
      destructor();
      (callback as MessageCallback)(player, data);
    });

    return destructor;
  }
}