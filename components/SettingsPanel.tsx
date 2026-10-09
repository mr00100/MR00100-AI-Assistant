"use client";

import { useEffect, useState } from "react";
import { Panel, Row } from "./ui";
import { useStore } from "@/lib/client/store";
import type { AssistantSettings, PermissionLevel } from "@/lib/config";
import { listVoices, speechSupported } from "@/lib/client/voice";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-[color:var(--mr-border)] px-3 py-2 first:border-t-0">
      <div className="hud-label glow mb-2">{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <div className="flex items-center justify-between gap-2">
        <span className="mono-xs dim">{label}</span>
        {children}
      </div>
      {hint ? <div className="dim mono-xs mt-0.5 opacity-70">{hint}</div> : null}
    </label>
  );
}

const LEVELS: PermissionLevel[] = ["SAFE", "CONFIRM", "BLOCK"];

export default function SettingsPanel({ onClose, className = "" }: { onClose?: () => void; className?: string }) {
  const settings = useStore((s) => s.settings);
  const meta = useStore((s) => s.settingsMeta);
  const setSettings = useStore((s) => s.setSettings);
  const setSettingsMeta = useStore((s) => s.setSettingsMeta);
  const setNotice = useStore((s) => s.setNotice);
  const [models, setModels] = useState<string[]>([]);
  const [voices, setVoices] = useState<string[]>([]);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const support = speechSupported();

  useEffect(() => {
    void fetch("/api/ai/models")
      .then((r) => r.json())
      .then((j: { ok: boolean; models?: string[] }) => setModels(j.models ?? []))
      .catch(() => null);
    const load = () => setVoices(listVoices().map((v) => v.name));
    load();
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = load;
    }
  }, []);

  const patch = async (p: Partial<AssistantSettings>) => {
    setSettings(p);
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(p),
      });
      const json = (await res.json()) as {
        ok: boolean;
        settings?: AssistantSettings & { _meta: { keyConfigured: boolean; keySource: string; keyMasked: string } };
        error?: string;
        reason?: string;
        action?: string;
      };
      if (!json.ok) {
        setNotice({ error: json.error ?? "SETTINGS SAVE FAILED", reason: json.reason ?? "", action: json.action ?? "Retry." });
        return;
      }
      if (json.settings?._meta) setSettingsMeta(json.settings._meta);
    } finally {
      setSaving(false);
    }
  };

  const modelField = (key: keyof AssistantSettings, label: string) => (
    <Field label={label}>
      <input
        list="mr-models"
        value={String(settings[key] ?? "")}
        onChange={(e) => void patch({ [key]: e.target.value } as Partial<AssistantSettings>)}
        className="w-[58%] px-1.5 py-0.5 text-[10px]"
      />
    </Field>
  );

  const num = (key: keyof AssistantSettings, label: string, min: number, max: number, step = 1, hint?: string) => (
    <Field label={label} hint={hint}>
      <span className="flex items-center gap-2">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={Number(settings[key] ?? 0)}
          onChange={(e) => void patch({ [key]: Number(e.target.value) } as Partial<AssistantSettings>)}
          className="w-28 accent-[rgb(var(--mr-accent))]"
        />
        <span className="mono-xs w-10 text-right tabular-nums">{Number(settings[key] ?? 0)}</span>
      </span>
    </Field>
  );

  const toggle = (key: keyof AssistantSettings, label: string, hint?: string) => (
    <Field label={label} hint={hint}>
      <button
        type="button"
        className="btn px-2 py-0.5 text-[9px]"
        onClick={() => void patch({ [key]: !settings[key] } as Partial<AssistantSettings>)}
        style={settings[key] ? { borderColor: "rgba(var(--mr-accent),0.6)", color: "rgb(var(--mr-accent))" } : undefined}
      >
        {settings[key] ? "ON" : "OFF"}
      </button>
    </Field>
  );

  const perm = (key: keyof AssistantSettings, label: string) => (
    <Field label={label}>
      <select
        value={String(settings[key])}
        onChange={(e) => void patch({ [key]: e.target.value as PermissionLevel } as Partial<AssistantSettings>)}
        className="w-28 px-1 py-0.5 text-[10px]"
      >
        {LEVELS.map((l) => (
          <option key={l} value={l}>
            {l === "SAFE" ? "ALLOWED" : l === "CONFIRM" ? "CONFIRMATION" : "BLOCKED"}
          </option>
        ))}
      </select>
    </Field>
  );

  return (
    <Panel
      title="SETTINGS"
      onClose={onClose}
      className={className}
      right={<span className="dim mono-xs">{saving ? "SAVING…" : "SYNCED"}</span>}
    >
      <datalist id="mr-models">
        {models.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>

      <Section title="AI PROVIDER">
        <Field label="PROVIDER">
          <select
            value={settings.aiProvider}
            onChange={(e) => void patch({ aiProvider: e.target.value })}
            className="w-[58%] px-1 py-0.5 text-[10px]"
          >
            <option value="openrouter">openrouter</option>
          </select>
        </Field>
        <Row
          label="API KEY"
          value={meta.keyConfigured ? `${meta.keySource.toUpperCase()} · ${meta.keyMasked}` : "NOT CONFIGURED"}
          state={meta.keyConfigured ? "ok" : "err"}
        />
        {process.env.NEXT_PUBLIC_HIDE_KEY_INPUT ? null : (
          <div className="flex gap-1">
            <input
              type="password"
              value={apiKey}
              placeholder="sk-or-… (stored locally in your database)"
              onChange={(e) => setApiKey(e.target.value)}
              className="min-w-0 flex-1 px-1.5 py-0.5 text-[10px]"
            />
            <button
              type="button"
              className="btn px-2 py-0.5 text-[9px]"
              disabled={!apiKey.trim()}
              onClick={() => {
                void patch({ apiKeyOverride: apiKey.trim() });
                setApiKey("");
              }}
            >
              STORE
            </button>
          </div>
        )}
        {modelField("generalModel", "GENERAL MODEL")}
        {modelField("developerModel", "DEVELOPER MODEL")}
        {modelField("reasoningModel", "REASONING MODEL")}
        {modelField("fallbackModel", "FALLBACK MODEL")}
        <Field label="TEMPERATURE">
          <span className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={settings.temperature}
              onChange={(e) => void patch({ temperature: Number(e.target.value) })}
              className="w-28 accent-[rgb(var(--mr-accent))]"
            />
            <span className="mono-xs w-10 text-right tabular-nums">{settings.temperature.toFixed(2)}</span>
          </span>
        </Field>
        {num("maxTokens", "MAX TOKENS", 256, 8000, 128)}
        {num("requestTimeoutMs", "TIMEOUT (MS)", 10000, 180000, 5000)}
        {toggle("autoAiMode", "AUTO AI MODE", "Route cognitive requests to the heavy engine automatically.")}
      </Section>

      <Section title="VOICE">
        {toggle("voiceEnabled", "SPEECH OUTPUT")}
        {toggle("micEnabled", "MICROPHONE")}
        <Field label="COMMAND LANGUAGE" hint="Voice recognition and command parsing. Auto covers English and Roman Urdu.">
          <select
            value={settings.commandLanguage}
            onChange={(e) => void patch({ commandLanguage: e.target.value as AssistantSettings["commandLanguage"] })}
            className="w-[58%] px-1 py-0.5 text-[10px]"
          >
            <option value="auto">auto (en + roman urdu)</option>
            <option value="en">english</option>
            <option value="ur">urdu</option>
            <option value="roman">roman urdu / mixed</option>
          </select>
        </Field>
        <Field label="VOICE">
          <select
            value={settings.voiceName}
            onChange={(e) => void patch({ voiceName: e.target.value })}
            className="w-[58%] px-1 py-0.5 text-[10px]"
          >
            <option value="">system default</option>
            {voices.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="SPEECH RATE">
          <span className="flex items-center gap-2">
            <input
              type="range"
              min={0.5}
              max={2}
              step={0.02}
              value={settings.speechRate}
              onChange={(e) => void patch({ speechRate: Number(e.target.value) })}
              className="w-28 accent-[rgb(var(--mr-accent))]"
            />
            <span className="mono-xs w-10 text-right tabular-nums">{settings.speechRate.toFixed(2)}</span>
          </span>
        </Field>
        <Field label="WAKE WORD">
          <input
            value={settings.wakeWord}
            onChange={(e) => void patch({ wakeWord: e.target.value })}
            className="w-[58%] px-1.5 py-0.5 text-[10px]"
          />
        </Field>
        {toggle("wakeWordEnabled", "WAKE WORD REQUIRED", "Ignore speech that does not start with the wake word.")}
        <Row label="STT SUPPORT" value={support.stt ? "AVAILABLE" : "UNSUPPORTED BROWSER"} state={support.stt ? "ok" : "err"} />
        <Row label="TTS SUPPORT" value={support.tts ? "AVAILABLE" : "UNSUPPORTED BROWSER"} state={support.tts ? "ok" : "err"} />
      </Section>

      <Section title="INTERFACE">
        <Field label="THEME">
          <select
            value={settings.theme}
            onChange={(e) => void patch({ theme: e.target.value as AssistantSettings["theme"] })}
            className="w-28 px-1 py-0.5 text-[10px]"
          >
            <option value="green">neural green</option>
            <option value="cyan">ice cyan</option>
            <option value="amber">amber alert</option>
          </select>
        </Field>
        <Field label="ANIMATION INTENSITY">
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={settings.animationIntensity}
            onChange={(e) => void patch({ animationIntensity: Number(e.target.value) })}
            className="w-28 accent-[rgb(var(--mr-accent))]"
          />
        </Field>
        <Field label="PARTICLE DENSITY">
          <input
            type="range"
            min={0.1}
            max={1}
            step={0.05}
            value={settings.particleDensity}
            onChange={(e) => void patch({ particleDensity: Number(e.target.value) })}
            className="w-28 accent-[rgb(var(--mr-accent))]"
          />
        </Field>
        {toggle("backgroundEffects", "BACKGROUND EFFECTS")}
        {toggle("matrixRain", "DIGITAL RAIN")}
        {toggle("scanlines", "SCANLINES")}
        {toggle("soundEffects", "SOUND EFFECTS")}
        <Field label="SOUND VOLUME">
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={settings.soundVolume}
            onChange={(e) => void patch({ soundVolume: Number(e.target.value) })}
            className="w-28 accent-[rgb(var(--mr-accent))]"
          />
        </Field>
      </Section>

      <Section title="RESOURCE GUARD">
        {toggle("resourceGuard", "ADAPTIVE PERFORMANCE", "Automatically drop visual quality when the host is under load.")}
        {num("cpuThreshold", "CPU THRESHOLD %", 40, 99)}
        {num("ramThreshold", "RAM THRESHOLD %", 40, 99)}
        {num("pollIntervalMs", "POLL INTERVAL MS", 1000, 15000, 500)}
      </Section>

      <Section title="SECURITY CENTER">
        {perm("aiAccess", "AI ACCESS")}
        {perm("fileAccess", "FILE ACCESS")}
        {perm("terminalAccess", "TERMINAL ACCESS")}
        {perm("appLaunchAccess", "APP LAUNCH")}
        {perm("networkAccess", "NETWORK")}
        <div className="dim mono-xs leading-relaxed">
          Destructive patterns (root deletion, disk formatting, credential access, persistence,
          reverse shells) remain permanently blocked regardless of these settings.
        </div>
      </Section>

      <Section title="STORAGE & STARTUP">
        <Row label="WORKSPACE" value={settings.workspaceDir || "…"} />
        {toggle("startupSequence", "CINEMATIC STARTUP")}
        {toggle("startupInDeveloperMode", "BOOT INTO DEVELOPER MODE")}
        {toggle("memoryEnabled", "LOCAL MEMORY")}
        {toggle("cameraEnabled", "CAMERA MODULE", "Camera stays off until you explicitly start it.")}
      </Section>
    </Panel>
  );
}
