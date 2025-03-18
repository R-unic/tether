import { Modding } from "@flamework/core";

import { DropRequest, type UniversalMiddleware, type ServerMiddleware, type ClientMiddleware } from "./middleware";

type Guard<T> = (value: unknown) => value is T;

const noOp = () => { };
const validationGuardGenerationFailed = (context: "Client" | "Server") =>
  `[Tether]: Failed to generate guard for validate${context}<T> builtin middleware - skipping validation`;

export namespace BuiltinMiddlewares {
  /**
   * Creates a universal middleware that will drop any message that occurs within the given interval of the previous message.
   * @param interval The interval in seconds that the middleware should wait before allowing a new request.
   * @returns A middleware that will drop any message that occurs within the given interval.
   */
  export function rateLimit(interval: number): UniversalMiddleware {
    let lastRequest = 0;

    return () => {
      if (os.clock() - lastRequest < interval)
        return DropRequest;

      lastRequest = os.clock();
    };
  }


  /**
   * Creates a server middleware that validates the data with the given guard (or a generated guard if none was provided).
   * If the guard fails, the middleware will drop the message.
   *
   * @param guard The guard to use to validate the data.
   * @returns A server middleware that validates the data with the given guard.
   * @macro
   */
  export function validateServer<T>(guard?: Guard<T> | Modding.Generic<T, "guard">): ServerMiddleware<T> {
    if (guard === undefined) {
      warn(validationGuardGenerationFailed("Server"));
      return noOp;
    }

    return data => {
      if (guard(data)) return;
      return DropRequest;
    };
  }

  /**
   * Creates a server middleware that validates the data with the given guard (or a generated guard if none was provided).
   * If the guard fails, the middleware will drop the message.
   *
   * @param guard The guard to use to validate the data.
   * @returns A server middleware that validates the data with the given guard.
   * @macro
   */
  export function validateClient<T>(guard?: Guard<T> | Modding.Generic<T, "guard">): ClientMiddleware<T> {
    if (guard === undefined) {
      warn(validationGuardGenerationFailed("Client"));
      return noOp;
    }

    return data => {
      if (guard(data)) return;
      return DropRequest;
    };
  }
}