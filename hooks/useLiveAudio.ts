import { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";
import { InterviewStatus, InterviewPersona } from '../types';

const AI_KEY = process.env.API_KEY || '';

export const useLiveAudio = (role: string, persona: InterviewPersona) => {
  const [status, setStatus] = useState<InterviewStatus>('idle');
  const [volume, setVolume] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  
  // Refs for audio processing
  const audioContextRef = useRef<AudioContext | null>(null);
  const inputContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const nextStartTimeRef = useRef<number>(0);

  // Helper: Create PCM Blob
  const createBlob = (data: Float32Array) => {
    const l = data.length;
    const int16 = new Int16Array(l);
    for (let i = 0; i < l; i++) {
      int16[i] = data[i] * 32768;
    }
    const uint8 = new Uint8Array(int16.buffer);
    let binary = '';
    const len = uint8.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(uint8[i]);
    }
    const b64 = btoa(binary);
    return {
      data: b64,
      mimeType: 'audio/pcm;rate=16000',
    };
  };

  // Helper: Decode Audio
  const decodeAudioData = async (base64: string, ctx: AudioContext) => {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const dataInt16 = new Int16Array(bytes.buffer);
    const buffer = ctx.createBuffer(1, dataInt16.length, 24000);
    const channelData = buffer.getChannelData(0);
    for (let i = 0; i < channelData.length; i++) {
      channelData[i] = dataInt16[i] / 32768.0;
    }
    return buffer;
  };

  const getSystemInstruction = () => {
    const base = `You are an interviewer for a ${role} position.`;
    
    switch (persona) {
      case 'Junior Peer':
        return `${base} You are a potential teammate (Junior/Mid level). Keep it friendly, ask about their favorite tools, collaboration style, and basic technical concepts. Focus on cultural fit and enthusiasm.`;
      case 'Senior Engineer':
        return `${base} You are a Senior Engineer. Ask standard technical questions, check their knowledge of best practices, testing, and debugging. Be professional and encouraging.`;
      case 'Staff Architect':
        return `${base} You are a Staff/Principal Architect. Grill them on System Design, Scalability, Trade-offs (CAP theorem, ACID vs BASE), and complex edge cases. Be exacting and expect high-quality, deep answers. Do not tolerate fluff.`;
      default:
        return base;
    }
  };

  const connect = useCallback(async () => {
    if (!AI_KEY) {
      console.error("No API Key");
      return;
    }
    setStatus('connecting');

    try {
      const ai = new GoogleGenAI({ apiKey: AI_KEY });
      
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      inputContextRef.current = new AudioCtx({ sampleRate: 16000 });
      audioContextRef.current = new AudioCtx({ sampleRate: 24000 });
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const config = {
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: persona === 'Staff Architect' ? 'Fenrir' : 'Puck' } },
          },
          systemInstruction: getSystemInstruction(),
        },
      };

      const sessionPromise = ai.live.connect({
        model: config.model,
        config: config.config,
        callbacks: {
          onopen: () => {
            setStatus('active');
            
            if (!inputContextRef.current || !streamRef.current) return;
            
            const source = inputContextRef.current.createMediaStreamSource(streamRef.current);
            const processor = inputContextRef.current.createScriptProcessor(4096, 1, 1);
            
            processor.onaudioprocess = (e) => {
              if (isMuted) return;
              
              const inputData = e.inputBuffer.getChannelData(0);
              let sum = 0;
              for(let i=0; i<inputData.length; i++) sum += inputData[i] * inputData[i];
              setVolume(Math.sqrt(sum / inputData.length));

              const blob = createBlob(inputData);
              sessionPromiseRef.current?.then(session => {
                session.sendRealtimeInput({ media: blob });
              });
            };

            source.connect(processor);
            processor.connect(inputContextRef.current.destination);
          },
          onmessage: async (msg: LiveServerMessage) => {
            const data = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (data && audioContextRef.current) {
              const buffer = await decodeAudioData(data, audioContextRef.current);
              const source = audioContextRef.current.createBufferSource();
              source.buffer = buffer;
              source.connect(audioContextRef.current.destination);
              
              const currentTime = audioContextRef.current.currentTime;
              const startTime = Math.max(nextStartTimeRef.current, currentTime);
              source.start(startTime);
              nextStartTimeRef.current = startTime + buffer.duration;
            }
          },
          onclose: () => {
            setStatus('idle');
          },
          onerror: (err) => {
            console.error("Live Error", err);
            setStatus('error');
          }
        }
      });

      sessionPromiseRef.current = sessionPromise;

    } catch (e) {
      console.error(e);
      setStatus('error');
    }
  }, [role, persona, isMuted]);

  const disconnect = useCallback(() => {
    if (sessionPromiseRef.current) {
      sessionPromiseRef.current.then(s => s.close());
    }
    streamRef.current?.getTracks().forEach(t => t.stop());
    inputContextRef.current?.close();
    audioContextRef.current?.close();
    setStatus('idle');
    setVolume(0);
  }, []);

  const toggleMute = () => setIsMuted(!isMuted);

  return { connect, disconnect, toggleMute, isMuted, status, volume };
};