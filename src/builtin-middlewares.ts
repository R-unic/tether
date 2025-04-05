import { Modding } from "@flamework/core";

import { DropRequest, type SharedMiddleware, type ServerMiddleware, type ClientMiddleware } from "./middleware";
import { BaseMessage, SerializedPacket } from "./structs";
import { RunService } from "@rbxts/services";
import { repeatString } from "@rbxts/flamework-meta-utils";

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
   *
   * @param guard The guard to use to validate the data.
   * @returns A shared middleware that validates the data with the given guard.
   * @metadata macro
   */
  export function validate<T>(guard?: Guard<T> | Modding.Generic<T, "guard">): SharedMiddleware {
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

  function toStringBuffer(buf: buffer): string {
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

  const line = repeatString<"-", 36>();
  export function debug(): SharedMiddleware {
    return message =>
      (data, _, getRawData) => {
        const rawData = getRawData();
        const bufferSize = buffer.len(rawData.buffer);
        const blobsSize = rawData.blobs.size() * BLOB_SIZE;
        print(line);
        print("Packet sent to", (RunService.IsServer() ? "client" : "server") + "!");
        print(" - Message:", message);
        print(" - Data:", data);
        print(" - Raw data:");
        print("   - Buffer:", toStringBuffer(rawData.buffer));
        print("   - Blobs:", rawData.blobs);
        print(" - Packet size:", bufferSize + blobsSize, "bytes");
        print("   - Buffer:", bufferSize, "bytes");
        print("   - Blobs:", blobsSize, "bytes");
        print(line);
      };
  }
}