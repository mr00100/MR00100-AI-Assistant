import {
  boolean,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/** Singleton-ish settings store (row id = 1). */
export const appSettings = pgTable("app_settings", {
  id: integer("id").primaryKey(),
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/** Every real executed command / routed intent. */
export const commandHistory = pgTable("command_history", {
  id: serial("id").primaryKey(),
  command: text("command").notNull(),
  // SYSTEM | AI | DEVELOPER | FILE | TERMINAL | VOICE | SECURITY | NETWORK
  type: text("type").notNull(),
  // SUCCESS | FAILED | BLOCKED | PENDING | CONFIRM
  status: text("status").notNull(),
  detail: text("detail"),
  risk: text("risk"),
  durationMs: integer("duration_ms"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/** Chat transcript (voice + text share the same transcript). */
export const chatMessages = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id").notNull().default("default"),
  role: text("role").notNull(), // user | assistant | system
  content: text("content").notNull(),
  model: text("model"),
  mode: text("mode"), // LOCAL | AI | DEVELOPER
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/** User-controllable local memory. */
export const memoryEntries = pgTable("memory_entries", {
  id: serial("id").primaryKey(),
  category: text("category").notNull().default("general"),
  key: text("key").notNull(),
  value: text("value").notNull(),
  pinned: boolean("pinned").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/** Event-bus persistence: security warnings, build events, resource alarms. */
export const systemEvents = pgTable("system_events", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(),
  level: text("level").notNull().default("info"), // info | warn | error | success
  message: text("message").notNull(),
  meta: jsonb("meta").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
