import { RunService } from "@rbxts/services";

import { Error } from "../logging";
import { ContextualEmitter } from "./contextual-emitter";
import type { BaseMessage, ServerMessageCallback, ServerFunctionMessageCallback } from "../structs";

declare let setLuneContext: (ctx: "server" | "client" | "both") => void;
setLuneContext ??= () => { };

export class ServerEmitter<MessageData> extends ContextualEmitter<MessageData> {
  public readonly context = "server";

  declare readonly on: <K extends keyof MessageData>(
    this: ServerEmitter<MessageData>,
    message: K & BaseMessage,
    callback: ServerMessageCallback<MessageData[K]>
  ) => () => void;
  declare readonly once: <K extends keyof MessageData>(
    this: ServerEmitter<MessageData>,
    message: K & BaseMessage,
    callback: ServerMessageCallback<MessageData[K]>
  ) => () => void;

  /**
   * Emits a message to the server
   *
   * @param message The message kind to be sent
   * @param data The data associated with the message
   * @param unreliable Whether the message should be sent unreliably
   */
  public emit<K extends keyof MessageData>(message: K & BaseMessage, data?: MessageData[K], unreliable = false): void {
    if (RunService.IsServer())
      error(Error.NoServerToServer);

    task.spawn(() => {
      const [dropRequest, newData] = this.master.runServerMiddlewares(message, data);
      if (dropRequest) return;

      this.master.relayer.queueMessage(this.context, message, [message, newData, unreliable]);
    });
  }

  /**
   * Sets a callback for a simulated remote function
   *
   * @returns A destructor function that disconnects the callback from the message
   */
  public setCallback<K extends keyof MessageData, R extends keyof MessageData>(
    message: K & BaseMessage,
    returnMessage: R & BaseMessage,
    callback: ServerFunctionMessageCallback<MessageData[K], MessageData[R]>
  ): () => void {
    if (RunService.IsClient())
      error(Error.NoClientListen);

    return this.on(message, (player, data) => {
      const returnValue = callback(player, data);
      // Defer the response emission to end of frame and swap context to avoid context check issues
      // task.defer guarantees response is sent by end of current frame, ensuring predictable timing in production
      task.defer(() => {
        setLuneContext("server");
        this.master.client.emit(player, returnMessage, returnValue);
        setLuneContext("both");
      });
    });
  }

  /**
   * Simulates a remote function invocation
   *
   * @param message The message kind to be sent
   * @param returnMessage The message kind to be returned
   * @param data The data associated with the message
   * @param unreliable Whether the message should be sent unreliably
   */
  public invoke<K extends keyof MessageData, R extends keyof MessageData>(
    message: K & BaseMessage,
    returnMessage: R & BaseMessage,
    data?: MessageData[K],
    unreliable = false
  ): Promise<MessageData[R]> {
    if (RunService.IsServer())
      error(Error.NoServerToServerFunction);

    const { clientFunctions } = this.master;
    if (!clientFunctions.has(returnMessage))
      clientFunctions.set(returnMessage, new Set);

    const functions = clientFunctions.get(returnMessage)!;
    let returnValue: MessageData[R] | undefined;
    const responseCallback = (data: unknown) => returnValue = data as never;
    functions.add(responseCallback);
    this.emit(message, data, unreliable);

    return new Promise((resolve, reject) => {
      // awful
      let frames = 0;
      while (returnValue === undefined && frames++ < 400)
        RunService.Heartbeat.Wait();

      if (frames === 400)
        return reject(Error.ServerFunctionTimeout);

      // clean up the callback after receiving the response
      functions.delete(responseCallback);
      resolve(returnValue as never);
    });
  }
}