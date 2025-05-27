export function bufferToString(buf: buffer): string {
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