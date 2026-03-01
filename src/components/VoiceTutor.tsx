import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Mic, MicOff, Volume2, VolumeX, Loader2, BrainCircuit, X, MessageSquare, Terminal, Camera, Scan, Sparkles } from 'lucide-react';
import { GoogleGenAI, Modality, LiveServerMessage } from "@google/genai";

type Message = {
  role: 'user' | 'model';
  text: string;
  image?: string;
};

export default function VoiceTutor() {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [showDebug, setShowDebug] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const audioQueueRef = useRef<Int16Array[]>([]);
  const isPlayingRef = useRef(false);
  const isConnectedRef = useRef(false);
  const isMutedRef = useRef(false);
  const nextPlayTimeRef = useRef(0);

  const addLog = (msg: string) => {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[VoiceTutor] ${timestamp} - ${msg}`);
    setDebugLogs(prev => [`[${timestamp}] ${msg}`, ...prev].slice(0, 50));
  };

  const toggleMute = () => {
    const newMuted = !isMuted;
    setIsMuted(newMuted);
    isMutedRef.current = newMuted;
    addLog(newMuted ? "Microphone muted" : "Microphone unmuted");
  };

  const connect = async () => {
    setIsConnecting(true);
    setError(null);
    isConnectedRef.current = false;
    setMessages([]);
    addLog("Initializing session and hardware...");

    try {
      // Start microphone and camera first to ensure permissions are granted
      await startMicrophone();
      
      const apiKey = process.env.GEMINI_API_KEY || (window as any).process?.env?.GEMINI_API_KEY;
      if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
        throw new Error("API Key not found or invalid. Please set GEMINI_API_KEY in the Secrets panel.");
      }

      const ai = new GoogleGenAI({ apiKey });
      
      const sessionPromise = ai.live.connect({
        model: "gemini-2.5-flash-native-audio-preview-09-2025",
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
          },
          systemInstruction: "You are a supersonic AI tutor with vision capabilities. You are engaging, fast-paced, and brilliant. You explain complex topics simply and interactively. When a user takes a photo, instantly identify what's in it (historical buildings, machines, plants, book pages, etc.) and give a quick, deep-dive explanation. Keep your responses concise and conversational, as if we are on a phone call. Focus on being helpful and educational. You bridge the gap between the physical world and digital learning.",
          outputAudioTranscription: {},
          inputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            addLog("Connection opened successfully");
            setIsConnected(true);
            isConnectedRef.current = true;
            setIsConnecting(false);
          },
          onmessage: async (message: LiveServerMessage) => {
            // Log full message for debugging
            console.log("[VoiceTutor] Raw Message:", message);
            
            // 1. Handle Audio Output
            if (message.serverContent?.modelTurn?.parts) {
              for (const part of message.serverContent.modelTurn.parts) {
                if (part.inlineData?.data) {
                  const base64Audio = part.inlineData.data;
                  const binaryString = window.atob(base64Audio);
                  const len = binaryString.length;
                  const bytes = new Int16Array(len / 2);
                  for (let i = 0; i < len; i += 2) {
                    bytes[i / 2] = (binaryString.charCodeAt(i + 1) << 8) | binaryString.charCodeAt(i);
                  }
                  audioQueueRef.current.push(bytes);
                  if (!isPlayingRef.current) {
                    playNextInQueue();
                  }
                }
              }
            }

            // 2. Handle Model Transcription (Output)
            const modelText = (message as any).outputTranscription?.text || 
                             message.serverContent?.modelTurn?.parts?.map(p => p.text).filter(Boolean).join("");
            
            if (modelText) {
              addLog(`Model: ${modelText}`);
              setMessages(prev => {
                const last = prev[prev.length - 1];
                if (last?.role === 'model') {
                  const newMessages = [...prev];
                  newMessages[newMessages.length - 1] = { role: 'model', text: last.text + modelText };
                  return newMessages;
                }
                return [...prev, { role: 'model', text: modelText }];
              });
            }

            // 3. Handle User Transcription (Input)
            const userText = (message as any).inputTranscription?.text || 
                             (message as any).inputAudioTranscription?.text ||
                             (message as any).serverContent?.inputTranscription?.text;
            
            if (userText) {
              addLog(`User: ${userText}`);
              setMessages(prev => {
                const last = prev[prev.length - 1];
                if (last?.role === 'user') {
                  const newMessages = [...prev];
                  newMessages[newMessages.length - 1] = { role: 'user', text: last.text + userText };
                  return newMessages;
                }
                return [...prev, { role: 'user', text: userText }];
              });
            }

            if (message.serverContent?.interrupted) {
              addLog("Model interrupted");
              audioQueueRef.current = [];
              isPlayingRef.current = false;
            }
          },
          onclose: () => {
            addLog("Connection closed");
            setIsConnected(false);
            isConnectedRef.current = false;
            stopMicrophone();
          },
          onerror: (err) => {
            addLog(`Error: ${JSON.stringify(err)}`);
            setError("Connection error. Please check your API key and network.");
            setIsConnecting(false);
            isConnectedRef.current = false;
          }
        }
      });

      sessionPromiseRef.current = sessionPromise;
      await sessionPromise;
    } catch (err: any) {
      addLog(`Fatal Error: ${err.message}`);
      setError(err.message || "Failed to connect to Voice Tutor.");
      setIsConnecting(false);
      isConnectedRef.current = false;
    }
  };

  const disconnect = () => {
    addLog("Disconnecting...");
    if (sessionPromiseRef.current) {
      sessionPromiseRef.current.then(session => session.close());
      sessionPromiseRef.current = null;
    }
    stopMicrophone();
    setIsConnected(false);
    isConnectedRef.current = false;
  };

  const startMicrophone = async () => {
    try {
      // Stop any existing stream first
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      
      addLog("Requesting microphone and camera access...");
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ 
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: {
            facingMode: 'environment',
            width: { ideal: 1280 },
            height: { ideal: 720 }
          }
        });
      } catch (err) {
        addLog("Environment camera failed, trying default camera...");
        stream = await navigator.mediaDevices.getUserMedia({ 
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: true
        });
      }
      streamRef.current = stream;
      setIsCameraActive(stream.getVideoTracks().length > 0);
      
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      }
      const audioContext = audioContextRef.current;
      
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }
      
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (!isConnectedRef.current || isMutedRef.current) return;
        
        const inputData = e.inputBuffer.getChannelData(0);
        const pcmData = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          pcmData[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7FFF;
        }
        
        // Convert to base64 efficiently
        const uint8Array = new Uint8Array(pcmData.buffer);
        let binary = '';
        const chunkSize = 8192;
        for (let i = 0; i < uint8Array.length; i += chunkSize) {
          binary += String.fromCharCode.apply(null, uint8Array.subarray(i, i + chunkSize) as any);
        }
        const base64Data = btoa(binary);

        if (sessionPromiseRef.current) {
          sessionPromiseRef.current.then(session => {
            if (isConnectedRef.current) {
              try {
                session.sendRealtimeInput({
                  media: { data: base64Data, mimeType: 'audio/pcm;rate=16000' }
                });
              } catch (err) {
                console.error("Error sending audio:", err);
              }
            }
          });
        }
      };

      source.connect(processor);
      
      const silentGain = audioContext.createGain();
      silentGain.gain.value = 0;
      processor.connect(silentGain);
      silentGain.connect(audioContext.destination);
      
      setIsListening(true);
      addLog("Microphone active and streaming");
    } catch (err) {
      addLog(`Microphone Error: ${err}`);
      setError("Could not access microphone. Please check permissions.");
    }
  };

  const stopMicrophone = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      try {
        videoRef.current.srcObject = null;
      } catch (e) {
        console.warn("Failed to clear video srcObject:", e);
      }
    }
    setIsCameraActive(false);
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    setIsListening(false);
    addLog("Microphone and camera stopped");
  };

  const captureAndSendImage = async () => {
    if (!videoRef.current || !canvasRef.current || !isConnectedRef.current) {
      addLog("Cannot capture: Video, Canvas, or Connection not ready.");
      return;
    }
    
    setIsCapturing(true);
    addLog("Capturing frame for analysis...");
    
    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    if (video.videoWidth === 0 || video.videoHeight === 0) {
      addLog("Video dimensions are 0. Waiting for video to load...");
      setIsCapturing(false);
      return;
    }

    const context = canvas.getContext('2d');
    
    if (context) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      // Convert to base64 jpeg
      const fullImageUrl = canvas.toDataURL('image/jpeg', 0.8);
      const base64Image = fullImageUrl.split(',')[1];
      
      // Add to messages immediately
      setMessages(prev => [...prev, { role: 'user', text: "[Photo Sent for Analysis]", image: fullImageUrl }]);
      
      if (sessionPromiseRef.current) {
        try {
          const session = await sessionPromiseRef.current;
          
          if (!session || typeof session.sendRealtimeInput !== 'function') {
            throw new Error("Live session not properly initialized or sendRealtimeInput missing");
          }

          session.sendRealtimeInput({
            media: { data: base64Image, mimeType: 'image/jpeg' }
          });
          addLog("Image sent successfully to Gemini. Awaiting analysis...");
        } catch (err) {
          addLog(`Error sending image: ${err}`);
          setError(`Vision Error: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
    
    setTimeout(() => setIsCapturing(false), 500);
  };

  const playNextInQueue = async () => {
    if (audioQueueRef.current.length === 0) {
      isPlayingRef.current = false;
      return;
    }

    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }

    const ctx = audioContextRef.current;
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    isPlayingRef.current = true;
    
    // Process all available chunks in the queue to ensure gapless playback
    while (audioQueueRef.current.length > 0) {
      const pcmData = audioQueueRef.current.shift()!;
      
      // Gemini sends 24kHz audio
      const buffer = ctx.createBuffer(1, pcmData.length, 24000);
      const channelData = buffer.getChannelData(0);
      
      for (let i = 0; i < pcmData.length; i++) {
        channelData[i] = pcmData[i] / 32768.0;
      }
      
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      
      // Use a dynamics compressor to prevent clipping and "vibration" artifacts
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.setValueAtTime(-24, ctx.currentTime);
      compressor.knee.setValueAtTime(30, ctx.currentTime);
      compressor.ratio.setValueAtTime(12, ctx.currentTime);
      compressor.attack.setValueAtTime(0.003, ctx.currentTime);
      compressor.release.setValueAtTime(0.25, ctx.currentTime);
      
      source.connect(compressor);
      compressor.connect(ctx.destination);
      
      const now = ctx.currentTime;
      // Gapless scheduling: use the larger of 'now' or 'nextPlayTime'
      // Add a tiny lookahead (5ms) to prevent underruns
      const startTime = Math.max(now + 0.005, nextPlayTimeRef.current);
      
      source.start(startTime);
      nextPlayTimeRef.current = startTime + buffer.duration;
      
      source.onended = () => {
        if (audioQueueRef.current.length > 0) {
          playNextInQueue();
        } else if (ctx.currentTime >= nextPlayTimeRef.current) {
          isPlayingRef.current = false;
        }
      };
    }
  };

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, []);

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="bg-white p-10 rounded-[40px] border border-gray-100 shadow-xl text-center relative overflow-hidden">
        {/* Background Animation */}
        <AnimatePresence>
          {isConnected && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.05 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-indigo-600"
            />
          )}
        </AnimatePresence>

        <div className="relative z-10">
          {/* Camera Preview */}
          <AnimatePresence>
            {isCameraActive && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="mb-8 relative max-w-md mx-auto aspect-video rounded-3xl overflow-hidden border-4 border-indigo-600/20 shadow-2xl bg-black"
              >
                <video 
                  ref={(el) => {
                    videoRef.current = el;
                    if (el && streamRef.current && el.srcObject !== streamRef.current) {
                      addLog("Attaching stream to video element...");
                      el.srcObject = streamRef.current;
                      el.play().catch(err => addLog(`Video play error: ${err}`));
                    }
                  }}
                  autoPlay
                  playsInline
                  muted
                  onLoadedMetadata={(e) => {
                    const video = e.currentTarget;
                    addLog(`Camera resolution: ${video.videoWidth}x${video.videoHeight}`);
                  }}
                  onPlaying={() => addLog("Camera feed is live")}
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 pointer-events-none border-[20px] border-transparent">
                  <div className="w-full h-full border border-white/30 rounded-xl" />
                </div>
                {isCapturing && (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 bg-white flex items-center justify-center"
                  >
                    <Sparkles className="text-indigo-600 animate-pulse" size={48} />
                  </motion.div>
                )}
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-black/50 backdrop-blur-md px-3 py-1.5 rounded-full text-[10px] text-white font-bold uppercase tracking-widest">
                  <Scan size={12} />
                  <span>Vision Active</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="w-24 h-24 bg-indigo-600 rounded-full mx-auto flex items-center justify-center text-white mb-6 shadow-2xl shadow-indigo-200">
            {isConnecting ? (
              <Loader2 className="animate-spin" size={40} />
            ) : isConnected ? (
              <motion.div
                animate={{ scale: [1, 1.2, 1] }}
                transition={{ repeat: Infinity, duration: 2 }}
              >
                <BrainCircuit size={40} />
              </motion.div>
            ) : (
              <BrainCircuit size={40} />
            )}
          </div>

          <h2 className="text-3xl font-black mb-2">Gemini Live Tutor</h2>
          <p className="text-gray-500 mb-8 max-w-md mx-auto">
            Experience real-time, low-latency learning. Just speak, and your AI tutor will guide you through any topic.
          </p>

          {error && (
            <div className="mb-6 p-4 bg-red-50 text-red-600 rounded-2xl text-sm font-medium">
              {error}
            </div>
          )}

          <div className="flex justify-center gap-4">
            {!isConnected ? (
              <button
                onClick={connect}
                disabled={isConnecting}
                className="px-8 py-4 bg-indigo-600 text-white rounded-2xl font-bold text-lg shadow-lg shadow-indigo-100 hover:bg-indigo-700 transition-all flex items-center gap-3"
              >
                {isConnecting ? <Loader2 className="animate-spin" /> : <Mic size={24} />}
                {isConnecting ? "Connecting..." : "Start Live Session"}
              </button>
            ) : (
              <div className="flex flex-col items-center gap-6">
                <div className="flex gap-4">
                  <button
                    onClick={toggleMute}
                    className={`p-4 rounded-2xl font-bold text-lg shadow-lg transition-all flex items-center gap-3 ${
                      isMuted 
                        ? 'bg-red-100 text-red-600 shadow-red-50 hover:bg-red-200' 
                        : 'bg-indigo-100 text-indigo-600 shadow-indigo-50 hover:bg-indigo-200'
                    }`}
                    title={isMuted ? "Unmute Microphone" : "Mute Microphone"}
                  >
                    {isMuted ? <MicOff size={24} /> : <Mic size={24} />}
                  </button>
                  
                  <button
                    onClick={captureAndSendImage}
                    disabled={isCapturing}
                    className="px-8 py-4 bg-emerald-500 text-white rounded-2xl font-bold text-lg shadow-lg shadow-emerald-100 hover:bg-emerald-600 transition-all flex items-center gap-3"
                  >
                    {isCapturing ? <Loader2 className="animate-spin" /> : <Camera size={24} />}
                    Snap & Learn
                  </button>

                  <button
                    onClick={disconnect}
                    className="px-8 py-4 bg-red-500 text-white rounded-2xl font-bold text-lg shadow-lg shadow-red-100 hover:bg-red-600 transition-all flex items-center gap-3"
                  >
                    <X size={24} />
                    End Session
                  </button>
                </div>
                
                <p className="text-xs text-gray-400 font-medium flex items-center gap-2">
                  <Sparkles size={14} className="text-indigo-400" />
                  Point your camera at anything and click "Snap & Learn" for a deep dive
                </p>
              </div>
            )}
          </div>

          <canvas ref={canvasRef} className="hidden" />

          <button 
            onClick={() => setShowDebug(!showDebug)}
            className="mt-6 text-xs text-gray-400 hover:text-indigo-600 flex items-center gap-1 mx-auto"
          >
            <Terminal size={12} />
            {showDebug ? "Hide Debug Console" : "Show Debug Console"}
          </button>
        </div>

        {/* Visualizer */}
        {isConnected && (
          <div className="mt-12 flex justify-center items-end gap-1 h-12">
            {[...Array(12)].map((_, i) => (
              <motion.div
                key={i}
                animate={{ height: isListening ? [8, Math.random() * 40 + 8, 8] : 8 }}
                transition={{ repeat: Infinity, duration: 0.5, delay: i * 0.05 }}
                className="w-1.5 bg-indigo-600 rounded-full"
              />
            ))}
          </div>
        )}
      </div>

      {/* Debug Console */}
      <AnimatePresence>
        {showDebug && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="bg-gray-900 rounded-3xl p-6 overflow-hidden"
          >
            <div className="flex items-center gap-2 text-indigo-400 mb-4 text-xs font-mono uppercase tracking-widest">
              <Terminal size={14} />
              <span>Debug Console</span>
            </div>
            <div className="h-40 overflow-y-auto font-mono text-[10px] text-gray-400 space-y-1">
              {debugLogs.map((log, i) => (
                <div key={i} className="border-l border-gray-800 pl-2 py-0.5">
                  <span className="text-gray-600 mr-2">[{new Date().toLocaleTimeString()}]</span>
                  {log}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Transcript/Messages */}
      <div className="bg-white rounded-[32px] border border-gray-100 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-gray-50 bg-gray-50/50 flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-gray-700">
            <MessageSquare size={18} />
            <span>Live Transcript</span>
          </div>
          {isConnected && (
            <span className="flex items-center gap-1.5 text-xs font-bold text-emerald-500 uppercase tracking-widest">
              <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
              Live
            </span>
          )}
        </div>
        <div className="p-6 h-[300px] overflow-y-auto space-y-4 flex flex-col">
          <div className="flex-1" />
          <div className="space-y-4">
            {messages.length === 0 ? (
              <div className="text-center py-12 text-gray-400 italic">
                Your conversation transcript will appear here...
              </div>
            ) : (
              messages.map((msg, i) => (
                <div 
                  key={i} 
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div className={`max-w-[80%] p-4 rounded-2xl text-sm ${
                    msg.role === 'user' 
                      ? 'bg-indigo-600 text-white rounded-tr-none shadow-md shadow-indigo-100' 
                      : 'bg-gray-100 text-gray-800 rounded-tl-none border border-gray-200'
                  }`}>
                    {msg.image && (
                      <img 
                        src={msg.image} 
                        alt="Captured" 
                        className="w-full h-auto rounded-xl mb-2 border border-white/20"
                        referrerPolicy="no-referrer"
                      />
                    )}
                    {msg.text}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
