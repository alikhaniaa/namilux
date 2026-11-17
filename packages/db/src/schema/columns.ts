import { bigint, customType, text, timestamp } from "drizzle-orm/pg-core";

export const ulid = (name: string) => text(name);

export const money = (name: string) => bigint(name, { mode: "number" });

export const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const createdAt = () => tstz("created_at").notNull().defaultNow();

export const updatedAt = () => tstz("updated_at").notNull().defaultNow();

export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});
