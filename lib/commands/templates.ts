export const LANGUAGE_EXT: Record<string, string> = {
  python: "py",
  py: "py",
  javascript: "js",
  js: "js",
  typescript: "ts",
  ts: "ts",
  tsx: "tsx",
  html: "html",
  css: "css",
  c: "c",
  cpp: "cpp",
  "c++": "cpp",
  java: "java",
  csharp: "cs",
  "c#": "cs",
  cs: "cs",
  php: "php",
  sql: "sql",
  go: "go",
  rust: "rs",
  rs: "rs",
  json: "json",
  markdown: "md",
  md: "md",
  text: "txt",
  txt: "txt",
};

export function extFor(language: string): string {
  return LANGUAGE_EXT[language.trim().toLowerCase()] ?? "txt";
}

export function languageFromExt(file: string): string {
  const ext = file.split(".").pop()?.toLowerCase() ?? "";
  const hit = Object.entries(LANGUAGE_EXT).find(([, v]) => v === ext);
  return hit?.[0] ?? ext;
}

function slug(hint: string, fallback: string) {
  const s = hint
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);
  return s || fallback;
}

export function generateCode(language: string, hint = ""): { filename: string; content: string } {
  const lang = language.toLowerCase() || "python";
  const ext = extFor(lang);
  const h = hint.toLowerCase();
  const calc = /calculat|calc\b/.test(h);
  const hello = /hello/.test(h);
  const api = /\bapi\b|fetch|http/.test(h);
  const site = /website|webpage|html css/.test(h);

  if (lang === "html" && /\b(login|sign in|signin)\b/.test(h)) {
    return {
      filename: "index.html",
      content: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light dark" />
  <title>Sign in</title>
  <style>
    :root { font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; color: #172033; background: #eef2f8; }
    * { box-sizing: border-box; }
    body { min-height: 100vh; margin: 0; display: grid; place-items: center; padding: 24px; background: radial-gradient(circle at 15% 10%, #d9e9ff, transparent 38%), #eef2f8; }
    .card { width: min(100%, 420px); padding: 36px; border: 1px solid #e5eaf2; border-radius: 20px; background: #fff; box-shadow: 0 24px 70px #20305018; }
    .eyebrow { color: #586782; font-size: .78rem; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; }
    h1 { margin: 10px 0 8px; font-size: clamp(1.8rem, 5vw, 2.25rem); letter-spacing: -.04em; }
    .intro { margin: 0 0 28px; color: #64718a; line-height: 1.55; }
    label { display: block; margin: 16px 0 7px; font-size: .9rem; font-weight: 650; }
    input { width: 100%; min-height: 48px; padding: 0 14px; border: 1px solid #cfd7e5; border-radius: 10px; background: #fff; color: #172033; font: inherit; }
    input:focus { border-color: #5268db; outline: 3px solid #5268db22; }
    .row { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 15px 0 22px; color: #586782; font-size: .86rem; }
    .remember { display: flex; align-items: center; gap: 8px; margin: 0; font-weight: 500; }
    .remember input { width: 16px; min-height: 16px; }
    a { color: #455bd0; text-decoration: none; }
    a:hover { text-decoration: underline; }
    button { width: 100%; min-height: 50px; border: 0; border-radius: 10px; background: #465bd2; color: #fff; font: inherit; font-weight: 700; cursor: pointer; }
    button:hover { background: #3549ba; }
    .signup { margin: 22px 0 0; color: #64718a; text-align: center; font-size: .9rem; }
    .status { min-height: 1.4em; margin: 14px 0 0; color: #a33535; font-size: .88rem; }
    @media (max-width: 480px) { .card { padding: 26px 22px; } }
  </style>
</head>
<body>
  <main class="card">
    <div class="eyebrow">Welcome back</div>
    <h1>Sign in to your account</h1>
    <p class="intro">Enter your details to continue.</p>
    <form id="login-form">
      <label for="email">Email address</label>
      <input id="email" name="email" type="email" autocomplete="username" placeholder="you@example.com" required />
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" placeholder="Enter your password" required />
      <div class="row">
        <label class="remember"><input name="remember" type="checkbox" /> Remember me</label>
        <a href="#forgot">Forgot password?</a>
      </div>
      <button type="submit">Sign in</button>
      <p class="status" id="status" role="status" aria-live="polite"></p>
    </form>
    <p class="signup">New here? <a href="#signup">Create an account</a></p>
  </main>
  <script>
    document.getElementById("login-form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      document.getElementById("status").textContent = "Form ready to connect to your authentication service.";
    });
  </script>
</body>
</html>
`,
    };
  }

  if (site || lang === "html") {
    return {
      filename: "index.html",
      content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>MR00100 Site</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; background: #0b1110; color: #d6fff0; }
    main { max-width: 720px; margin: 12vh auto; padding: 24px; }
    button { background: #00c48c; border: 0; padding: 10px 16px; cursor: pointer; }
  </style>
</head>
<body>
  <main>
    <h1>MR00100 AI</h1>
    <p>Generated local page.</p>
    <button id="go">Ping</button>
  </main>
  <script>
    document.getElementById("go")?.addEventListener("click", () => {
      alert("Ready.");
    });
  </script>
</body>
</html>
`,
    };
  }

  if (lang === "python" || ext === "py") {
    if (calc) {
      return {
        filename: "calculator.py",
        content: `def add(a, b):
    return a + b

def sub(a, b):
    return a - b

def mul(a, b):
    return a * b

def div(a, b):
    if b == 0:
        raise ZeroDivisionError("cannot divide by zero")
    return a / b


if __name__ == "__main__":
    print("MR00100 calculator")
    print("add 2+3 =", add(2, 3))
    print("sub 9-4 =", sub(9, 4))
    print("mul 6*7 =", mul(6, 7))
    print("div 8/2 =", div(8, 2))
`,
      };
    }
    return {
      filename: hello ? "hello.py" : `${slug(hint, "main")}.py`,
      content: `print("Hello, World!")
`,
    };
  }

  if (lang === "javascript" || ext === "js") {
    if (api) {
      return {
        filename: "fetch-api.js",
        content: `async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

async function main() {
  const data = await fetchJson("https://httpbin.org/json");
  console.log(JSON.stringify(data, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
`,
      };
    }
    return {
      filename: hello ? "hello.js" : `${slug(hint, "index")}.js`,
      content: `console.log("Hello, World!");
`,
    };
  }

  if (lang === "typescript" || ext === "ts") {
    return {
      filename: `${slug(hint, "main")}.ts`,
      content: `const message: string = "Hello, World!";
console.log(message);
`,
    };
  }

  if (ext === "c") {
    return {
      filename: `${slug(hint, "main")}.c`,
      content: `#include <stdio.h>

int main(void) {
    printf("Hello, World!\\n");
    return 0;
}
`,
    };
  }

  if (ext === "cpp") {
    return {
      filename: `${slug(hint, "main")}.cpp`,
      content: `#include <iostream>

int main() {
    std::cout << "Hello, World!" << std::endl;
    return 0;
}
`,
    };
  }

  if (ext === "java") {
    return {
      filename: "Main.java",
      content: `public class Main {
    public static void main(String[] args) {
        System.out.println("Hello, World!");
    }
}
`,
    };
  }

  if (ext === "go") {
    return {
      filename: "main.go",
      content: `package main

import "fmt"

func main() {
    fmt.Println("Hello, World!")
}
`,
    };
  }

  if (ext === "rs") {
    return {
      filename: "main.rs",
      content: `fn main() {
    println!("Hello, World!");
}
`,
    };
  }

  if (ext === "cs") {
    return {
      filename: "Program.cs",
      content: `using System;
class Program {
    static void Main() {
        Console.WriteLine("Hello, World!");
    }
}
`,
    };
  }

  if (ext === "php") {
    return {
      filename: `${slug(hint, "index")}.php`,
      content: `<?php
echo "Hello, World!\\n";
`,
    };
  }

  if (ext === "css") {
    return {
      filename: "style.css",
      content: `:root {
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  color: #172033;
  background: #eef2f8;
}

* {
  box-sizing: border-box;
}

body {
  min-height: 100vh;
  margin: 0;
  display: grid;
  place-items: center;
  padding: 24px;
}

.card,
main {
  width: min(100%, 420px);
  padding: 36px;
  border: 1px solid #e5eaf2;
  border-radius: 20px;
  background: #fff;
  box-shadow: 0 24px 70px #20305018;
}

h1 {
  margin: 10px 0 8px;
  font-size: clamp(1.8rem, 5vw, 2.25rem);
  letter-spacing: -0.04em;
}

label {
  display: block;
  margin: 16px 0 7px;
  font-size: 0.9rem;
  font-weight: 650;
}

input {
  width: 100%;
  min-height: 48px;
  padding: 0 14px;
  border: 1px solid #cfd7e5;
  border-radius: 10px;
  font: inherit;
}

input:focus {
  border-color: #5268db;
  outline: 3px solid #5268db22;
}

button {
  width: 100%;
  min-height: 50px;
  margin-top: 18px;
  border: 0;
  border-radius: 10px;
  background: #465bd2;
  color: #fff;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

button:hover {
  background: #3549ba;
}

@media (max-width: 480px) {
  .card,
  main {
    padding: 26px 22px;
  }
}
`,
    };
  }

  if (ext === "sql") {
    return {
      filename: `${slug(hint, "query")}.sql`,
      content: `SELECT 1 AS ok;\n`,
    };
  }

  return {
    filename: `${slug(hint, "notes")}.${ext}`,
    content: hint ? `${hint}\n` : "",
  };
}

export function runCommandFor(filePath: string): { command: string; cwd?: string } | null {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const base = filePath.replace(/\\/g, "/");
  const name = base.split("/").pop() ?? filePath;
  switch (ext) {
    case "py":
      return { command: process.platform === "win32" ? `py -3 "${name}"` : `python3 "${name}"` };
    case "js":
      return { command: `node "${name}"` };
    case "ts":
      return { command: `npx --yes tsx "${name}"` };
    case "c":
      return {
        command:
          process.platform === "win32"
            ? `gcc "${name}" -o app.exe && app.exe`
            : `gcc "${name}" -o app && ./app`,
      };
    case "cpp":
      return {
        command:
          process.platform === "win32"
            ? `g++ "${name}" -o app.exe && app.exe`
            : `g++ "${name}" -o app && ./app`,
      };
    case "java":
      return { command: `javac "${name}" && java ${name.replace(/\.java$/i, "")}` };
    case "go":
      return { command: `go run "${name}"` };
    case "rs":
      return {
        command:
          process.platform === "win32"
            ? `rustc "${name}" -o app.exe && app.exe`
            : `rustc "${name}" -o app && ./app`,
      };
    case "php":
      return { command: `php "${name}"` };
    case "cs":
      return { command: `dotnet script "${name}"` };
    default:
      return null;
  }
}
