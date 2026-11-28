/**
 * `text` without any of `characters` at its end, like the slashes after an address or the full
 * stop after a mention. It walks back from the end once. A pattern such as /x+$/ does the same
 * job, but on a long run of the character in the middle of the text it starts again from each
 * one, which someone could use to keep the server busy.
 */
export function withoutTrailing(text: string, characters: string): string {
  let end = text.length;
  while (end > 0 && characters.includes(text.charAt(end - 1))) {
    end -= 1;
  }
  return text.slice(0, end);
}
