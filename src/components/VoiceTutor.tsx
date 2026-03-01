import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Mic, MicOff, Volume2, VolumeX, Loader2, BrainCircuit, X, MessageSquare } from 'lucide-react';
import { GoogleGenAI, Modality, LiveServerMessage } from "@google/genai";

type Message = {
  role: 'user' | 'model';
  text: string;
};

export default function VoiceTutor() {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState<string | null>(null);
  
  const recordingContextRef = useRef<AudioContext | null>(null);
  const playbackContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sessionRef = useRef<any>(null);
  const audioQueueRef = useRef<Int16Array[]>([]);
  const isPlayingRef = useRef(false);

  const toggleMute = () => {
    setIsMuted(!isMuted);
  };

  const connect = async () => {
    setIsConnecting(true);
    setError(null);
    try {
      const apiKey = process.env.GEMINI_API_KEY || (window as any).process?.env?.GEMINI_API_KEY;
      if (!apiKey) throw new Error("API Key not found. Please set GEMINI_API_KEY.");

      const ai = new GoogleGenAI({ apiKey });
      
      const session = await ai.live.connect({
        model: "gemini-2.5-flash-native-audio-preview-09-2025",
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
          },
          systemInstruction: "You are a supersonic AI tutor. You are engaging, fast-paced, and brilliant. You explain complex topics simply and interactively. Keep your responses concise and conversational, as if we are on a phone call.",
          outputAudioTranscription: {},
          inputAudioTranscription: {},
        },
        callbacks: {
          onopen: () => {
            setIsConnected(true);
            setIsConnecting(false);
            startMicrophone();
          },
          onmessage: async (message: LiveServerMessage) => {
            // Handle audio output
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

            // Handle model transcription
            if (message.serverContent?.modelTurn?.parts) {
              const text = message.serverContent.modelTurn.parts.map(p => p.text).filter(Boolean).join("");
              if (text) {
                setMessages(prev => {
                  const last = prev[prev.length - 1];
                  if (last?.role === 'model') {
                    const newMessages = [...prev];
                    newMessages[newMessages.length - 1] = { role: 'model', text: last.text + text };
                    return newMessages;
                  }
                  return [...prev, { role: 'model', text }];
                });
              }
            }

            // Handle user transcription
            if (message.serverContent?.inputTranscription) {
              const text = message.serverContent.inputTranscription.text;
              if (text) {
                setMessages(prev => {
                  const last = prev[prev.length - 1];
                  if (last?.role === 'user') {
                    const newMessages = [...prev];
                    newMessages[newMessages.length - 1] = { role: 'user', text: last.text + text };
                    return newMessages;
                  }
                  return [...prev, { role: 'user', text }];
                });
              }
            }

            if (message.serverContent?.interrupted) {
              audioQueueRef.current = [];
              isPlayingRef.current = false;
            }
          },
          onclose: () => {
            setIsConnected(false);
            stopMicrophone();
          },
          onerror: (err) => {
            console.error("Live API Error:", err);
            setError("Connection error. Please try again.");
            setIsConnecting(false);
          }
        }
      });

      sessionRef.current = session;
    } catch (err: any) {
      setError(err.message || "Failed to connect to Voice Tutor.");
      setIsConnecting(false);
    }
  };

  const disconnect = () => {
    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
    }
    stopMicrophone();
    setIsConnected(false);
  };

  const startMicrophone = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      recordingContextRef.current = audioContext;
      
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (!isConnected || !sessionRef.current || isMuted) return;
        
        const inputData = e.inputBuffer.getChannelData(0);
        const pcmData = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          pcmData[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7FFF;
        }
        
        const base64Data = btoa(String.fromCharCode(...new Uint8Array(pcmData.buffer)));
        sessionRef.current.sendRealtimeInput({
          media: { data: base64Data, mimeType: 'audio/pcm;rate=16000' }
        });
      };

      source.connect(processor);
      processor.connect(audioContext.destination);
      setIsListening(true);
    } catch (err) {
      console.error("Microphone error:", err);
      setError("Could not access microphone.");
    }
  };

  const stopMicrophone = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (recordingContextRef.current) {
      recordingContextRef.current.close();
      recordingContextRef.current = null;
    }
    if (playbackContextRef.current) {
      playbackContextRef.current.close();
      playbackContextRef.current = null;
    }
    setIsListening(false);
  };

  const nextPlayTimeRef = useRef(0);

  const playNextInQueue = async () => {
    if (audioQueueRef.current.length === 0) {
      isPlayingRef.current = false;
      return;
    }

    if (!playbackContextRef.current) {
      playbackContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }

    const ctx = playbackContextRef.current;
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    isPlayingRef.current = true;
    const pcmData = audioQueueRef.current.shift()!;
    
    const buffer = ctx.createBuffer(1, pcmData.length, 24000);
    const channelData = buffer.getChannelData(0);
    
    for (let i = 0; i < pcmData.length; i++) {
      channelData[i] = pcmData[i] / 32768.0;
    }
    
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    
    const now = ctx.currentTime;
    if (nextPlayTimeRef.current < now) {
      nextPlayTimeRef.current = now + 0.05; // Small buffer for scheduling
    }
    
    source.start(nextPlayTimeRef.current);
    nextPlayTimeRef.current += buffer.duration;
    
    source.onended = () => {
      playNextInQueue();
    };
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
                  onClick={disconnect}
                  className="px-8 py-4 bg-red-500 text-white rounded-2xl font-bold text-lg shadow-lg shadow-red-100 hover:bg-red-600 transition-all flex items-center gap-3"
                >
                  <X size={24} />
                  End Session
                </button>
              </div>
            )}
          </div>
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
        <div className="p-6 h-[300px] overflow-y-auto space-y-4 flex flex-col-reverse">
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
                      ? 'bg-indigo-600 text-white rounded-tr-none' 
                      : 'bg-gray-100 text-gray-800 rounded-tl-none'
                  }`}>
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
