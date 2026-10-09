"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import NeuralBackground from "./NeuralBackground";
import GlobeCore from "./GlobeCore";
import BootSequence from "./BootSequence";
import Dock from "./Dock";
import ChatPanel from "./ChatPanel";
import FilesPanel from "./FilesPanel";
import TerminalPanel from "./TerminalPanel";
import SettingsPanel from "./SettingsPanel";
import { AiEngineHud, CommandTraceHud, EventFeed, HistoryHud, NetworkHud, ResourceGuardHud, SecurityHud, SystemMonitor } from "./hud";
import { ConfirmDialog, NoticeToast, Panel, Waveform } from "./ui";
import { bus, useStore, type PanelId } from "@/lib/client/store";
import { MicMeter, playCue } from "@/lib/client/audio";
import { getRecognition, speechLangFromSetting, stopSpeaking, type SpeechRecognitionLike } from "@/lib/client/voice";
import { executeCommand, refreshHistory } from "@/lib/client/pipeline";
import type { AssistantSettings } from "@/lib/config";
import type { Telemetry } from "@/lib/server/telemetry";

const DeveloperWorkspace = dynamic(() => import("./DeveloperWorkspace"), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/80">
      <span className="hud-label blink">LOADING DEVELOPER WORKSPACE…</span>
    </div>
  ),
});
const CameraPanel = dynamic(() => import("./aux-component").then((m) => m.CameraPanel), { ssr: false });
const MemoryPanel = dynamic(() => import("./aux-component").then((m) => m.MemoryPanel), { ssr: false });

