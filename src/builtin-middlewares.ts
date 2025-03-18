import { Middleware, DropRequest } from "./middleware";


export namespace BuiltinMiddlewares {
  export function rateLimit<Data>(interval: number): Middleware<Data> {
    let lastRequest = 0;

    return () => {
      if (os.clock() - lastRequest < interval)
        return DropRequest;

      lastRequest = os.clock();
    };
  }
}
