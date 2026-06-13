declare module 'wa-sqlite/dist/wa-sqlite-async.mjs' {
  export default function ModuleConstructor(options?: any): Promise<any>;
}

declare module 'wa-sqlite/src/sqlite-api.js' {
  export interface SQLiteAPI {
    vfs_register(vfs: any, makeDefault: boolean): number;
    open_v2(
      filename: string,
      flags: number,
      vfs?: string,
    ): Promise<number>;
    close(db: number): Promise<void>;
    exec(
      db: number,
      sql: string,
      callback?: (row: any, columns: string[]) => void,
    ): Promise<number>;
    execWithParams(
      db: number,
      sql: string,
      params?: any[] | Record<string, any>,
    ): Promise<{ rows: any[]; columns: string[] }>;
    run(
      db: number,
      sql: string,
      params?: any[] | Record<string, any>,
    ): Promise<number>;
  }

  export function Factory(Module: any): SQLiteAPI;

  export class SQLiteError extends Error {
    code: number;
  }

  export const SQLITE_OPEN_READWRITE: number;
  export const SQLITE_OPEN_CREATE: number;
}

declare module 'wa-sqlite/src/examples/OriginPrivateFileSystemVFS.js' {
  class OriginPrivateFileSystemVFS {
    constructor();
    close(): Promise<void>;
    name: string;
  }
  export { OriginPrivateFileSystemVFS };
}