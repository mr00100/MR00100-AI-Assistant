/**
 * MR00100 AI — runtime configuration contract.
 *
 * Models are NEVER hard-coded into application logic. They are resolved from
 * (1) persisted user settings, (2) environment variables, (3) these defaults.
 */

export type PermissionLevel = "SAFE" | "CONFIRM" | "BLOCK";

export type AssistantSettings = {
  // AI provider
  aiProvider: string;
  generalModel: string;
  developerModel: string;
  reasoningModel: string;
  fallbackModel: string;
  temperature: number;
  maxTokens: number;
  requestTimeoutMs: number;
  autoAiMode: boolean;
  apiKeyOverride: string;

  // Voice
  voiceEnabled: boolean;
  voiceName: string;
  speechRate: number;
  speechPitch: number;
  speechVolume: number;
  wakeWord: string;
  wakeWordEnabled: boolean;
  micEnabled: boolean;
  cameraEnabled: boolean;
  commandLanguage: "auto" | "en" | "ur" | "roman";

  // Visuals
  theme: "green" | "cyan" | "amber";
  animationIntensity: number; // 0..1
  particleDensity: number; // 0..1
  backgroundEffects: boolean;
  matrixRain: boolean;
  scanlines: boolean;
  soundEffects: boolean;
  soundVolume: number;

  // Guards
  resourceGuard: boolean;
  cpuThreshold: number;
  ramThreshold: number;
  pollIntervalMs: number;

  // Permissions
  terminalAccess: PermissionLevel;
  fileAccess: PermissionLevel;
  aiAccess: PermissionLevel;
  networkAccess: PermissionLevel;
  appLaunchAccess: PermissionLevel;

  // Storage / startup
  workspaceDir: string;
  startupSequence: boolean;
  startupInDeveloperMode: boolean;
  memoryEnabled: boolean;
};

export const DEFAULT_SETTINGS: AssistantSettings = {
  aiProvider: process.env.AI_PROVIDER ?? "openrouter",
  generalModel: process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini",
  developerModel:
    process.env.OPENROUTER_DEVELOPER_MODEL ?? "anthropic/claude-3.5-sonnet",
  reasoningModel:
    process.env.OPENROUTER_REASONING_MODEL ?? "openai/gpt-4o",
  fallbackModel:
    process.env.OPENROUTER_FALLBACK_MODEL ?? "meta-llama/llama-3.1-8b-instruct",
  temperature: 0.4,
  maxTokens: 1400,
  requestTimeoutMs: 60_000,
  autoAiMode: true,
  apiKeyOverride: "",

  voiceEnabled: true,
  voiceName: "",
  speechRate: 1.02,
  speechPitch: 0.85,
  speechVolume: 0.9,
  wakeWord: "mr00100",
  wakeWordEnabled: false,
  micEnabled: true,
  cameraEnabled: false,
  commandLanguage: "auto",

  theme: "green",
  animationIntensity: 0.85,
  particleDensity: 0.7,
  backgroundEffects: true,
  matrixRain: true,
  scanlines: true,
  soundEffects: true,
  soundVolume: 0.35,

  resourceGuard: true,
  cpuThreshold: 82,
  ramThreshold: 88,
  pollIntervalMs: 2500,

  terminalAccess: "CONFIRM",
  fileAccess: "SAFE",
  aiAccess: "CONFIRM",
  networkAccess: "SAFE",
  appLaunchAccess: "SAFE",

  workspaceDir: "",
  startupSequence: true,
  startupInDeveloperMode: false,
  memoryEnabled: true,
};

export const SYSTEM_PERSONA = `You are MR00100 AI — a personal desktop AI command center.
Identity: intelligent, calm, professional, futuristic, slightly cyberpunk.
Tagline: "YOUR SYSTEM. YOUR COMMAND."
Rules:
- Be concise for simple requests (1-3 sentences).
- Be detailed and rigorous for programming, debugging and architecture tasks.
- When you output code, always use fenced code blocks with a language tag, and
  when a file path is relevant start the fence info string with the path, e.g. \`\`\`ts src/app/page.tsx
- Never claim to have executed anything you did not execute. If an action needs
  the local tool layer (file write, terminal, launching apps), say exactly which
  action you propose and let the operator confirm it.
- Never invent system telemetry. Use only the telemetry provided in context.
- Flag clearly when an operation is potentially destructive.`;

export function maskKey(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return "••••";
  return `${key.slice(0, 6)}••••${key.slice(-4)}`;
}
