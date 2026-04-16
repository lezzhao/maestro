import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, X, Cpu, Terminal, Loader2 } from "lucide-react";
import { invoke, Channel } from "@tauri-apps/api/core";
import { Waveform } from "./Waveform";
import { useAppStore } from "../../stores/appStore";
import { useTranslation } from "../../i18n";
import { cn } from "../../lib/utils";

export const JiavisHUD: React.FC = () => {
  const { t } = useTranslation();
  const engines = useAppStore(state => state.engines);
  const activeEngineId = Object.keys(engines).find(id => engines[id].api_key) || "openai";

  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState(t("hud_system_nominal"));
  const [transcription, setTranscription] = useState("");
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [pendingVision, setPendingVision] = useState<string | null>(null);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];

      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        await processAudio(blob);
      };

      recorder.start();
      setMediaRecorder(recorder);
      setIsListening(true);
      setStatus("LISTENING...");
      setTranscription("");
    } catch (err) {
      console.error("Failed to start recording:", err);
      setStatus("ERROR: MIC ACCESS DENIED");
    }
  };

  const stopRecording = () => {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
      setMediaRecorder(null);
      setIsListening(false);
      setStatus("PROCESSING...");
    }
  };

  const processAudio = async (blob: Blob) => {
    setIsProcessing(true);
    try {
      // 1. Convert to Base64
      const reader = new FileReader();
      reader.readAsDataURL(blob);
      reader.onloadend = async () => {
        const base64data = (reader.result as string).split(',')[1];
        
        // 2. Transcribe
        setStatus("TRANSCRIBING...");
        const text: string = await invoke("voice_transcribe", {
          engineId: activeEngineId,
          audioBase64: base64data
        });
        setTranscription(text);
        
        // 3. Execute Real Agent Command
        setStatus("EXECUTING...");
        
        const attachments = pendingVision ? [{
          name: "screenshot.png",
          path: "upload://jiavis-vision.png",
          mime_type: "image/png",
          data: pendingVision
        }] : undefined;

        const onData = new Channel<string>();
        onData.onmessage = (chunk) => {
           console.log("Agent stream:", chunk);
        };

        await invoke("chat_execute_api", {
          request: {
            engine_id: activeEngineId,
            messages: [{
              role: "user",
              content: text,
              attachments: attachments
            }]
          },
          onData
        });

        // 4. TTS (Confirming Action)
        setStatus("COMMAND DISPATCHED");
        const speechBase64: string = await invoke("voice_speech", {
          engineId: activeEngineId,
          text: `Acknowledged. Task initiated in current workspace.`,
          voice: "alloy"
        });
        
        const audio = new Audio(`data:audio/mp3;base64,${speechBase64}`);
        audio.play();

        setPendingVision(null);
        
        // 5. Auto-dismiss HUD after complete
        setTimeout(async () => {
          const { getCurrentWindow } = await import("@tauri-apps/api/window");
          const appWindow = getCurrentWindow();
          await appWindow.hide();
          setStatus(t("hud_system_nominal"));
          setIsProcessing(false);
          setTranscription("");
        }, 2500);
      };
    } catch (err) {
      console.error("Voice process error:", err);
      setStatus("SYSTEM ERROR");
      setIsProcessing(false);
    }
  };

  const captureVision = async () => {
    setStatus("CAPTURING SCREEN...");
    try {
      const b64 = await invoke("vision_capture_screen");
      setPendingVision(b64 as string);
      setStatus("EYES ON TARGET");
      setTimeout(() => setStatus("SYSTEM NOMINAL"), 1500);
    } catch (e) {
      setStatus("VISION ERROR");
    }
  };

  const toggleListen = () => {
    if (isListening) {
      stopRecording();
    } else if (!isProcessing) {
      startRecording();
    }
  };

  return (
    <div className="w-screen h-screen flex items-center justify-center pointer-events-none overflow-hidden select-none font-sans">
      <motion.div 
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="w-[500px] h-[360px] rounded-[40px] border border-hud-primary/20 bg-background/80 backdrop-blur-[40px] shadow-[0_0_80px_rgba(30,58,138,0.3)] pointer-events-auto flex flex-col items-center justify-between relative overflow-hidden"
      >
        {/* Glow Effects */}
        <div className="absolute inset-0 bg-gradient-to-b from-blue-500/5 to-transparent pointer-events-none" />
        <div className="absolute -top-24 -left-24 w-48 h-48 bg-blue-600/10 blur-[80px] rounded-full" />
        <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-cyan-600/10 blur-[80px] rounded-full" />

        {/* HUD Content */}
        <div className="p-8 flex flex-col items-center gap-8 w-full">
          {/* Top Info Bar */}
          <div className="w-full flex justify-between items-center text-[10px] uppercase tracking-[0.2em] text-hud-primary/40 font-mono">
             <div className="flex items-center gap-2">
                <div className={`w-1.5 h-1.5 rounded-full ${pendingVision ? 'bg-hud-accent animate-pulse' : 'bg-hud-primary/20'}`} />
                <span>Camera: {pendingVision ? 'ACTIVE' : 'READY'}</span>
             </div>
             <div className="flex items-center gap-2">
                <Cpu size={12} className={isProcessing ? "animate-spin" : ""} />
                <span>{t("hud_neural_maestro")}</span>
             </div>
          </div>

          {/* Main Controls Overlay */}
          <div className="flex items-center gap-12 mt-4 relative z-10">
             {/* Left Action: Vision */}
              <div className="flex flex-col items-center gap-2">
                <motion.button 
                  whileHover={{ scale: 1.1, backgroundColor: "rgba(34, 211, 238, 0.1)" }}
                  whileTap={{ scale: 0.9 }}
                  onClick={captureVision}
                  className={`p-4 rounded-2xl border transition-all duration-300 ${pendingVision ? 'border-hud-accent/50 bg-hud-accent/10 text-hud-accent shadow-[0_0_15px_rgba(34,211,238,0.3)]' : 'border-hud-primary/20 bg-hud-primary/5 text-hud-primary/60'}`}
                >
                  <Terminal size={22} />
                </motion.button>
                <span className="text-[9px] uppercase tracking-tighter text-hud-primary/30 font-bold">{t("hud_vision")}</span>
             </div>

             {/* Center: Mic & Waveform */}
             <div className="flex flex-col items-center">
                <motion.button 
                  animate={{ 
                    boxShadow: isListening 
                      ? ["0 0 20px rgba(59,130,246,0.2)", "0 0 50px rgba(59,130,246,0.6)", "0 0 20px rgba(59,130,246,0.2)"]
                      : "0 0 5px rgba(59,130,246,0.1)"
                  }}
                  transition={{ repeat: Infinity, duration: 2 }}
                  className={`p-7 rounded-full border-2 transition-all duration-500 ${isListening ? 'border-hud-primary bg-hud-primary/20' : 'border-hud-primary/30 bg-hud-primary/5'}`}
                  onClick={toggleListen}
                >
                  {isProcessing ? (
                    <Loader2 size={44} className="text-hud-accent animate-spin" />
                  ) : (
                    <Mic size={44} className={isListening ? 'text-hud-primary' : 'text-hud-primary/20'} />
                  )}
                </motion.button>
                 <div className="mt-6 flex flex-col items-center gap-3">
                   <Waveform isListening={isListening || isProcessing} color={isProcessing ? "hsl(var(--hud-accent))" : "hsl(var(--hud-primary))"} />
                   <span className={cn(
                     "text-xs font-mono font-bold tracking-[0.3em] uppercase transition-all duration-500",
                     isListening ? "text-hud-primary" : isProcessing ? "text-hud-accent" : "text-hud-primary/80 animate-pulse"
                   )}>
                     {status}
                   </span>
                </div>
              </div>

              {/* Right Action: Close */}
              <div className="flex flex-col items-center gap-2">
                <motion.button 
                  whileHover={{ scale: 1.1, backgroundColor: "rgba(244, 63, 94, 0.1)" }}
                  whileTap={{ scale: 0.9 }}
                  onClick={async () => {
                    const { getCurrentWindow } = await import("@tauri-apps/api/window");
                    await getCurrentWindow().hide();
                  }}
                  className="p-4 rounded-2xl border border-hud-error/20 bg-hud-error/5 text-hud-error/40 hover:text-hud-error hover:border-hud-error/40 transition-colors"
                >
                  <X size={22} />
                </motion.button>
                <span className="text-[9px] uppercase tracking-tighter text-hud-error/30 font-bold">{t("hud_close")}</span>
             </div>
          </div>

          {/* Bottom Feedback Area */}
          <AnimatePresence>
            {transcription && (
              <motion.div 
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="w-full px-6 py-4 bg-hud-primary/5 border border-hud-primary/10 rounded-[24px] mt-2 backdrop-blur-md"
              >
                <div className="flex items-start gap-3">
                   <Terminal size={12} className="text-hud-primary/60 mt-0.5 shrink-0" />
                   <p className="text-[11px] text-blue-100/70 font-mono leading-relaxed italic">
                      {transcription}
                   </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* HUD Border Accents */}
        <div className="absolute top-0 left-0 w-12 h-12 border-t-2 border-l-2 border-hud-primary/30 rounded-tl-[40px] pointer-events-none" />
        <div className="absolute top-0 right-0 w-12 h-12 border-t-2 border-r-2 border-hud-primary/30 rounded-tr-[40px] pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-12 h-12 border-b-2 border-l-2 border-hud-primary/30 rounded-bl-[40px] pointer-events-none" />
        <div className="absolute bottom-0 right-0 w-12 h-12 border-b-2 border-r-2 border-hud-primary/30 rounded-br-[40px] pointer-events-none" />
      </motion.div>
    </div>
  );
};
