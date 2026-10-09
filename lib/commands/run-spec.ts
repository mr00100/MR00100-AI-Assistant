export type ProgramStep = { program: string; args: string[]; label: string };
export type RunPlan = { steps: ProgramStep[]; cleanupDirectory?: string };

/** Build argument-vector execution plans; never concatenate a user path into a shell command. */
export function runPlanFor(filePath: string, tempDirectory: string): RunPlan | null {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const fileName = filePath.replace(/\\/g, "/").split("/").pop() ?? filePath;
  const javaName = fileName.replace(/\.java$/i, "");
  const isWindows = process.platform === "win32";

  switch (ext) {
    case "py":
      return {
        steps: [
          {
            program: isWindows ? "py.exe" : "python3",
            args: isWindows ? ["-3", filePath] : [filePath],
            label: isWindows ? `py -3 "${fileName}"` : `python3 "${fileName}"`,
          },
        ],
      };
    case "js":
      return { steps: [{ program: isWindows ? "node.exe" : "node", args: [filePath], label: `node "${fileName}"` }] };
    case "go":
      return { steps: [{ program: isWindows ? "go.exe" : "go", args: ["run", filePath], label: `go run "${fileName}"` }] };
    case "php":
      return { steps: [{ program: isWindows ? "php.exe" : "php", args: [filePath], label: `php "${fileName}"` }] };
    case "c": {
      const output = `${tempDirectory}${isWindows ? "\\" : "/"}mr00100-program${isWindows ? ".exe" : ""}`;
      return {
        cleanupDirectory: tempDirectory,
        steps: [
          { program: isWindows ? "gcc.exe" : "gcc", args: [filePath, "-o", output], label: `gcc "${fileName}"` },
          { program: output, args: [], label: output },
        ],
      };
    }
    case "cpp": {
      const output = `${tempDirectory}${isWindows ? "\\" : "/"}mr00100-program${isWindows ? ".exe" : ""}`;
      return {
        cleanupDirectory: tempDirectory,
        steps: [
          { program: isWindows ? "g++.exe" : "g++", args: [filePath, "-o", output], label: `g++ "${fileName}"` },
          { program: output, args: [], label: output },
        ],
      };
    }
    case "java":
      return {
        cleanupDirectory: tempDirectory,
        steps: [
          { program: isWindows ? "javac.exe" : "javac", args: ["-d", tempDirectory, filePath], label: `javac "${fileName}"` },
          { program: isWindows ? "java.exe" : "java", args: ["-cp", tempDirectory, javaName], label: `java ${javaName}` },
        ],
      };
    case "rs": {
      const output = `${tempDirectory}${isWindows ? "\\" : "/"}mr00100-program${isWindows ? ".exe" : ""}`;
      return {
        cleanupDirectory: tempDirectory,
        steps: [
          { program: isWindows ? "rustc.exe" : "rustc", args: [filePath, "-o", output], label: `rustc "${fileName}"` },
          { program: output, args: [], label: output },
        ],
      };
    }
    default:
      return null;
  }
}
