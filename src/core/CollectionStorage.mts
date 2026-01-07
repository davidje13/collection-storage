import type { DB } from './interfaces/DB.mts';

export class CollectionStorageFactory {
  /** @internal */ private readonly _protocols = new Map<
    string,
    (url: string) => DB | Promise<DB>
  >();
  /** @internal */ private readonly _loaders = new Map<string, () => Promise<unknown>>();

  register(protocols: string[], builder: (url: string) => DB | Promise<DB>) {
    for (const protocol of protocols) {
      this._protocols.set(protocol, builder);
      this._loaders.delete(protocol);
    }
  }

  dynamic(services: [string, () => Promise<unknown>][]) {
    for (const [protocol, loader] of services) {
      if (!this._protocols.has(protocol)) {
        this._loaders.set(protocol, loader);
      }
    }
  }

  async connect(url: string): Promise<DB> {
    const protocol = url.split('://')[0]!;
    let builder = this._protocols.get(protocol);
    if (!builder) {
      const loader = this._loaders.get(protocol);
      if (!loader) {
        throw new Error(`Unsupported database connection string: ${url}`);
      }
      await loader();
      builder = this._protocols.get(protocol);
      if (!builder) {
        throw new Error(`Failed to load DB interop library for: ${url}`);
      }
    }

    try {
      return await builder(url);
    } catch (e) {
      throw new Error(
        `Failed to connect to database "${url}": ${e instanceof Error ? e.message : e}`,
      );
    }
  }
}

export const CollectionStorage = new CollectionStorageFactory();
