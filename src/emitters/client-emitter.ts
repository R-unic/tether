import { Players, RunService } from "@rbxts/services";

import { Error } from "../logging";
import { ContextualEmitter } from "./contextual-emitter";
import type { BaseMessage, ClientMessageCallback, ClientFunctionMessageCallback } from "../structs";

declare let setLuneContext: (ctx: "server" | "client" | "both") => void;
setLuneContext ??= () => { };

export class ClientEmitter<MessageData> extends ContextualEmitter<MessageData> {
  public readonly context = "client";

  declare readonly on: <K extends keyof MessageData>(
    this: ClientEmitter<MessageData>,
    message: K & BaseMessage,
    callback: ClientMessageCallback<MessageData[K]>
  ) => () => void;
  declare readonly once: <K extends keyof MessageData>(
    this: ClientEmitter<MessageData>,
    message: K & BaseMessage,
    callback: ClientMessageCallback<MessageData[K]>
  ) => () => void;

  /**
   * Emits a message to a specific client or multiple clients
   *
   * @param player The player(s) to whom the message is sent
   * @param message The message kind to be sent
   * @param data The data associated with the message
   * @param unreliable Whether the message should be sent unreliably
   */
  public emit<K extends keyof MessageData>(player: Player | Player[], message: K & BaseMessage, data?: MessageData[K], unreliable = false): void {
    if (RunService.IsClient())
      error(Error.NoClientToClient);

    task.spawn(() => {
      const [dropRequest, newData] = this.master.runClientSendMiddlewares(message, data, player);
      if (dropRequest) return;

      this.master.relayer.queueMessage(this.context, message, [player, message, newData, unreliable]);
    });
  }

  /**
   * Emits a message to all clients except the specified client(s)
   *
   * @param player The player(s) to whom the message is not sent
   * @param message The message kind to be sent
   * @param data The data associated with the message
   * @param unreliable Whether the message should be sent unreliably
   */
  public emitExcept<K extends keyof MessageData>(player: Player | Player[], message: K & BaseMessage, data?: MessageData[K], unreliable = false): void {
    const shouldSendTo = (p: Player) => typeIs(player, "Instance") ? p !== player : !player.includes(p);
    this.emit(Players.GetPlayers().filter(shouldSendTo), message, data, unreliable);
  }

  /**
 * Emits a message to all connected clients
 *
 * @param message The message kind to be sent
 * @param data The data associated with the message
 * @param unreliable Whether the message should be sent unreliably
 */
  public emitAll<K extends keyof MessageData>(message: K & BaseMessage, data?: MessageData[K], unreliable = false): void {
    if (RunService.IsClient())
      error(Error.NoClientToAllClients);

    task.spawn(() => {
      const [dropRequest, newData] = this.master.runClientSendMiddlewares(message, data);
      if (dropRequest) return;

      this.master.relayer.queueMessage(true, message, [message, newData, unreliable]);
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
    callback: ClientFunctionMessageCallback<MessageData[K], MessageData[R]>
  ): () => void {
    if (RunService.IsServer())
      error(Error.NoServerListen);

    return this.on(message, data => {
      const returnValue = callback(data);
      // Defer the response emission to end of frame and swap context to avoid context check issues
      // task.defer guarantees response is sent by end of current frame, ensuring predictable timing in production
      task.defer(() => {
        setLuneContext("client");
        this.master.server.emit(returnMessage, returnValue);
        setLuneContext("both");
      });
    });
  }

  /**
   * Simulates a remote function invocation
   *
   * @param message The message kind to be sent
   * @param returnMessage The message kind to be returned
   * @param player The player to whom the function is sent
   * @param data The data associated with the message
   * @param unreliable Whether the message should be sent unreliably
   */
  public invoke<K extends keyof MessageData, R extends keyof MessageData>(
    message: K & BaseMessage,
    returnMessage: R & BaseMessage,
    player: Player,
    data?: MessageData[K],
    unreliable = false
  ): Promise<MessageData[R]> {
    if (RunService.IsClient())
      error(Error.NoClientToClientFunction);

    const { serverFunctions } = this.master;
    if (!serverFunctions.has(returnMessage))
      serverFunctions.set(returnMessage, new Set);

    const functions = serverFunctions.get(returnMessage)!;
    let returnValue: MessageData[R] | undefined;
    const responseCallback = (data: unknown) => returnValue = data as never;
    functions.add(responseCallback);
    this.emit(player, message, data, unreliable);

    return new Promise((resolve, reject) => {
      // awful
      let frames = 0;
      while (returnValue === undefined && frames++ < 400)
        RunService.Heartbeat.Wait();

      if (frames === 400)
        return reject(Error.ClientFunctionTimeout);

      // clean up the callback after receiving the response
      functions.delete(responseCallback);
      resolve(returnValue as never);
    });
  }
}