import Database from "better-sqlite3";
import { databaseFilePath } from "@/lib/storage-paths";

type BotReadDatabaseGlobal = typeof globalThis & {
  __fortressBotReadDatabase?: Database.Database;
  __fortressBotReadDatabasePath?: string;
};

const botReadDatabaseGlobal = globalThis as BotReadDatabaseGlobal;

export class BotReadDatabaseUnavailableError extends Error {
  constructor() {
    super("Bot facts database is unavailable");
    this.name = "BotReadDatabaseUnavailableError";
  }
}

function openBotReadDatabase() {
  const filename = databaseFilePath();
  try {
    const database = new Database(filename, {
      readonly: true,
      fileMustExist: true,
      timeout: 5_000
    });
    database.pragma("query_only = ON");
    const queryOnly = Number(database.pragma("query_only", { simple: true }));
    if (!database.readonly || queryOnly !== 1) {
      database.close();
      throw new BotReadDatabaseUnavailableError();
    }
    botReadDatabaseGlobal.__fortressBotReadDatabasePath = filename;
    return database;
  } catch (error) {
    if (error instanceof BotReadDatabaseUnavailableError) throw error;
    throw new BotReadDatabaseUnavailableError();
  }
}

function getBotReadDatabase() {
  const filename = databaseFilePath();
  const current = botReadDatabaseGlobal.__fortressBotReadDatabase;
  if (current && botReadDatabaseGlobal.__fortressBotReadDatabasePath !== filename) {
    current.close();
    delete botReadDatabaseGlobal.__fortressBotReadDatabase;
    delete botReadDatabaseGlobal.__fortressBotReadDatabasePath;
  }
  if (!botReadDatabaseGlobal.__fortressBotReadDatabase) {
    botReadDatabaseGlobal.__fortressBotReadDatabase = openBotReadDatabase();
  }
  return botReadDatabaseGlobal.__fortressBotReadDatabase;
}

export function withBotReadTransaction<T>(reader: (database: Database.Database) => T): T {
  const database = getBotReadDatabase();
  try {
    return database.transaction(() => reader(database))();
  } catch (error) {
    if (error instanceof BotReadDatabaseUnavailableError) throw error;
    throw error;
  }
}

export function closeBotReadDbForTests() {
  botReadDatabaseGlobal.__fortressBotReadDatabase?.close();
  delete botReadDatabaseGlobal.__fortressBotReadDatabase;
  delete botReadDatabaseGlobal.__fortressBotReadDatabasePath;
}
