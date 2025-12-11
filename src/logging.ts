const errorTag = "[tether::error] ";
const warnTag = "[tether::warning] ";

export const enum Error {
  NoServerListen = errorTag + "Cannot listen to server message from client",
  NoClientListen = errorTag + "Cannot listen to client message from server",
  NoServerToServer = errorTag + "Cannot emit message from server to server",
  NoClientToClient = errorTag + "Cannot emit message from client to client",
  NoClientToAllClients = errorTag + "Cannot emit message from client to all clients",
  NoServerToServerFunction = errorTag + "Cannot invoke function from server to server",
  NoClientToClientFunction = errorTag + "Cannot invoke function from client to client",
  ServerFunctionTimeout = errorTag + "Server function timed out (no response)",
  ClientFunctionTimeout = errorTag + "Client function timed out (no response)"
}

export const enum Warning {
  MessageBufferTooLong = warnTag + "Rejected packet because message buffer was larger than one byte",
  MetaGenerationFailed = warnTag + "Failed to generate message metadata - make sure you have the Flamework transformer and are using Flamework macro-friendly types in your schemas",
}