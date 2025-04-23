import { Modding } from "@flamework/core";
import { RunService } from "@rbxts/services";
import { repeatString } from "@rbxts/flamework-meta-utils";
import type { SerializerMetadata } from "@rbxts/flamework-binary-serializer";
import repr from "@rbxts/repr";

import { DropRequest, type SharedMiddleware } from "./middleware";
import type { TetherPacket } from "./structs";
import { Any } from "ts-toolbelt";

const BLOB_SIZE = 5; // bytes

export namespace BuiltinMiddlewares {
  /**
   * Creates a shared middleware that will simulate a ping of the given amount when a message is sent
   *
   * @param pingInMs The amount of time in milliseconds that the middleware should wait
   * @returns A shared middleware that will simulate a ping
   */
  export function simulatePing(pingInMs: number): SharedMiddleware {
    return () => () => void task.wait(pingInMs / 1000);
  }

  /**
   * Creates a shared middleware that will check if a message packet exceeds the given maximum size in bytes
   *
   * @param maxBytes The maximum size of the packet in bytes
   * @param throwError Whether the middleware should throw an error if the packet exceeds the maximum size, or simply drop the request
   * @returns A shared middleware that will check if a message packet exceeds the given maximum size
   */
  export function maxPacketSize(maxBytes: number, throwError = true): SharedMiddleware {
    return message =>
      ctx => {
        const rawData = ctx.getRawData();
        const totalSize = buffer.len(rawData.buffer) + rawData.blobs.size() * BLOB_SIZE;
        if (totalSize > maxBytes)
          return throwError
            ? error(`[@rbxts/tether]: Message '${message}' exceeded maximum packet size of ${maxBytes} bytes`)
            : DropRequest;
      };
  }

  /**
   * Creates a shared middleware that will drop any message that occurs within the given interval of the previous message
   *
   * @param interval The interval in seconds that the middleware should wait before allowing a new request
   * @returns A middleware that will drop any message that occurs within the given interval
   */
  export function rateLimit(interval: number): SharedMiddleware {
    let lastRequest = 0;

    return () =>
      () => {
        if (os.clock() - lastRequest < interval)
          return DropRequest;

        lastRequest = os.clock();
      };
  }

  function bufferToString(buf: buffer): string {
    const s: string[] = ["{ "];
    for (let i = 0; i < buffer.len(buf); i++) {
      const byte = buffer.readu8(buf, i);
      s.push(tostring(byte));
      if (i < buffer.len(buf) - 1)
        s.push(", ");
    }
    s.push(" }");
    return s.join("");
  }

  const horizontalLine = repeatString<"-", 36>();
  /**
   * Creates a shared middleware that will log a message whenever a message is sent, containing the following information:
   * - The message kind
   * - The data associated with the message
   * - The raw data (buffer and blobs) associated with the message
   * - The size of the packet (in bytes)
   * - The size of the buffer (in bytes)
   * - The size of the blobs (in bytes)
   * - The schema string associated with the message (if it can be deduced)
   *
   * @returns A shared middleware that will log a message whenever a message is sent.
   * @metadata macro
   */
  export function debug<T>(schema?: Modding.Many<Any.Equals<T, unknown> extends 1 ? undefined : SerializerMetadata<TetherPacket<T>>>): SharedMiddleware<T> {
    return message =>
      ({ data, getRawData }) => {
        const rawData = getRawData();
        const bufferSize = buffer.len(rawData.buffer);
        const blobsSize = rawData.blobs.size() * BLOB_SIZE;
        const schemaString = schema !== undefined
          ? " " + repr(schema[1], { pretty: true }).split("\n").join("\n ")
          : "unknown";

        const text = [
          "\n",
          horizontalLine, "\n",
          "Packet sent to ", (RunService.IsServer() ? "client" : "server"), "!\n",
          " - Message: ", message, "\n",
          " - Data: ", data === undefined ? "undefined" : data, "\n",
          " - Raw data:\n",
          "   - Buffer: ", bufferToString(rawData.buffer), "\n",
          "   - Blobs: ", repr(rawData.blobs, { pretty: false, robloxClassName: true }), "\n",
          " - Packet size: ", bufferSize + blobsSize, " bytes\n",
          "   - Buffer: ", bufferSize, " bytes\n",
          "   - Blobs: ", blobsSize, " bytes\n",
          " - Schema: ", schemaString, "\n",
          horizontalLine,
          "\n"
        ];

        print(text.join(""));
      };
  }
}