export default function CommandCenter() {
  const booted = useStore((s) => s.booted);
  const setBooted = useStore((s) => s.setBooted);
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);
  const aiState = useStore((s) => s.aiState);
  const stateLabel = useStore((s) => s.stateLabel);
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const setSettingsMeta = useStore((s) => s.setSettingsMeta);
  const setTelemetry = useStore((s) => s.setTelemetry);
  const setQuality = useStore((s) => s.setQuality);
  const setAiState = useStore((s) => s.setAiState);
  const setMicLevel = useStore((s) => s.setMicLevel);
  const setModule = useStore((s) => s.setModule);
  const setTranscript = useStore((s) => s.setTranscript);
  const transcript = useStore((s) => s.transcript);
  const panels = useStore((s) => s.panels);
  const togglePanel = useStore((s) => s.togglePanel);
  const setAiEngine = useStore((s) => s.setAiEngine);
  const telemetry = useStore((s) => s.telemetry);
  const quality = useStore((s) => s.quality);
  const fps = useStore((s) => s.fps);

  const [voiceModeOn, setVoiceModeOn] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [clock, setClock] = useState("");
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const meterRef = useRef<MicMeter | null>(null);
  const prevOnline = useRef<boolean | null>(null);
  const alarmed = useRef({ cpu: false, ram: false });

  /* -------------------------------------------------------------- theme */
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);

  /* ------------------------------------------------------ load settings */
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/settings");
        const json = (await res.json()) as {
          ok: boolean;
          settings?: AssistantSettings & { _meta: { keyConfigured: boolean; keySource: string; keyMasked: string } };
          error?: string;
          reason?: string;
          action?: string;
        };
        if (!json.ok || !json.settings) {
          useStore.getState().setNotice({
            error: json.error ?? "CONFIGURATION UNAVAILABLE",
            reason: json.reason ?? "Settings store did not respond.",
            action: json.action ?? "Verify DATABASE_URL in .env, then reload.",
          });
          return;
        }
        const { _meta, ...rest } = json.settings;
        setSettings(rest);
        setSettingsMeta(_meta);
        setAiEngine({ status: _meta.keyConfigured ? "IDLE" : "OFFLINE", model: rest.generalModel });
        if (rest.startupInDeveloperMode) setMode("developer");
      } catch (error) {
        useStore.getState().setNotice({
          error: "CONFIGURATION UNAVAILABLE",
          reason: error instanceof Error ? error.message : "unknown",
          action: "Check that the MR00100 service and PostgreSQL are running.",
        });
      }
    })();
  }, [setSettings, setSettingsMeta, setAiEngine, setMode]);

  /* ---------------------------------------------------- telemetry poll */
  const liveRef = useRef({ quality, fps, settings });
  useEffect(() => {
    liveRef.current = { quality, fps, settings };
  }, [quality, fps, settings]);

  useEffect(() => {
    let timer: number;
    let stopped = false;

    const tick = async () => {
      const { quality: q, fps: currentFps, settings: cfg } = liveRef.current;
      try {
        const res = await fetch(`/api/system/stats?processes=${q === "low" ? 0 : 1}`);
        const json = (await res.json()) as { ok: boolean; telemetry?: Telemetry; reason?: string };
        if (!json.ok || !json.telemetry) {
          setTelemetry(null, json.reason ?? "telemetry unavailable");
        } else {
          const t = json.telemetry;
          setTelemetry(t, null);

          if (cfg.resourceGuard) {
            const stress = t.cpu.usage >= cfg.cpuThreshold || t.ram.usedPct >= cfg.ramThreshold;
            const lowFps = currentFps > 0 && currentFps < 26;
            setQuality(stress || lowFps ? (t.cpu.usage > 92 ? "low" : "medium") : "high");
          }

          if (t.cpu.usage >= cfg.cpuThreshold && !alarmed.current.cpu) {
            alarmed.current.cpu = true;
            bus.emit("CPU_HIGH", `CPU at ${t.cpu.usage.toFixed(0)}% — reducing animation load`, "warn", true);
          } else if (t.cpu.usage < cfg.cpuThreshold - 12) alarmed.current.cpu = false;

          if (t.ram.usedPct >= cfg.ramThreshold && !alarmed.current.ram) {
            alarmed.current.ram = true;
            bus.emit("RAM_HIGH", `Memory at ${t.ram.usedPct.toFixed(0)}%`, "warn", true);
          } else if (t.ram.usedPct < cfg.ramThreshold - 8) alarmed.current.ram = false;

          if (prevOnline.current !== null && prevOnline.current !== t.network.online) {
            bus.emit(
              "NETWORK_CHANGED",
              t.network.online ? "Link re-established" : "Network link lost",
              t.network.online ? "success" : "error",
              true,
            );
          }
          prevOnline.current = t.network.online;
          setModule("network", t.network.online);
        }
      } catch (error) {
        setTelemetry(null, error instanceof Error ? error.message : "telemetry request failed");
      }
      if (!stopped) timer = window.setTimeout(tick, Math.max(1200, liveRef.current.settings.pollIntervalMs));
    };

    void tick();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [setTelemetry, setQuality, setModule]);

  /* ------------------------------------------------------ history poll */
  useEffect(() => {
    void refreshHistory();
    const t = window.setInterval(() => void refreshHistory(), 12000);
    return () => window.clearInterval(t);
  }, []);

  /* ------------------------------------------------------------- clock */
  useEffect(() => {
    const t = window.setInterval(() => setClock(new Date().toLocaleTimeString()), 1000);
    return () => window.clearInterval(t);
  }, []);

  /* ------------------------------------------------ persistent voice mode */
  useEffect(() => {
    if (!voiceModeOn) return;

    if (!settings.micEnabled) {
      const timer = window.setTimeout(() => {
        setVoiceError("Microphone disabled in Settings → Voice.");
        setVoiceModeOn(false);
      }, 0);
      return () => window.clearTimeout(timer);
    }

    let cancelled = false;
    let processing = false;
    let restartTimer = 0;
    let restartFailures = 0;
    let intentionalCycleStop = false;

    const clearRestart = () => {
      if (restartTimer) window.clearTimeout(restartTimer);
      restartTimer = 0;
    };

    const scheduleRestart = (delay = 450) => {
      if (cancelled || !voiceModeOn) return;
      clearRestart();
      restartTimer = window.setTimeout(() => void startCycle(), delay);
    };

    const startCycle = async () => {
      if (cancelled || !voiceModeOn || processing || recRef.current) return;
      const state = useStore.getState().aiState;
      if (["speaking", "thinking", "searching", "executing", "warning"].includes(state)) {
        scheduleRestart(350);
        return;
      }

      const rec = getRecognition(speechLangFromSetting(settings.commandLanguage));
      if (!rec) {
        setVoiceError("Speech recognition is unavailable in this browser. Use Chrome or Edge.");
        useStore.getState().setNotice({
          error: "SPEECH RECOGNITION UNAVAILABLE",
          reason: "This browser does not expose the Web Speech API.",
          action: "Use Chrome/Edge for persistent voice, or type commands in chat.",
        });
        setVoiceModeOn(false);
        return;
      }

      intentionalCycleStop = false;
      recRef.current = rec;
      rec.continuous = false;
      rec.interimResults = true;
      rec.onstart = () => {
        if (cancelled) return;
        restartFailures = 0;
        setListening(true);
        setVoiceError(null);
        setAiState("listening", "LISTENING");
        setModule("voice", true);
        bus.emit("VOICE_STARTED", "persistent voice cycle ready", "info");
      };
      rec.onresult = (e) => {
        if (cancelled || processing) return;
        let interim = "";
        let final = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const result = e.results[i];
          if (result.isFinal) final += result[0].transcript;
          else interim += result[0].transcript;
        }
        setTranscript(final || interim);
        if (!final.trim()) return;

        const text = final.trim();
        const requiresWake = settings.wakeWordEnabled;
        const wake = settings.wakeWord.toLowerCase().replace(/\s+/g, "");
        const normalized = text.toLowerCase().replace(/\s+/g, "");
        intentionalCycleStop = true;
        processing = true;
        setListening(false);
        setAiState("thinking", "PROCESSING");
        try {
          rec.stop();
        } catch {
          /* recognition may already be ending */
        }

        if (requiresWake && !normalized.startsWith(wake)) {
          processing = false;
          bus.emit("VOICE_IGNORED", `wake word missing: "${text.slice(0, 40)}"`, "warn");
          scheduleRestart(350);
          return;
        }

        void executeCommand(text, "voice").finally(() => {
          processing = false;
          // TTS may still be speaking. startCycle waits until it finishes.
          scheduleRestart(350);
        });
      };
      rec.onerror = (event) => {
        if (cancelled) return;
        setListening(false);
        const expected = intentionalCycleStop && event.error === "aborted";
        const silence = event.error === "no-speech" || event.error === "aborted";
        if (!expected && !silence) {
          setVoiceError(`Speech recognition error: ${event.error}`);
          bus.emit("VOICE_ERROR", event.error, "error");
        }
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
          useStore.getState().setNotice({
            error: "MICROPHONE PERMISSION DENIED",
            reason: `Speech recognition reported ${event.error}.`,
            action: "Allow microphone access in Chrome/Edge, then enable voice mode again.",
          });
          setVoiceModeOn(false);
        }
      };
      rec.onend = () => {
        if (recRef.current === rec) recRef.current = null;
        setListening(false);
        if (cancelled || !voiceModeOn) return;
        if (!processing) {
          restartFailures += 1;
          scheduleRestart(Math.min(1800, 300 + restartFailures * 180));
        }
      };

      try {
        rec.start();
      } catch (error) {
        if (recRef.current === rec) recRef.current = null;
        restartFailures += 1;
        if (!cancelled) {
          setVoiceError(`Recognition restart delayed (${error instanceof Error ? error.message : "busy"}).`);
          scheduleRestart(Math.min(2200, 500 + restartFailures * 250));
        }
      }
    };

    const enable = async () => {
      stopSpeaking();
      setVoiceError(null);
      try {
        const meter = new MicMeter();
        await meter.start((level) => setMicLevel(level));
        if (cancelled) {
          meter.stop();
          return;
        }
        meterRef.current = meter;
        playCue("notify", settings.soundVolume, settings.soundEffects);
        bus.emit("VOICE_MODE_ON", "persistent voice mode enabled", "success");
        await startCycle();
      } catch (error) {
        if (cancelled) return;
        setVoiceError(`Microphone permission denied (${error instanceof Error ? error.message : "unknown"}).`);
        useStore.getState().setNotice({
          error: "MICROPHONE UNAVAILABLE",
          reason: error instanceof Error ? error.message : "Microphone access failed.",
          action: "Allow microphone access in Chrome/Edge, then toggle MIC again.",
        });
        setVoiceModeOn(false);
      }
    };

    void enable();
    return () => {
      cancelled = true;
      clearRestart();
      const rec = recRef.current;
      recRef.current = null;
      if (rec) {
        rec.onstart = null;
        rec.onresult = null;
        rec.onerror = null;
        rec.onend = null;
        try {
          rec.abort();
        } catch {
          /* already stopped */
        }
      }
      meterRef.current?.stop();
      meterRef.current = null;
      setListening(false);
      setMicLevel(0);
      setModule("voice", false);
      bus.emit("VOICE_MODE_OFF", "persistent voice mode disabled", "info");
    };
  }, [voiceModeOn, settings.micEnabled, settings.commandLanguage, settings.soundEffects, settings.soundVolume, settings.wakeWord, settings.wakeWordEnabled, setAiState, setMicLevel, setModule, setTranscript]);

  const toggleMic = useCallback(() => {
    if (voiceModeOn) {
      stopSpeaking();
      setVoiceModeOn(false);
      setAiState("idle", "STANDBY");
    } else {
      setVoiceModeOn(true);
    }
  }, [voiceModeOn, setAiState]);

  /* ------------------------------------------------------- keybindings */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = ["INPUT", "TEXTAREA"].includes((e.target as HTMLElement)?.tagName ?? "");
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "m") {
        e.preventDefault();
        toggleMic();
      }
      if (e.key === "Escape" && !typing) {
        const open = (Object.keys(panels) as PanelId[]).filter((p) => panels[p]);
        if (open.length) togglePanel(open[open.length - 1], false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleMic, panels, togglePanel]);

  const openPanels = useMemo(
    () => (Object.keys(panels) as PanelId[]).filter((p) => panels[p]),
    [panels],
  );

  const stateColor =
    aiState === "error" || aiState === "warning"
      ? "rgb(var(--mr-danger))"
      : aiState === "idle"
        ? "var(--mr-dim)"
        : "rgb(var(--mr-accent))";

  if (!booted && settings.startupSequence) {
    return (
      <>
        <NeuralBackground />
        <BootSequence
          onDone={() => {
            setBooted(true);
            bus.emit("SYSTEM_ONLINE", "MR00100 AI interface ready", "success");
          }}
        />
      </>
    );
  }

  /* ------------------------------------------------------------ mini mode */
  if (mode === "mini") {
    return (
      <>
        <NeuralBackground />
        <div className="relative z-10 flex h-screen items-center justify-center p-4">
          <div className="holo w-[320px] p-3">
            <div className="holo-scan" />
            <div className="flex items-center justify-between">
              <span className="accent glow text-[11px] tracking-[0.25em]">MR00100</span>
              <button type="button" className="btn px-1.5 py-0.5 text-[9px]" onClick={() => setMode("command")}>
                EXPAND
              </button>
            </div>
            <div className="mx-auto my-2 h-[150px] w-[150px]">
              <GlobeCore compact />
            </div>
            <div className="mono-xs text-center" style={{ color: stateColor }}>
              {stateLabel}
            </div>
            <Waveform height={28} />
            <div className="mono-xs mt-1 flex justify-between">
              <span className="dim">CPU {telemetry?.cpu.usage.toFixed(0) ?? "--"}%</span>
              <span className="dim">RAM {telemetry?.ram.usedPct.toFixed(0) ?? "--"}%</span>
            </div>
            <button
              type="button"
              className="btn mt-2 w-full py-1.5 text-[10px]"
              onClick={toggleMic}
              style={voiceModeOn ? { borderColor: "rgba(var(--mr-accent),0.7)", color: "rgb(var(--mr-accent))" } : undefined}
            >
              {voiceModeOn ? (listening ? "◉ MIC ACTIVE · LISTENING — TAP TO STOP" : "◉ MIC ACTIVE — TAP TO STOP") : "◉ MIC OFF — TAP TO ENABLE"}
            </button>
          </div>
        </div>
        <ConfirmDialog />
        <NoticeToast />
      </>
    );
  }

  /* -------------------------------------------------------- developer mode */
  if (mode === "developer") {
    return (
      <>
        <NeuralBackground />
        {settings.scanlines ? <div className="scanline-overlay" /> : null}
        <DeveloperWorkspace />
        <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center pb-1">
          <Dock onMic={toggleMic} voiceActive={voiceModeOn} listening={listening} />
        </div>
        <ConfirmDialog />
        <NoticeToast />
      </>
    );
  }

  return (
    <>
      <NeuralBackground />
      {settings.scanlines ? <div className="scanline-overlay" /> : null}
      <div className="vignette" />

      <div className="relative z-10 flex h-screen flex-col gap-2 p-2">
        {/* ------------------------------------------------------- top bar */}
        <header className="holo flex shrink-0 items-center gap-3 px-3 py-1.5">
          <div className="flex items-baseline gap-2">
            <span className="accent glow text-[15px] leading-none tracking-[0.3em]">MR00100</span>
            <span className="dim text-[15px] leading-none tracking-[0.3em]">AI</span>
          </div>
          <span className="hud-label hide-md">YOUR SYSTEM. YOUR COMMAND.</span>
          <span className="mono-xs ml-auto flex items-center gap-2">
            <span style={{ color: stateColor }}>● {stateLabel}</span>
            <span className="dim hide-md">{quality.toUpperCase()}/{fps}FPS</span>
            <span className="dim tabular-nums">{clock}</span>
          </span>
          <button type="button" className="btn px-2 py-0.5 text-[9px]" onClick={() => setMode("mini")}>
            MINI
          </button>
        </header>

        <div className="flex min-h-0 flex-1 gap-2">
          {/* --------------------------------------------------- left rail */}
          <aside className="hide-md flex w-[236px] shrink-0 flex-col gap-2">
            <AiEngineHud />
            <SecurityHud />
            <NetworkHud />
            <ResourceGuardHud />
            <EventFeed />
          </aside>

          {/* ------------------------------------------------------- core */}
          <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
            <div className="relative min-h-0 flex-1">
              <GlobeCore />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-1 pb-1">
                <CommandTraceHud />
                <div className="w-[min(420px,80%)]">
                  <Waveform height={40} />
                </div>
                <div className="mono-xs text-center" style={{ color: stateColor }}>
                  {listening
                    ? "◉ MIC ACTIVE · LISTENING"
                    : voiceModeOn
                      ? aiState === "speaking"
                        ? "▮ MIC ACTIVE · SPEAKING"
                        : aiState === "searching"
                          ? "⌁ MIC ACTIVE · SEARCHING"
                          : "◌ MIC ACTIVE · PROCESSING"
                      : "MIC OFF"}
                </div>
                {transcript ? (
                  <div className="holo pointer-events-auto max-w-[min(640px,92%)] px-3 py-1 text-[11px]">
                    {transcript}
                  </div>
                ) : null}
                {voiceError ? (
                  <div className="mono-xs max-w-[min(640px,92%)] text-center" style={{ color: "rgb(var(--mr-warn))" }}>
                    {voiceError}
                  </div>
                ) : null}
              </div>
              <div className="pointer-events-none absolute left-0 top-0 max-w-[220px]">
                <div className="hud-label">CORE STATE</div>
                <div className="text-[11px]" style={{ color: stateColor }}>
                  {stateLabel}
                </div>
                <div className="dim mono-xs mt-1">
                  {telemetry ? `${telemetry.host.hostname} · ${telemetry.host.platform}` : "acquiring host…"}
                </div>
              </div>
            </div>

            {/* ------------------------------------------------ panel deck */}
            {openPanels.length ? (
              <div className="flex h-[46%] min-h-[220px] shrink-0 gap-2 overflow-x-auto">
                {openPanels.map((p) => {
                  const close = () => togglePanel(p, false);
                  const cls = "h-full w-[min(430px,86vw)] shrink-0";
                  if (p === "chat") return <ChatPanel key={p} className={cls} onClose={close} />;
                  if (p === "files")
                    return (
                      <FilesPanel
                        key={p}
                        className={cls}
                        onClose={close}
                        onOpenFile={(path) => {
                          useStore.getState().setActiveFile(path);
                          setMode("developer");
                        }}
                      />
                    );
                  if (p === "terminal") return <TerminalPanel key={p} className={cls} onClose={close} />;
                  if (p === "settings") return <SettingsPanel key={p} className={cls} onClose={close} />;
                  if (p === "memory") return <MemoryPanel key={p} className={cls} onClose={close} />;
                  if (p === "camera") return <CameraPanel key={p} className={cls} onClose={close} />;
                  if (p === "history")
                    return (
                      <div key={p} className={cls}>
                        <HistoryHud full onClose={close} />
                      </div>
                    );
                  if (p === "system")
                    return (
                      <div key={p} className={cls}>
                        <SystemMonitor onClose={close} />
                      </div>
                    );
                  if (p === "security")
                    return (
                      <Panel key={p} title="SECURITY CENTER" className={cls} onClose={close}>
                        <div className="p-2">
                          <SecurityHud />
                          <div className="dim mono-xs mt-2 leading-relaxed">
                            Adjust permission levels in Settings → Security Center. Every CONFIRM action
                            raises an explicit authorization dialog that states exactly what will happen.
                          </div>
                        </div>
                      </Panel>
                    );
                  return null;
                })}
              </div>
            ) : null}
          </main>

          {/* -------------------------------------------------- right rail */}
          <aside className="hide-md flex w-[260px] shrink-0 flex-col gap-2">
            <SystemMonitor />
            <HistoryHud />
          </aside>
        </div>

        <Dock onMic={toggleMic} voiceActive={voiceModeOn} listening={listening} />
      </div>

      <ConfirmDialog />
      <NoticeToast />
    </>
  );
}
