export function bufferToString(buf?: buffer): string {
  const s: string[] = ["{ "];
  if (buf !== undefined)
    for (let i = 0; i < buffer.len(buf); i++) {
      const byte = buffer.readu8(buf, i);
      s.push(tostring(byte));
      s.push(i < buffer.len(buf) - 1 ? ", " : "");
    }

  s.push("}");
  return s.join("");
}