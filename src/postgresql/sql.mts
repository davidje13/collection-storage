const DQUOTE_REG = /"/g;
const SQUOTE_REG = /'/g;

const ID_REG = /\$[A-Z]/g;
export function withIdentifiers(
  base: string, // expects trusted (internal) source
  identifiers: Record<string, string>,
  values: Record<string, string> = {},
): string {
  return base.replace(ID_REG, (v) => {
    const name = v.substring(1);
    const id = identifiers[name];
    if (id !== undefined) {
      return `"${id.replaceAll(DQUOTE_REG, '""')}"`;
    } else {
      return `'${values[name]!.replaceAll(SQUOTE_REG, "''")}'`;
    }
  });
}
