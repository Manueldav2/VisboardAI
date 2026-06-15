'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import { API_BASE } from '@/lib/api';

export type RealtimeStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
export type AIStatus = 'idle' | 'listening' | 'thinking' | 'speaking';

interface UseRealtimeVoiceOptions {
  voice?: string;
  onTranscript: (text: string, isFinal: boolean) => void;
  onAIResponse: (text: string) => void;
  onFunctionCall: (name: string, args: Record<string, unknown>, callId: string) => void;
  onAIStatusChange: (status: AIStatus) => void;
  onError?: (error: string) => void;
}

export function useRealtimeVoice({
  voice = 'sage',
  onTranscript,
  onAIResponse,
  onFunctionCall,
  onAIStatusChange,
  onError,
}: UseRealtimeVoiceOptions) {
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const [status, setStatus] = useState<RealtimeStatus>('disconnected');
  const [aiStatus, setAiStatus] = useState<AIStatus>('idle');

  // Stable refs for callbacks
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;
  const onAIResponseRef = useRef(onAIResponse);
  onAIResponseRef.current = onAIResponse;
  const onFunctionCallRef = useRef(onFunctionCall);
  onFunctionCallRef.current = onFunctionCall;
  const onAIStatusChangeRef = useRef(onAIStatusChange);
  onAIStatusChangeRef.current = onAIStatusChange;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const updateAiStatus = useCallback((s: AIStatus) => {
    setAiStatus(s);
    onAIStatusChangeRef.current(s);
  }, []);

  const connect = useCallback(async (tool?: string | null, mode?: string) => {
    setStatus('connecting');

    try {
      // 1. Get ephemeral token from our backend
      const tokenRes = await fetch(`${API_BASE}/api/realtime/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice, tool: tool || undefined, mode: mode || 'general' }),
      });
      if (!tokenRes.ok) throw new Error('Failed to get realtime session token');
      const { client_secret } = await tokenRes.json();

      // 2. Create PeerConnection
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      // Monitor ICE connection state for drops
      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
          setStatus('error');
          updateAiStatus('idle');
          onErrorRef.current?.('Voice connection dropped. Tap mic to reconnect.');
        }
      };

      // 3. Audio output — AI voice plays through this element
      const audioEl = document.createElement('audio');
      audioEl.autoplay = true;
      audioElRef.current = audioEl;
      pc.ontrack = (e) => {
        audioEl.srcObject = e.streams[0];
      };

      // 4. Add user mic track
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      // 5. Create data channel for events
      const dc = pc.createDataChannel('oai-events');
      dcRef.current = dc;

      // State for accumulating streamed events
      let responseTextBuffer = '';

      dc.onopen = () => {
        setStatus('connected');
        updateAiStatus('listening');
      };

      dc.onclose = () => {
        setStatus('disconnected');
        updateAiStatus('idle');
      };

      dc.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data);

          switch (event.type) {
            case 'input_audio_buffer.speech_started':
              updateAiStatus('listening');
              break;

            case 'input_audio_buffer.speech_stopped':
              updateAiStatus('thinking');
              break;

            case 'conversation.item.input_audio_transcription.completed':
              if (event.transcript) {
                onTranscriptRef.current(event.transcript, true);
              }
              break;

            case 'conversation.item.input_audio_transcription.delta':
              if (event.delta) {
                onTranscriptRef.current(event.delta, false);
              }
              break;

            case 'response.audio_transcript.delta':
              responseTextBuffer += (event.delta || '');
              break;

            case 'response.function_call_arguments.done': {
              const name = event.name;
              try {
                const args = JSON.parse(event.arguments || '{}');
                onFunctionCallRef.current(name, args, event.call_id);
              } catch {
                // JSON parse error on function args
              }
              break;
            }

            case 'response.audio.delta':
              // Audio flows through WebRTC track, not data channel
              // But this event signals the model is producing audio
              updateAiStatus('speaking');
              break;

            case 'response.done': {
              if (responseTextBuffer) {
                onAIResponseRef.current(responseTextBuffer);
                responseTextBuffer = '';
              }
              // After response completes, go back to listening
              setTimeout(() => updateAiStatus('listening'), 300);
              break;
            }

            case 'error':
              onErrorRef.current?.(event.error?.message || 'Realtime API error');
              break;
          }
        } catch {
          // Non-JSON message — ignore
        }
      };

      // 6. SDP exchange — send offer directly to OpenAI
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sdpRes = await fetch(
        'https://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${client_secret}`,
            'Content-Type': 'application/sdp',
          },
          body: offer.sdp,
        }
      );

      if (!sdpRes.ok) throw new Error('SDP exchange failed');

      const answerSdp = await sdpRes.text();
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });

    } catch (err) {
      setStatus('error');
      onErrorRef.current?.((err as Error).message);
    }
  }, [voice, updateAiStatus]);

  const disconnect = useCallback(() => {
    // Stop mic tracks
    if (pcRef.current) {
      pcRef.current.getSenders().forEach((sender) => {
        sender.track?.stop();
      });
    }
    dcRef.current?.close();
    pcRef.current?.close();
    pcRef.current = null;
    dcRef.current = null;
    if (audioElRef.current) {
      audioElRef.current.srcObject = null;
      audioElRef.current = null;
    }
    setStatus('disconnected');
    updateAiStatus('idle');
  }, [updateAiStatus]);

  const sendText = useCallback((text: string) => {
    if (dcRef.current?.readyState !== 'open') return;
    // Create a user text message
    dcRef.current.send(JSON.stringify({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text }],
      },
    }));
    // Trigger response generation
    dcRef.current.send(JSON.stringify({ type: 'response.create' }));
  }, []);

  const updateSession = useCallback((instructions: string, tools?: unknown[]) => {
    if (dcRef.current?.readyState !== 'open') return;
    const session: Record<string, unknown> = { instructions };
    if (tools) session.tools = tools;
    dcRef.current.send(JSON.stringify({
      type: 'session.update',
      session,
    }));
  }, []);

  const respondToFunctionCall = useCallback((callId: string, result: string) => {
    if (dcRef.current?.readyState !== 'open') return;
    // Send function result
    dcRef.current.send(JSON.stringify({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: callId,
        output: result,
      },
    }));
    // Resume response generation
    dcRef.current.send(JSON.stringify({ type: 'response.create' }));
  }, []);

  const setMuted = useCallback((muted: boolean) => {
    if (audioElRef.current) {
      audioElRef.current.muted = muted;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      pcRef.current?.getSenders().forEach((s) => s.track?.stop());
      dcRef.current?.close();
      pcRef.current?.close();
    };
  }, []);

  return {
    connect,
    disconnect,
    sendText,
    updateSession,
    respondToFunctionCall,
    setMuted,
    status,
    aiStatus,
  };
}
