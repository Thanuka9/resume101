import { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";
import { InterviewStatus, InterviewPersona, TranscriptItem } from '../types';

const AI_KEY = process.env.API_KEY || '';

export const useLiveAudio = (role: string, persona: InterviewPersona, userContext: string) => {
  const [status, setStatus] = useState<InterviewStatus>('idle');
  const [volume, setVolume] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
  const [connectionLogs, setConnectionLogs] = useState<string[]>([]);
  
  // Refs for audio and state management
  const audioContextRef = useRef<AudioContext | null>(null);
  const inputContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourceNodesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const checkIntervalRef = useRef<any>(null);
  const isMutedRef = useRef(isMuted);

  // Keep ref in sync with state for callbacks
  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  const addLog = (msg: string) => setConnectionLogs(prev => [...prev.slice(-4), `[${new Date().toLocaleTimeString()}] ${msg}`]);
  const generateId = () => Math.random().toString(36).substring(2, 9) + Date.now().toString(36);

  // --- Helpers ---
  const createBlob = (data: Float32Array) => {
    const l = data.length;
    const int16 = new Int16Array(l);
    for (let i = 0; i < l; i++) int16[i] = data[i] * 32768;
    const uint8 = new Uint8Array(int16.buffer);
    let binary = '';
    const len = uint8.byteLength;
    for (let i = 0; i < len; i++) binary += String.fromCharCode(uint8[i]);
    return { data: btoa(binary), mimeType: 'audio/pcm;rate=16000' };
  };

  const decodeAudioData = async (base64: string, ctx: AudioContext) => {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
    const dataInt16 = new Int16Array(bytes.buffer);
    const buffer = ctx.createBuffer(1, dataInt16.length, 24000);
    const channelData = buffer.getChannelData(0);
    for (let i = 0; i < channelData.length; i++) channelData[i] = dataInt16[i] / 32768.0;
    return buffer;
  };

  const playTestSound = async () => {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(440, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.3);
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
    setTimeout(() => ctx.close(), 500);
  };

  const stopCheckLoop = () => {
    if (checkIntervalRef.current) {
        cancelAnimationFrame(checkIntervalRef.current);
        checkIntervalRef.current = null;
    }
  };

  const checkMic = async () => {
     try {
       stopCheckLoop();
       setConnectionLogs([]);
       addLog("Requesting Mic Access...");
       // Enable echo cancellation and noise suppression for better transcription
       const stream = await navigator.mediaDevices.getUserMedia({ 
           audio: { 
               echoCancellation: true, 
               noiseSuppression: true, 
               autoGainControl: true 
           } 
       });
       addLog("Mic Access Granted");
       setStatus('mic-check');
       
       const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
       if (inputContextRef.current) inputContextRef.current.close();
       
       inputContextRef.current = new AudioCtx({ sampleRate: 16000 });
       const source = inputContextRef.current.createMediaStreamSource(stream);
       const analyzer = inputContextRef.current.createAnalyser();
       analyzer.fftSize = 256;
       source.connect(analyzer);
       
       const dataArray = new Uint8Array(analyzer.frequencyBinCount);
       const updateVolume = () => {
         analyzer.getByteFrequencyData(dataArray);
         let sum = 0;
         for (let i=0; i<dataArray.length; i++) sum += dataArray[i];
         setVolume((sum / dataArray.length) / 128); 
         checkIntervalRef.current = requestAnimationFrame(updateVolume);
       };
       updateVolume();
       streamRef.current = stream;
     } catch (e) {
       console.error("Mic check failed", e);
       addLog("Mic Access Denied/Error");
       alert("Could not access microphone.");
       setStatus('error');
     }
  };

  const getSystemInstruction = () => {
    let style = "";
    if (persona === 'Junior Peer') style = "PERSONA: Junior Peer. Friendly. Start with: 'Hey! Ready to chat about your code?'";
    else if (persona === 'Senior Engineer') style = "PERSONA: Senior Engineer. Direct. Start with: 'Hello. Let's review your technical background.'";
    else if (persona === 'Staff Architect') style = "PERSONA: Staff Architect. Focus on scale. Start with: 'Hi. I want to dig into system design today.'";
    else if (persona === 'Tech Lead') style = "PERSONA: Tech Lead. Focus on quality. Start with: 'Hi. Let's discuss your approach to maintainability.'";
    else style = "PERSONA: Hiring Manager. Focus on soft skills. Start with: 'Hi. Tell me what drives you in your career.'";

    return `
      You are an interviewer for a ${role} position.
      ${style}
      Candidate Context: "${userContext}"
      Rules:
      1. YOU SPEAK FIRST using the exact greeting above.
      2. Keep questions short (1-2 sentences).
      3. Wait for the user to answer.
    `;
  };

  const connect = useCallback(async () => {
    if (!AI_KEY) return;
    stopCheckLoop();
    setStatus('connecting');
    setTranscript([]); 
    addLog("Initializing Session...");

    try {
      const ai = new GoogleGenAI({ apiKey: AI_KEY });
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      
      // Ensure clean contexts
      if (inputContextRef.current) inputContextRef.current.close();
      inputContextRef.current = new AudioCtx({ sampleRate: 16000 });

      if (audioContextRef.current) audioContextRef.current.close();
      audioContextRef.current = new AudioCtx({ sampleRate: 24000 });
      
      // Resume context (important for browsers)
      await inputContextRef.current.resume();
      await audioContextRef.current.resume();
      
      let stream = streamRef.current;
      if (!stream || !stream.active) {
         addLog("Re-acquiring Mic...");
         stream = await navigator.mediaDevices.getUserMedia({ 
             audio: { 
                 echoCancellation: true, 
                 noiseSuppression: true, 
                 autoGainControl: true
             } 
         });
         streamRef.current = stream;
      }

      const config = {
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: persona === 'Staff Architect' ? 'Fenrir' : 'Puck' } },
          },
          systemInstruction: getSystemInstruction(),
          inputAudioTranscription: {}, // Request transcript
          outputAudioTranscription: {}, // Request transcript
        },
      };

      addLog("Connecting to Gemini Live...");
      const sessionPromise = ai.live.connect({
        model: config.model,
        config: config.config,
        callbacks: {
          onopen: async () => {
            setStatus('active');
            addLog("Connected! Sending greeting trigger...");
            nextStartTimeRef.current = audioContextRef.current?.currentTime || 0;
            
            // Send Greeting Trigger
            sessionPromiseRef.current?.then(session => {
               session.sendRealtimeInput([{ mimeType: 'text/plain', data: btoa("User connected. Say your greeting now.") }]);
            });

            // Setup Audio Processing
            const source = inputContextRef.current!.createMediaStreamSource(streamRef.current!);
            const processor = inputContextRef.current!.createScriptProcessor(4096, 1, 1);
            
            processor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              // Volume Viz
              let sum = 0;
              for(let i=0; i<inputData.length; i++) sum += inputData[i] * inputData[i];
              setVolume(Math.sqrt(sum / inputData.length));

              // Check ref instead of state to avoid stale closure
              if (!isMutedRef.current) {
                 const blob = createBlob(inputData);
                 sessionPromiseRef.current?.then(session => session.sendRealtimeInput({ media: blob }));
              }
            };

            source.connect(processor);
            processor.connect(inputContextRef.current!.destination); // Keep alive
          },
          onmessage: async (msg: LiveServerMessage) => {
            const serverContent = msg.serverContent;
            
            // Atomic update to transcript to prevent out-of-order fragmentation
            setTranscript(currentTranscript => {
              let newTranscript = [...currentTranscript];
              const getLast = () => newTranscript.length > 0 ? newTranscript[newTranscript.length - 1] : null;

              // 1. Handle Model Speech (Output)
              if (serverContent?.outputTranscription?.text) {
                const text = serverContent.outputTranscription.text;
                // Avoid creating bubbles for empty strings
                if (text && text.length > 0) {
                    const last = getLast();
                    if (last && last.speaker === 'ai' && !last.isComplete) {
                        newTranscript[newTranscript.length - 1] = { ...last, text: last.text + text };
                    } else {
                        // If switching from user to AI, mark user done
                        if (last && last.speaker === 'user' && !last.isComplete) {
                            newTranscript[newTranscript.length - 1] = { ...last, isComplete: true };
                        }
                        newTranscript.push({
                            id: generateId(),
                            speaker: 'ai',
                            text,
                            timestamp: new Date().toLocaleTimeString(),
                            isComplete: false
                        });
                    }
                }
              }
              
              // 2. Handle User Speech (Input)
              if (serverContent?.inputTranscription?.text) {
                const text = serverContent.inputTranscription.text;
                if (text && text.length > 0) {
                    const last = getLast(); // Get potentially updated last from step 1
                    if (last && last.speaker === 'user' && !last.isComplete) {
                        newTranscript[newTranscript.length - 1] = { ...last, text: last.text + text };
                    } else {
                        // If switching from AI to user, mark AI done
                        if (last && last.speaker === 'ai' && !last.isComplete) {
                            newTranscript[newTranscript.length - 1] = { ...last, isComplete: true };
                        }
                        newTranscript.push({
                            id: generateId(),
                            speaker: 'user',
                            text,
                            timestamp: new Date().toLocaleTimeString(),
                            isComplete: false
                        });
                    }
                }
              }

              // 3. Handle Turn Completion & Interruptions
              if (serverContent?.turnComplete || serverContent?.interrupted) {
                 const last = getLast();
                 if (last && !last.isComplete) {
                    newTranscript[newTranscript.length - 1] = { ...last, isComplete: true };
                 }
              }

              return newTranscript;
            });

            if (serverContent?.interrupted) {
                // Clear audio queue immediately
                for (const source of sourceNodesRef.current) {
                    source.stop();
                }
                sourceNodesRef.current.clear();
                nextStartTimeRef.current = audioContextRef.current?.currentTime || 0;
            }

            // Handle Audio Output
            const data = serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (data && audioContextRef.current) {
              const buffer = await decodeAudioData(data, audioContextRef.current);
              const source = audioContextRef.current.createBufferSource();
              source.buffer = buffer;
              source.connect(audioContextRef.current.destination);
              const startTime = Math.max(nextStartTimeRef.current, audioContextRef.current.currentTime);
              source.start(startTime);
              nextStartTimeRef.current = startTime + buffer.duration;
              sourceNodesRef.current.add(source);
              setIsAiSpeaking(true);
              source.onended = () => {
                sourceNodesRef.current.delete(source);
                if (sourceNodesRef.current.size === 0) setIsAiSpeaking(false);
              };
            }
          },
          onclose: () => { setStatus('finished'); setIsAiSpeaking(false); addLog("Session Closed"); },
          onerror: (err) => { console.error(err); setStatus('error'); setIsAiSpeaking(false); addLog(`Error: ${err}`); }
        }
      });
      sessionPromiseRef.current = sessionPromise;
    } catch (e) {
      console.error(e);
      setStatus('error');
      addLog("Connection Failed");
    }
  }, [role, persona, userContext]); // Removed isMuted from dependency array as it's handled via Ref

  const disconnect = useCallback(() => {
    stopCheckLoop();
    if (sessionPromiseRef.current) sessionPromiseRef.current.then(s => s.close());
    streamRef.current?.getTracks().forEach(t => t.stop());
    inputContextRef.current?.close();
    audioContextRef.current?.close();
    sourceNodesRef.current.forEach(s => s.stop());
    sourceNodesRef.current.clear();
    setStatus('finished');
    setIsAiSpeaking(false);
  }, []);

  const toggleMute = () => setIsMuted(!isMuted);

  return { checkMic, playTestSound, connect, disconnect, toggleMute, isMuted, isAiSpeaking, status, volume, transcript, connectionLogs };
};