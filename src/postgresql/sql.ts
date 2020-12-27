const DQUOTE_REG = /"/g;
export function quoteIdentifier(msg: string): string {
  return `"${msg.replace(DQUOTE_REG, '""')}"`;
}

const SQUOTE_REG = /'/g;
export function quoteValue(msg: string): string {
  // only used for creating indices,
  // because prepared statements do not support CREATE
  return `'${msg.replace(SQUOTE_REG, '\'\'')}'`;
}

const ID_REG = /\$[A-Z]/g;
export function withIdentifiers(
  base: string, // expects trusted (internal) source
  identifiers: Record<string, string>,
): string {
  return base.replace(
    ID_REG,
    (v) => quoteIdentifier(identifiers[v.substr(1)]),
  );
}
