import DB from './interfaces/DB';
export default class CollectionStorage {
    static connect(url: string): Promise<DB>;
}
