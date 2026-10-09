import { NextResponse } from "next/server";
import { promises as fsp } from "node:fs";
import path from "node:path";
import {
  ensureWorkspace,
  listDir,
  readFileSafe,
  recentFiles,
  resolveSafe,
  searchWorkspace,
  toRelative,
  workspaceRoot,
  WorkspaceError,
} from "@/lib/server/workspace";
import { classifyFileOperation, type FileOperation } from "@/lib/security";
import { getSettings } from "@/lib/server/settings";
import { logCommand, logEvent } from "@/lib/server/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function fail(error: unknown, status = 400) {
  if (error instanceof WorkspaceError) {
    return NextResponse.json(
      { ok: false, error: error.message, reason: error.reason, action: error.action },
      { status },
    );
  }
  const e = error as NodeJS.ErrnoException;
  return NextResponse.json(
    {
      ok: false,
      error: "FILESYSTEM ERROR",
      reason: e?.message ?? "unknown failure",
      action: "Verify the path and permissions, then retry.",
    },
    { status: 500 },
  );
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const op = (url.searchParams.get("op") ?? "list") as FileOperation | "recent" | "root";
  const target = url.searchParams.get("path") ?? "";
  try {
    await ensureWorkspace();
    if (op === "root") {
      return NextResponse.json({ ok: true, root: workspaceRoot() });
    }
    if (op === "recent") {
      return NextResponse.json({ ok: true, entries: await recentFiles(14), root: workspaceRoot() });
    }
    if (op === "read") {
      const file = await readFileSafe(target);
      return NextResponse.json({ ok: true, file });
    }
    if (op === "search") {
      const q = url.searchParams.get("q") ?? "";
      if (!q.trim())
        return NextResponse.json(
          { ok: false, error: "EMPTY QUERY", reason: "No search term supplied.", action: "Type at least one character." },
          { status: 400 },
        );
      return NextResponse.json({ ok: true, entries: await searchWorkspace(q) });
    }
    const entries = await listDir(target || ".");
    return NextResponse.json({ ok: true, entries, path: target || "", root: workspaceRoot() });
  } catch (error) {
    return fail(error);
  }
}

type MutationBody = {
  op: FileOperation;
  path?: string;
  to?: string;
  content?: string;
  confirmed?: boolean;
};

export async function POST(request: Request) {
  const started = Date.now();
  let body: MutationBody;
  try {
    body = (await request.json()) as MutationBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "BAD REQUEST", reason: "Body was not valid JSON.", action: "Retry the operation." },
      { status: 400 },
    );
  }

  const settings = await getSettings();
  const target = body.path ?? "";

  try {
    await ensureWorkspace();
    const full = resolveSafe(target);
    const exists = await fsp
      .stat(full)
      .then(() => true)
      .catch(() => false);

    const verdict = classifyFileOperation(body.op, target, settings.fileAccess, { exists });
    if (verdict.level === "BLOCK") {
      await logCommand({
        command: `${body.op} ${target}`,
        type: "SECURITY",
        status: "BLOCKED",
        detail: verdict.reason,
        risk: "BLOCK",
      });
      await logEvent({ type: "SECURITY_WARNING", level: "error", message: verdict.reason, meta: { target } });
      return NextResponse.json(
        { ok: false, blocked: true, error: "OPERATION BLOCKED", reason: verdict.reason, action: "Adjust policy in the Security Center if this is intentional." },
        { status: 403 },
      );
    }
    if (verdict.level === "CONFIRM" && !body.confirmed) {
      await logCommand({
        command: `${body.op} ${target}`,
        type: "FILE",
        status: "CONFIRM",
        detail: verdict.intentDescription,
        risk: "CONFIRM",
      });
      return NextResponse.json({
        ok: false,
        requiresConfirmation: true,
        verdict,
      });
    }

    let result: Record<string, unknown> = {};
    switch (body.op) {
      case "write":
      case "create": {
        await fsp.mkdir(path.dirname(full), { recursive: true });
        await fsp.writeFile(full, body.content ?? "", "utf8");
        result = { path: toRelative(full), bytes: Buffer.byteLength(body.content ?? "") };
        await logEvent({
          type: exists ? "FILE_CHANGED" : "FILE_CREATED",
          level: "success",
          message: `${exists ? "Updated" : "Created"} ${toRelative(full)}`,
        });
        break;
      }
      case "mkdir": {
        await fsp.mkdir(full, { recursive: true });
        result = { path: toRelative(full) };
        await logEvent({ type: "FILE_CREATED", level: "success", message: `Created directory ${toRelative(full)}` });
        break;
      }
      case "delete": {
        const st = await fsp.stat(full);
        await fsp.rm(full, { recursive: st.isDirectory(), force: false });
        result = { path: toRelative(full) };
        await logEvent({ type: "FILE_CHANGED", level: "warn", message: `Deleted ${toRelative(full)}` });
        break;
      }
      case "rename":
      case "move": {
        const dst = resolveSafe(body.to ?? "");
        await fsp.mkdir(path.dirname(dst), { recursive: true });
        await fsp.rename(full, dst);
        result = { from: toRelative(full), to: toRelative(dst) };
        await logEvent({ type: "FILE_CHANGED", level: "success", message: `Moved ${toRelative(full)} → ${toRelative(dst)}` });
        break;
      }
      case "copy": {
        const dst = resolveSafe(body.to ?? "");
        await fsp.mkdir(path.dirname(dst), { recursive: true });
        await fsp.cp(full, dst, { recursive: true });
        result = { from: toRelative(full), to: toRelative(dst) };
        await logEvent({ type: "FILE_CREATED", level: "success", message: `Copied to ${toRelative(dst)}` });
        break;
      }
      default:
        return NextResponse.json(
          { ok: false, error: "UNSUPPORTED OPERATION", reason: `"${body.op}" is not a mutation.`, action: "Use list/read/search via GET." },
          { status: 400 },
        );
    }

    await logCommand({
      command: `${body.op} ${target}`,
      type: "FILE",
      status: "SUCCESS",
      detail: JSON.stringify(result),
      risk: verdict.level,
      durationMs: Date.now() - started,
    });
    return NextResponse.json({ ok: true, op: body.op, result });
  } catch (error) {
    await logCommand({
      command: `${body.op} ${target}`,
      type: "FILE",
      status: "FAILED",
      detail: error instanceof Error ? error.message : "unknown",
      durationMs: Date.now() - started,
    });
    return fail(error);
  }
}
