import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { checkVsCode } from "@/lib/vscode";
import { execCapture } from "@/lib/windows/shell";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function checkBrowserLauncher(): Promise<boolean> {
  if (process.platform === "win32") {
    const windowsRoot = process.env.WINDIR || process.env.SystemRoot || "C:\\Windows";
    try {
      await fs.access(path.join(windowsRoot, "explorer.exe"));
      return true;
    } catch {
      const result = await execCapture("where.exe", ["explorer.exe"], 2000);
      return result.ok && Boolean(result.stdout.trim());
    }
  }
  if (process.platform === "darwin") {
    try {
      await fs.access("/usr/bin/open");
      return true;
    } catch {
      return false;
    }
  }
  const result = await execCapture("which", ["xdg-open"], 2000);
  return result.ok && Boolean(result.stdout.trim());
}

async function checkWindowsExecutor(): Promise<boolean> {
  if (process.platform !== "win32") return false;
  const result = await execCapture("cmd.exe", ["/d", "/c", "ver"], 2000);
  return result.ok && Boolean(result.stdout.trim());
}

export async function GET() {
  let databaseAvailable = false;
  let databaseReason: string | undefined;
  try {
    await db.execute(sql`select 1`);
    databaseAvailable = true;
  } catch (error) {
    databaseReason = error instanceof Error ? error.message : "Database probe failed.";
  }

  const [windows, browser, vscode] = await Promise.all([
    checkWindowsExecutor().catch(() => false),
    checkBrowserLauncher().catch(() => false),
    checkVsCode().catch((error) => ({
      available: false,
      platform: process.platform,
      reason: error instanceof Error ? error.message : "VS Code probe failed.",
    })),
  ]);

  const ok = databaseAvailable;
  return Response.json(
    {
      ok,
      service: "MR00100",
      running: true,
      version: process.env.npm_package_version ?? "local",
      platform: process.platform,
      host: os.hostname(),
      database: { available: databaseAvailable, reason: databaseReason },
      executors: {
        windows,
        browser,
        vscode: vscode.available,
      },
    },
    { status: ok ? 200 : 503 },
  );
}
