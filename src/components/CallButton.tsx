import React, { useEffect, useRef, useState } from 'react';
import './CallButton.css';

// A simple phone-style call control that starts/stops speech recognition.
// - Green button: start listening
// - Red button: stop listening
// Both buttons are visible and accessible.
// When stopped the captured transcript is sent to /api/transcribe; if that
// API returns a 500 error we log full details and show a friendly message.

type Props = {
  // Optional callback invoked with the final transcript when stopped
  onTranscript?: (text: string) => void;
};

export default function CallButton({ onTranscript }: Props) {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(true);
  const [transcript, setTranscript] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const recognitionRef = useRef<any | null>(null);

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setSupported(false);
      return;
    }

    const r = new SpeechRecognition();
    r.lang = 'en-US';
    r.interimResults = true;
    r.maxAlternatives = 1;

    r.onresult = (ev: any) => {
      let interim = '';
      let final = '';
      for (let i = 0; i < ev.results.length; i++) {
        const res = ev.results[i];
        if (res.isFinal) final += res[0].transcript + ' ';
        else interim += res[0].transcript + ' ';
      }
      setTranscript((prev) => (final ? (prev + final).trim() : prev));
      // Note: if you want to show interim results, add local state for them.
    };

    r.onend = () => {
      // if we are still marked as listening, it means recognition ended unexpectedly
      // don't auto-restart; wait for user to press the green button again.
      setListening(false);
    };

    r.onerror = (ev: any) => {
      console.error('Speech recognition error', ev);
      setErrorMessage('Microphone error — please check your microphone and permissions.');
      setListening(false);
    };

    recognitionRef.current = r;

    return () => {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch (e) { /* ignore */ }
      }
    };
  }, []);

  const startListening = async () => {
    setErrorMessage('');
    setTranscript('');

    if (!recognitionRef.current) {
      setErrorMessage('Speech recognition not supported in this browser.');
      return;
    }

    try {
      // Request microphone permission proactively so user sees prompt.
      await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      console.error('getUserMedia error', err);
      setErrorMessage('Microphone access denied. Please enable microphone permissions.');
      return;
    }

    try {
      recognitionRef.current.start();
      setListening(true);
    } catch (err) {
      console.error('Failed to start speech recognition', err);
      setErrorMessage('Failed to start listening.');
    }
  };

  const stopListening = async () => {
    setErrorMessage('');
    if (!recognitionRef.current) return;

    try {
      recognitionRef.current.stop();
    } catch (e) {
      // ignore
    }

    setListening(false);

    // Final transcript is in `transcript` state. If you use interim results, you may
    // want to combine them here before sending.
    const finalTranscript = transcript.trim();

    if (onTranscript) onTranscript(finalTranscript);

    if (!finalTranscript) return;

    // Send to backend and handle 500 errors specially.
    try {
      const res = await fetch('/api/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: finalTranscript }),
      });

      if (!res.ok) {
        const bodyText = await res.text().catch(() => '[unreadable body]');
        if (res.status === 500) {
          // Log full error details for debugging (server response + status)
          console.error('Server 500 when sending transcript', {
            status: res.status,
            statusText: res.statusText,
            body: bodyText,
            transcript: finalTranscript,
          });

          // Show user-friendly message
          setErrorMessage('Something went wrong on our side — please try again in a moment.');
        } else {
          // Other non-OK responses
          console.error('Error sending transcript', { status: res.status, statusText: res.statusText, body: bodyText });
          setErrorMessage('Unable to send your message. Please try again.');
        }
      }
    } catch (err) {
      // Network or other fetch-level errors
      console.error('Network error sending transcript', err);
      setErrorMessage('Network error — please check your connection and try again.');
    }
  };

  return (
    <div className="call-button-group" role="group" aria-label="Call controls">
      {!supported && (
        <div className="call-support-warning" role="status">Speech recognition not supported in this browser.</div>
      )}

      <div className="call-buttons">
        <button
          className={`call-button start ${listening ? 'active' : ''}`}
          onClick={startListening}
          aria-pressed={listening}
          aria-label="Start listening"
        >
          <span className="visually-hidden">Start</span>
          <svg className="phone-icon" viewBox="0 0 24 24" aria-hidden>
            <path fill="currentColor" d="M6.62 10.79a15.053 15.053 0 006.59 6.59l2.2-2.2a1 1 0 01.93-.27c1.02.26 2.12.4 3.24.4a1 1 0 011 1v3.5a1 1 0 01-1 1C10.07 21.03 2.97 13.93 2.97 4a1 1 0 011-1H7.5a1 1 0 011 1c0 1.12.14 2.22.4 3.24.11.42.01.88-.27.93l-2.01 2.01z" />
          </svg>
          {/* pulsing ring */}
          {listening && <span className="pulse" aria-hidden />}
        </button>

        <button
          className={`call-button end ${listening ? '' : 'disabled'}`}
          onClick={stopListening}
          aria-pressed={!listening}
          aria-label="Stop listening and end session"
          disabled={!listening}
        >
          <span className="visually-hidden">Stop</span>
          <svg className="phone-icon" viewBox="0 0 24 24" aria-hidden>
            <path fill="currentColor" d="M21 8V7a2 2 0 00-2-2h-1.1a1 1 0 00-.9.6l-.7 1.6a1 1 0 01-.9.6l-2.1.2a11.05 11.05 0 01-4.1-1.1l-.7-.3a1 1 0 00-1 .2L6 8.8a1 1 0 00-.3.9 16 16 0 0011.6 11.6 1 1 0 00.9-.3l.6-1a1 1 0 00.2-1l-.3-.7c-.3-.9-.5-1.9-.6-2.9l.2-2.1a1 1 0 01.6-.9l1.6-.7a1 1 0 00.6-.9V10a2 2 0 00-2-2h-1z" />
          </svg>
        </button>
      </div>

      {errorMessage && (
        <div className="call-error" role="alert">
          {errorMessage}
          <button className="dismiss" onClick={() => setErrorMessage('')} aria-label="Dismiss error">×</button>
        </div>
      )}
    </div>
  );
}
