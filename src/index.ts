import { Modding } from "@flamework/core";
import { Networking } from "@flamework/networking";
import { createBinarySerializer, type Serializer, type SerializerMetadata } from "@rbxts/flamework-binary-serializer";
import { RunService } from "@rbxts/services";

type ClientMessageCallback<T = unknown> = (data: T) => void;
type ServerMessageCallback<T = unknown> = (player: Player, data: T) => void;
type BaseMessage = number | string;

const GlobalEvents = Networking.createEvent<ServerEvents, ClientEvents>();
interface SerializedPacket {
	readonly buffer: buffer;
	readonly blobs: defined[];
}

type MessageEvent = (kind: BaseMessage, packet: SerializedPacket) => void;
type UnreliableMessageEvent = Networking.Unreliable<MessageEvent>;

interface ServerEvents {
	sendServerMessage: MessageEvent;
	sendUnreliableServerMessage: UnreliableMessageEvent;
}

interface ClientEvents {
	sendClientMessage: MessageEvent;
	sendUnreliableClientMessage: UnreliableMessageEvent;
}

export class MessageEmitter<Message extends BaseMessage, MessageData extends Record<Message, unknown>> {
	private readonly clientCallbacks = new Map<Message, ClientMessageCallback[]>;
	private readonly serverCallbacks = new Map<Message, ServerMessageCallback[]>;
	private readonly serializers: Partial<Record<Message, Serializer<MessageData[Message]>>> = {};
	private readonly serverEvents!: ReturnType<typeof GlobalEvents.createServer>;
	private readonly clientEvents!: ReturnType<typeof GlobalEvents.createClient>;

	public constructor() {
		if (RunService.IsServer())
			this.serverEvents = GlobalEvents.createServer({});
		else
			this.clientEvents = GlobalEvents.createClient({});
	}

	/** @metadata macro */
	public addSerializer<Kind extends Message>(message: Kind, meta?: Modding.Many<SerializerMetadata<MessageData[Kind]>>): void {
		this.serializers[message] = this.createMessageSerializer(meta) as unknown as Serializer<MessageData[Message]>;
	}

	public initialize(): RBXScriptConnection {
		if (RunService.IsClient())
			return this.clientEvents.sendClientMessage.connect((sentMessage, { buffer, blobs }) => {
				const messageCallbacks = this.clientCallbacks.get(sentMessage as Message) ?? [];
				if (messageCallbacks.size() === 0) return;

				const serializer = this.getSerializer(sentMessage as Message)
				const data = serializer.deserialize(buffer, blobs);
				for (const callback of messageCallbacks)
					callback(data);
			});
		else
			return this.serverEvents.sendServerMessage.connect((player, sentMessage, { buffer, blobs }) => {
				const messageCallbacks = this.serverCallbacks.get(sentMessage as Message) ?? [];
				if (messageCallbacks.size() === 0) return;

				const serializer = this.getSerializer(sentMessage as Message)
				const data = serializer.deserialize(buffer, blobs);
				for (const callback of messageCallbacks)
					callback(player, data);
			});
	}

	public onServerMessage<Kind extends Message>(message: Kind, callback: ServerMessageCallback<MessageData[Kind]>): () => void {
		if (!this.serverCallbacks.has(message))
			this.serverCallbacks.set(message, []);

		const callbacks = this.serverCallbacks.get(message)!;
		callbacks.push(callback as ClientMessageCallback);
		this.serverCallbacks.set(message, callbacks);
		return () => callbacks.remove(callbacks.indexOf(callback as ClientMessageCallback));
	}

	public onClientMessage<Kind extends Message>(message: Kind, callback: ClientMessageCallback<MessageData[Kind]>): () => void {
		if (!this.clientCallbacks.has(message))
			this.clientCallbacks.set(message, []);

		const callbacks = this.clientCallbacks.get(message)!;
		callbacks.push(callback as ClientMessageCallback);
		this.clientCallbacks.set(message, callbacks);
		return () => callbacks.remove(callbacks.indexOf(callback as ClientMessageCallback));
	}

	public emitServer<Kind extends Message>(message: Kind, data: MessageData[Kind], unreliable = false): void {
		const send = unreliable
			? this.clientEvents.sendUnreliableServerMessage
			: this.clientEvents.sendServerMessage;

		send(message, this.getPacket(message, data));
	}

	public emitClient<Kind extends Message>(player: Player, message: Kind, data: MessageData[Kind], unreliable = false): void {
		const send = unreliable
			? this.serverEvents.sendUnreliableClientMessage
			: this.serverEvents.sendClientMessage;

		send(player, message, this.getPacket(message, data));
	}

	public emitAllClients<Kind extends Message>(message: Kind, data: MessageData[Kind], unreliable = false): void {
		const send = unreliable ? this.serverEvents.sendUnreliableClientMessage : this.serverEvents.sendClientMessage;
		send.broadcast(message, this.getPacket(message, data));
	}

	private getPacket<Kind extends Message>(message: Kind, data: MessageData[Kind], unreliable = false): SerializedPacket {
		const serializer = this.getSerializer(message);
		return serializer.serialize(data);
	}

	/** @metadata macro */
	private createMessageSerializer<Kind extends Message>(meta?: Modding.Many<SerializerMetadata<MessageData[Kind]>>): Serializer<MessageData[Kind]> {
		return createBinarySerializer(meta);
	}

	private getSerializer<Kind extends Message>(message: Kind): Serializer<MessageData[Kind]> {
		return this.serializers[message] as unknown as Serializer<MessageData[Kind]>;
	}
}