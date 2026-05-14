declare module "node:sqlite" {
  export class DatabaseSync {
    constructor(location: string, options?: { readOnly?: boolean });
    close(): void;
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
  }

  export class StatementSync {
    all(...anonymousParameters: unknown[]): unknown[];
    get(...anonymousParameters: unknown[]): unknown;
    run(...anonymousParameters: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  }
}
