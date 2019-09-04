export type IDType = number | string;

// eslint-disable-next-line @typescript-eslint/interface-name-prefix
export interface IDableBy<ID extends IDType> {
  id: ID;
}

type IDable = IDableBy<IDType>;
export default IDable;
