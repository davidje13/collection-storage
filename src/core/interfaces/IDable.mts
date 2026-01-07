export type IDType = number | string;

export interface IDableBy<ID extends IDType> {
  id: ID;
}

export type IDable = IDableBy<IDType>;
