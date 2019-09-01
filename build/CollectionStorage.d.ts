import DB from './DB';
export default class CollectionStorage {
    static connect(url: string): Promise<DB>;
}
