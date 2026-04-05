import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import { Video, Sparkles, Download, RefreshCw, X, Lock } from 'lucide-react';
import { generateVideo } from '../services/gemini';
import { motion, AnimatePresence } from 'motion/react';

const MotionView = motion(View);

interface VideoGeneratorProps {
  prompt: string;
  title: string;
  onClose?: () => void;
}

export const VideoGenerator: React.FC<VideoGeneratorProps> = ({ prompt, title, onClose }) => {
  const [loading, setLoading] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');
  const [hasKey, setHasKey] = useState(true);

  React.useEffect(() => {
    checkApiKey();
  }, []);

  const checkApiKey = async () => {
    if ((window as any).aistudio) {
      const selected = await (window as any).aistudio.hasSelectedApiKey();
      setHasKey(selected);
    }
  };

  const handleOpenKeySelector = async () => {
    if ((window as any).aistudio) {
      await (window as any).aistudio.openSelectKey();
      setHasKey(true);
    }
  };

  const handleGenerate = async () => {
    if (!hasKey) {
      await handleOpenKeySelector();
      return;
    }

    setLoading(true);
    setError(null);
    setVideoUrl(null);
    setStatus('David is envisioning your inspiration...');

    const loadingMessages = [
      'David is envisioning your inspiration...',
      'Gathering light and color...',
      'Crafting a visual reflection of the Word...',
      'Almost there, David is putting on the final touches...',
    ];

    let msgIndex = 0;
    const interval = setInterval(() => {
      msgIndex = (msgIndex + 1) % loadingMessages.length;
      setStatus(loadingMessages[msgIndex]);
    }, 5000);

    try {
      const url = await generateVideo(prompt);
      if (url) {
        setVideoUrl(url);
      } else {
        setError('David couldn\'t quite capture the vision this time. Please try again.');
      }
    } catch (err: any) {
      if (err?.message?.includes('entity was not found')) {
        setHasKey(false);
        setError('API Key error. Please re-select your key.');
      } else {
        setError('Something went wrong. Please try again.');
      }
    } finally {
      clearInterval(interval);
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerTitleContainer}>
          <Video size={20} color="#d4af37" />
          <Text style={styles.headerTitle}>Visual Inspiration</Text>
        </View>
        {onClose && (
          <TouchableOpacity onPress={onClose}>
            <X size={20} color="#f5d77a" />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.content}>
        <Text style={styles.promptTitle}>{title}</Text>
        
        {!videoUrl && !loading && !error && (
          <View style={styles.placeholder}>
            <Sparkles size={48} color="rgba(212, 175, 55, 0.2)" />
            <Text style={styles.placeholderText}>
              David can create a short, inspiring video based on this verse.
            </Text>
            {!hasKey ? (
              <TouchableOpacity style={styles.keyButton} onPress={handleOpenKeySelector}>
                <Lock size={16} color="#0b1e3d" />
                <Text style={styles.keyButtonText}>SELECT API KEY</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.generateButton} onPress={handleGenerate}>
                <Text style={styles.generateButtonText}>GENERATE VISION</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {loading && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#d4af37" />
            <Text style={styles.statusText}>{status}</Text>
          </View>
        )}

        {error && (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={handleGenerate}>
              <RefreshCw size={16} color="#fff" />
              <Text style={styles.retryButtonText}>TRY AGAIN</Text>
            </TouchableOpacity>
          </View>
        )}

        {videoUrl && (
          <View style={styles.videoContainer}>
            {Platform.OS === 'web' ? (
              <video 
                src={videoUrl} 
                controls 
                autoPlay 
                loop 
                style={{ width: '100%', borderRadius: 12, aspectRatio: '16/9' }}
              />
            ) : (
              <Text style={{ color: '#fff' }}>Video playback not supported in this view.</Text>
            )}
            <View style={styles.videoActions}>
              <TouchableOpacity style={styles.actionButton} onPress={handleGenerate}>
                <RefreshCw size={16} color="#d4af37" />
                <Text style={styles.actionButtonText}>REGENERATE</Text>
              </TouchableOpacity>
              <a href={videoUrl} download="inspiration.mp4" style={{ textDecoration: 'none' }}>
                <View style={styles.actionButton}>
                  <Download size={16} color="#d4af37" />
                  <Text style={styles.actionButtonText}>DOWNLOAD</Text>
                </View>
              </a>
            </View>
          </View>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0f2a52',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(212, 175, 55, 0.3)',
    overflow: 'hidden',
    marginVertical: 15,
    width: '100%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 15,
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(212, 175, 55, 0.1)',
  },
  headerTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    color: '#d4af37',
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  content: {
    padding: 20,
    alignItems: 'center',
  },
  promptTitle: {
    color: '#fff',
    fontSize: 14,
    fontFamily: 'Playfair Display',
    fontStyle: 'italic',
    textAlign: 'center',
    marginBottom: 20,
  },
  placeholder: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  placeholderText: {
    color: '#f5d77a',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 15,
    marginBottom: 20,
    lineHeight: 18,
    opacity: 0.8,
  },
  generateButton: {
    backgroundColor: '#d4af37',
    paddingHorizontal: 25,
    paddingVertical: 12,
    borderRadius: 25,
  },
  generateButtonText: {
    color: '#0b1e3d',
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  keyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#f5d77a',
    paddingHorizontal: 25,
    paddingVertical: 12,
    borderRadius: 25,
  },
  keyButtonText: {
    color: '#0b1e3d',
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  loadingContainer: {
    paddingVertical: 30,
    alignItems: 'center',
  },
  statusText: {
    color: '#f5d77a',
    fontSize: 12,
    marginTop: 20,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  errorContainer: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  errorText: {
    color: '#ef4444',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 20,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#7f1d1d',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  videoContainer: {
    width: '100%',
    alignItems: 'center',
  },
  videoActions: {
    flexDirection: 'row',
    gap: 20,
    marginTop: 15,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  actionButtonText: {
    color: '#d4af37',
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
});

export default VideoGenerator;
