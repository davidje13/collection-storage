export type IDType = number | string;

// eslint-disable-next-line @typescript-eslint/interface-name-prefix
export interface IDableBy<ID extends IDType> {
  id: ID;
}

export type IDable = IDableBy<IDType>;
