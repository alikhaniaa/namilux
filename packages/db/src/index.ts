import type { InferInsertModel, InferSelectModel, Table } from "drizzle-orm";

export * from "./schema";
export * from "./relations";

export {
  DB_ROLES,
  ROLE_LIMITS,
  assertLocalDatabase,
  closeDb,
  createDb,
  getDb,
  pingDb,
  redactDbUrl,
  schema,
} from "./client";
export type { CreateDbOptions, Db, DbClient, DbRole, DbTx, RoleLimits, Schema } from "./client";

export type Row<T extends Table> = InferSelectModel<T>;
export type NewRow<T extends Table> = InferInsertModel<T>;

export {
  aliasedTable,
  and,
  asc,
  avg,
  between,
  count,
  desc,
  eq,
  exists,
  getTableColumns,
  getTableName,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  lte,
  max,
  min,
  ne,
  not,
  notExists,
  notIlike,
  notInArray,
  or,
  sql,
  sum,
} from "drizzle-orm";
export type { InferInsertModel, InferSelectModel, SQL, Table } from "drizzle-orm";
