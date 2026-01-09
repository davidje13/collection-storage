export const debugType = (o: unknown) =>
  typeof o !== 'object' ? typeof o : o ? (o.constructor?.name ?? 'object') : 'null';
