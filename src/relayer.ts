import { ReplicatedStorage, RunService } from "@rbxts/services";

import { getAllPacketsWhich, isReliable, isUnreliable, shouldBatch } from "\./utility";
import type { BaseMessage, MessageEvent, PacketInfo, SerializedPacket } from "./structs";
import type { MessageEmitter } from "./emitters/message-emitter";

export type ServerQueuedMessageData<MessageData> = [keyof MessageData & BaseMessage, MessageData[keyof MessageData], boolean];
export type ClientQueuedMessageData<MessageData> = [Player | Player[], ...ServerQueuedMessageData<MessageData>];
export type QueuedMessageData<MessageData> = ClientQueuedMessageData<MessageData> | ServerQueuedMessageData<MessageData>;

declare let setLuneContext: (ctx: "server" | "client" | "both") => void;
setLuneContext ??= () => { };

let sendMessage: RemoteEvent<MessageEvent>;
{
  const name = "sendMessage";
  const existing = ReplicatedStorage.FindFirstChild(name);
  const remote = (existing ?? new Instance("RemoteEvent", ReplicatedStorage)) as RemoteEvent<MessageEvent>;
  if (existing === undefined)
    remote.Name = name;

  sendMessage = remote;
}
let sendUnreliableMessage: UnreliableRemoteEvent<MessageEvent>;
{
  const name = "sendUnreliableMessage";
  const existing = ReplicatedStorage.FindFirstChild(name);
  const remote = (existing ?? new Instance("UnreliableRemoteEvent", ReplicatedStorage)) as UnreliableRemoteEvent<MessageEvent>;
  if (existing === undefined)
    remote.Name = name;

  sendUnreliableMessage = remote;
}

export class Relayer<MessageData> {
  private serverQueue: ServerQueuedMessageData<MessageData>[] = [];
  private clientBroadcastQueue: ServerQueuedMessageData<MessageData>[] = [];
  private clientQueue: ClientQueuedMessageData<MessageData>[] = [];

  public constructor(
    private readonly emitter: MessageEmitter<MessageData>
  ) {
    setLuneContext("client");
    if (RunService.IsClient()) {
      this.emitter.trash.add(sendMessage.OnClientEvent.Connect(
        (...serializedPacket) => this.emitter.onRemoteFire(false, serializedPacket))
      );
      this.emitter.trash.add(sendUnreliableMessage.OnClientEvent.Connect(
        (...serializedPacket) => this.emitter.onRemoteFire(false, serializedPacket))
      );
    }

    setLuneContext("server");
    if (RunService.IsServer()) {
      this.emitter.trash.add(sendMessage.OnServerEvent.Connect(
        (player, ...serializedPacket) => this.emitter.onRemoteFire(true, serializedPacket as never, player))
      );
      this.emitter.trash.add(sendUnreliableMessage.OnServerEvent.Connect(
        (player, ...serializedPacket) => this.emitter.onRemoteFire(true, serializedPacket as never, player))
      );
    }

    let elapsed = 0;
    const { batchRemotes, batchRate } = this.emitter.options;
    if (!batchRemotes)
      return this;

    this.emitter.trash.add(RunService.Heartbeat.Connect(dt => {
      elapsed += dt;
      if (elapsed < batchRate) return;

      elapsed -= batchRate;
      this.relayAll();
    }));
  }

  public queueMessage<K extends keyof MessageData>(
    context: "client" | "server" | true,
    message: K & BaseMessage,
    data: QueuedMessageData<MessageData>
  ): void {
    const queue = context === "client"
      ? this.clientQueue
      : context === true
        ? this.clientBroadcastQueue
        : this.serverQueue;

    queue.push(data as never);
    if (!shouldBatch(message, this.emitter.options))
      this.relayAll();
  }

  /** Send all queued data across the network simultaneously */
  public relayAll(): void {
    if (RunService.IsClient())
      return this.relay(
        (...packets) => sendMessage.FireServer(...packets),
        (...packets) => sendUnreliableMessage.FireServer(...packets),
        this.serverQueue,
        () => this.serverQueue = []
      );

    this.relay(
      (...packets) => sendMessage.FireAllClients(...packets),
      (...packets) => sendUnreliableMessage.FireAllClients(...packets),
      this.clientBroadcastQueue,
      () => this.clientBroadcastQueue = []
    );

    const playerPacketInfos = new Map<Player, PacketInfo[]>;
    const addClientPacket = (player: Player, packetInfo: PacketInfo): void => {
      const packetInfos = playerPacketInfos.get(player) ?? [];
      packetInfos.push(packetInfo);
      playerPacketInfos.set(player, packetInfos);
    };

    for (const [player, message, data, unreliable] of this.clientQueue) {
      const packet = this.emitter.serdes.serializePacket(message, data);
      const info = { packet, unreliable };
      if (typeIs(player, "Instance"))
        addClientPacket(player, info);
      else
        for (const p of player)
          addClientPacket(p, info);
    }

    if (!this.clientQueue.isEmpty()) {
      for (const [player, packetInfos] of playerPacketInfos) {
        if (packetInfos.isEmpty()) continue;

        const unreliablePackets = getAllPacketsWhich(packetInfos, isUnreliable);
        const packets = getAllPacketsWhich(packetInfos, isReliable);
        if (!unreliablePackets.isEmpty())
          sendUnreliableMessage.FireClient(player, ...unreliablePackets);
        if (!packets.isEmpty())
          sendMessage.FireClient(player, ...packets);
      }

      this.clientQueue = [];
    }
  }

  private relay(send: MessageEvent, sendUnreliable: MessageEvent, queue: QueuedMessageData<MessageData>[], clearQueue: () => void): void {
    if (queue.isEmpty()) return;

    const packetInfos = queue.map<PacketInfo>(messageData => {
      let message: keyof MessageData & BaseMessage,
        data: MessageData[keyof MessageData],
        unreliable: boolean;

      if (typeIs(messageData[0], "Instance"))
        [, message, data, unreliable] = messageData as ClientQueuedMessageData<MessageData>;
      else
        [message, data, unreliable] = messageData as ServerQueuedMessageData<MessageData>;

      const packet = this.emitter.serdes.serializePacket(message, data);
      return { packet, unreliable };
    });

    const unreliablePackets = getAllPacketsWhich(packetInfos, isUnreliable);
    const packets = getAllPacketsWhich(packetInfos, isReliable);
    if (!unreliablePackets.isEmpty())
      sendUnreliable(...unreliablePackets);
    if (!packets.isEmpty())
      send(...packets);

    clearQueue();
  }
}