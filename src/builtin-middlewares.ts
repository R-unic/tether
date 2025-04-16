import { Modding } from "@flamework/core";
import { DropRequest, type SharedMiddleware } from "./middleware";
import { BaseMessage, type TetherPacket } from "./structs";
import { RunService } from "@rbxts/services";
import { repeatString } from "@rbxts/flamework-meta-utils";
import type { SerializerMetadata } from "@rbxts/flamework-binary-serializer";
import repr from "@rbxts/repr";

type Guard<T> = (value: unknown) => value is T;

const noOp = () => () => { };
const validationGuardGenerationFailed = () =>
  `[@rbxts/tether]: Failed to generate guard for validate<T>() builtin middleware - skipping validation`;

const guardFailed = (message: BaseMessage) =>
  `[@rbxts/tether]: Type validation guard failed for message '${tostring(message)}' - check your sent data`;

const BLOB_SIZE = 5; // bytes

export namespace BuiltinMiddlewares {
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

  /**
   * Creates a shared middleware that validates the data with the given guard (or a generated guard if none was provided)
   *
   * If the guard fails, the middleware will drop the message
   * **Note: This middleware will only automatically generate a guard when it is not used globally.
   * If you want to use it globally, provide a type argument to generate a guard for****
   *
   * @param guard The guard to use to validate the data.
   * @returns A shared middleware that validates the data with the given guard.
   * @metadata macro
   */
  export function validate<T>(guard?: Guard<T> | Modding.Generic<T, "guard">): SharedMiddleware<T> {
    if (guard === undefined) {
      warn(validationGuardGenerationFailed());
      return noOp;
    }

    return message =>
      data => {
        if (guard(data)) return;
        warn(guardFailed(message));
        return DropRequest;
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
  export function debug<T>(schema?: Modding.Many<SerializerMetadata<TetherPacket<T>>>): SharedMiddleware<T> {
    return message =>
      (data, _, getRawData) => {
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
          " - Data: ", data, "\n",
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