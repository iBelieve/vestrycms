/** `virtual:vestry/formatter` in tests: the module a project without Prettier gets. */
export const available = false;
export const ignore = "";
export async function formatFile(text: string): Promise<string> {
  return text;
}
