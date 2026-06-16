import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';

import { buildProject, enterBuilder, getBuilderApiBaseUrl, listProjects } from './src/api';
import type { BuilderFile, BuilderLogEntry, BuilderProject, BuilderSession } from './src/types';

type TabKey = 'Build' | 'Preview' | 'Files' | 'Activity';

const DEFAULT_PROMPT =
  'A modern client portal for a boutique interior design studio with project boards, booking, invoices, and a polished homepage.';

export default function App() {
  const [session, setSession] = useState<BuilderSession | null>(null);
  const [integrations, setIntegrations] = useState<Record<string, boolean>>({});
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [style, setStyle] = useState('Elegant mobile-first');
  const [tab, setTab] = useState<TabKey>('Build');
  const [project, setProject] = useState<BuilderProject | null>(null);
  const [projects, setProjects] = useState<BuilderProject[]>([]);
  const [selectedFile, setSelectedFile] = useState<BuilderFile | null>(null);
  const [busy, setBusy] = useState<'enter' | 'build' | null>(null);
  const [error, setError] = useState('');

  const hasProject = Boolean(project);

  useEffect(() => {
    if (project?.files?.length) {
      setSelectedFile(project.files[0]);
    }
  }, [project?.id]);

  const enter = async () => {
    setBusy('enter');
    setError('');
    try {
      const response = await enterBuilder();
      setSession(response.session);
      setIntegrations(response.integrations);
      setProjects(await listProjects());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not enter the builder.');
      setSession({
        id: 'local-single-user',
        displayName: 'AA Designs',
        createdAt: new Date().toISOString(),
      });
    } finally {
      setBusy(null);
    }
  };

  const build = async () => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt || busy) return;
    setBusy('build');
    setError('');
    setTab('Activity');
    try {
      const nextProject = await buildProject(trimmedPrompt, style);
      setProject(nextProject);
      setProjects((current) => [nextProject, ...current.filter((item) => item.id !== nextProject.id)]);
      setTab('Preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Build failed.');
    } finally {
      setBusy(null);
    }
  };

  if (!session) {
    return <EnterScreen busy={busy === 'enter'} error={error} onEnter={enter} />;
  }

  return (
    <SafeAreaView style={styles.shell}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>Lovable Builder</Text>
          <Text style={styles.title}>{project?.name || 'Build a web app'}</Text>
        </View>
        <IntegrationPills integrations={integrations} project={project} />
      </View>

      <View style={styles.tabs}>
        {(['Build', 'Preview', 'Files', 'Activity'] as TabKey[]).map((item) => (
          <Pressable
            key={item}
            onPress={() => setTab(item)}
            style={[styles.tabButton, tab === item && styles.tabButtonActive]}
          >
            <Text style={[styles.tabText, tab === item && styles.tabTextActive]}>{item}</Text>
          </Pressable>
        ))}
      </View>

      {tab === 'Build' && (
        <BuildScreen
          prompt={prompt}
          style={style}
          projects={projects}
          busy={busy === 'build'}
          error={error}
          onPromptChange={setPrompt}
          onStyleChange={setStyle}
          onBuild={build}
          onOpen={(item) => {
            setProject(item);
            setTab('Preview');
          }}
        />
      )}
      {tab === 'Preview' && <PreviewScreen project={project} />}
      {tab === 'Files' && (
        <FilesScreen
          project={project}
          selectedFile={selectedFile}
          onSelectFile={setSelectedFile}
        />
      )}
      {tab === 'Activity' && (
        <ActivityScreen
          busy={busy === 'build'}
          error={error}
          logs={project?.logs || []}
          apiBaseUrl={getBuilderApiBaseUrl()}
          hasProject={hasProject}
        />
      )}
    </SafeAreaView>
  );
}

function EnterScreen({ busy, error, onEnter }: { busy: boolean; error: string; onEnter: () => void }) {
  return (
    <SafeAreaView style={styles.enterShell}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.enterBody}>
        <View style={styles.logo}>
          <Text style={styles.logoText}>AA</Text>
        </View>
        <Text style={styles.enterTitle}>Lovable Builder</Text>
        <Text style={styles.enterCopy}>
          Prompt, build, preview, and inspect generated web apps from a Windows-friendly mobile app.
        </Text>
        <Pressable style={styles.primaryButton} onPress={onEnter} disabled={busy}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Enter App</Text>}
        </Pressable>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </View>
      <Text style={styles.footerText}>Created by AA Designs</Text>
    </SafeAreaView>
  );
}

function BuildScreen(props: {
  prompt: string;
  style: string;
  projects: BuilderProject[];
  busy: boolean;
  error: string;
  onPromptChange: (value: string) => void;
  onStyleChange: (value: string) => void;
  onBuild: () => void;
  onOpen: (project: BuilderProject) => void;
}) {
  const options = ['Elegant', 'SaaS', 'Editorial', 'Utility'];

  return (
    <ScrollView contentContainerStyle={styles.scrollContent}>
      <View style={styles.panel}>
        <Text style={styles.sectionTitle}>Build prompt</Text>
        <TextInput
          value={props.prompt}
          onChangeText={props.onPromptChange}
          multiline
          textAlignVertical="top"
          style={styles.promptInput}
          placeholder="Describe the web app you want to build"
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {options.map((option) => (
            <Pressable
              key={option}
              onPress={() => props.onStyleChange(`${option} mobile-first`)}
              style={[styles.chip, props.style.includes(option) && styles.chipActive]}
            >
              <Text style={[styles.chipText, props.style.includes(option) && styles.chipTextActive]}>{option}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <Pressable
          style={[styles.primaryButton, props.busy && styles.disabledButton]}
          onPress={props.onBuild}
          disabled={props.busy || !props.prompt.trim()}
        >
          {props.busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryButtonText}>Build Web App</Text>}
        </Pressable>
      </View>

      {props.error ? <Text style={styles.errorBanner}>{props.error}</Text> : null}

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Recent builds</Text>
      </View>
      {props.projects.length === 0 ? (
        <EmptyState title="No builds yet" />
      ) : (
        props.projects.map((item) => (
          <Pressable key={item.id} style={styles.projectRow} onPress={() => props.onOpen(item)}>
            <View style={{ flex: 1 }}>
              <Text style={styles.projectName}>{item.name}</Text>
              <Text style={styles.projectMeta}>{item.status}</Text>
            </View>
            <Text style={styles.rowArrow}>Open</Text>
          </Pressable>
        ))
      )}
    </ScrollView>
  );
}

function PreviewScreen({ project }: { project: BuilderProject | null }) {
  if (!project) {
    return <EmptyState title="Build an app to preview it here" />;
  }

  const source = project.preview.url
    ? { uri: project.preview.url }
    : { html: project.preview.html || project.previewHtml };

  if (Platform.OS === 'web') {
    const html = 'html' in source ? source.html : undefined;
    const uri = 'uri' in source ? source.uri : undefined;
    return (
      <View style={styles.previewWrap}>
        {React.createElement('iframe' as any, {
          src: uri,
          srcDoc: html,
          style: styles.webFrame,
          title: 'Generated web app preview',
        })}
      </View>
    );
  }

  return (
    <View style={styles.previewWrap}>
      <WebView originWhitelist={['*']} source={source} style={styles.preview} />
      <Text style={styles.previewBadge}>{project.preview.mode === 'daytona' ? 'Daytona Preview' : 'Inline Preview'}</Text>
    </View>
  );
}

function FilesScreen(props: {
  project: BuilderProject | null;
  selectedFile: BuilderFile | null;
  onSelectFile: (file: BuilderFile) => void;
}) {
  if (!props.project) {
    return <EmptyState title="Generated files appear here" />;
  }

  const file = props.selectedFile || props.project.files[0];

  return (
    <View style={styles.filesLayout}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.fileTabs}>
        {props.project.files.map((item) => (
          <Pressable
            key={item.path}
            onPress={() => props.onSelectFile(item)}
            style={[styles.fileTab, item.path === file?.path && styles.fileTabActive]}
          >
            <Text style={[styles.fileTabText, item.path === file?.path && styles.fileTabTextActive]}>{item.path}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <ScrollView style={styles.codePanel} contentContainerStyle={styles.codeContent}>
        <Text selectable style={styles.codeText}>{file?.content || ''}</Text>
      </ScrollView>
    </View>
  );
}

function ActivityScreen(props: {
  busy: boolean;
  error: string;
  logs: BuilderLogEntry[];
  apiBaseUrl: string;
  hasProject: boolean;
}) {
  const rows = useMemo(() => {
    const base = props.hasProject ? props.logs : [];
    return props.busy
      ? [{ at: new Date().toISOString(), level: 'info' as const, message: 'Building in progress' }, ...base]
      : base;
  }, [props.busy, props.logs, props.hasProject]);

  return (
    <ScrollView contentContainerStyle={styles.scrollContent}>
      <View style={styles.panel}>
        <Text style={styles.sectionTitle}>Backend</Text>
        <Text style={styles.projectMeta}>{props.apiBaseUrl}/api/mobile-builder</Text>
      </View>
      {props.error ? <Text style={styles.errorBanner}>{props.error}</Text> : null}
      {rows.length === 0 ? (
        <EmptyState title="Activity appears after your first build" />
      ) : (
        rows.map((log) => <LogRow key={`${log.at}-${log.message}`} log={log} />)
      )}
    </ScrollView>
  );
}

function IntegrationPills({ integrations, project }: { integrations: Record<string, boolean>; project: BuilderProject | null }) {
  const daytona = project?.sandbox?.configured ?? integrations.daytonaConfigured ?? false;
  const convex = project?.convex?.ok ?? integrations.convexConfigured ?? false;
  return (
    <View style={styles.pillColumn}>
      <StatusPill label="Daytona" active={daytona} />
      <StatusPill label="Convex" active={convex} />
    </View>
  );
}

function StatusPill({ label, active }: { label: string; active: boolean }) {
  return (
    <View style={[styles.statusPill, active && styles.statusPillActive]}>
      <Text style={[styles.statusPillText, active && styles.statusPillTextActive]}>{label}</Text>
    </View>
  );
}

function LogRow({ log }: { log: BuilderLogEntry }) {
  return (
    <View style={styles.logRow}>
      <View style={[styles.logDot, styles[`logDot_${log.level}`]]} />
      <View style={{ flex: 1 }}>
        <Text style={styles.logMessage}>{log.message}</Text>
        <Text style={styles.logTime}>{log.at}</Text>
      </View>
    </View>
  );
}

function EmptyState({ title }: { title: string }) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyTitle}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: '#f6f8fb',
  },
  enterShell: {
    flex: 1,
    padding: 24,
    backgroundColor: '#f7fbff',
  },
  enterBody: {
    flex: 1,
    justifyContent: 'center',
    gap: 18,
  },
  logo: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#111827',
  },
  logoText: {
    color: '#fff',
    fontSize: 19,
    fontWeight: '900',
  },
  enterTitle: {
    color: '#111827',
    fontSize: 48,
    fontWeight: '900',
    letterSpacing: 0,
  },
  enterCopy: {
    color: '#5b6472',
    fontSize: 17,
    lineHeight: 25,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  eyebrow: {
    color: '#2563eb',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.9,
    textTransform: 'uppercase',
  },
  title: {
    color: '#111827',
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: 0,
  },
  tabs: {
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 4,
    borderRadius: 8,
    backgroundColor: '#e8edf5',
    flexDirection: 'row',
  },
  tabButton: {
    flex: 1,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 7,
  },
  tabButtonActive: {
    backgroundColor: '#fff',
  },
  tabText: {
    color: '#596273',
    fontSize: 12,
    fontWeight: '900',
  },
  tabTextActive: {
    color: '#111827',
  },
  scrollContent: {
    padding: 16,
    gap: 14,
  },
  panel: {
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e5eaf2',
    backgroundColor: '#fff',
    gap: 12,
  },
  sectionHeader: {
    marginTop: 2,
  },
  sectionTitle: {
    color: '#111827',
    fontSize: 16,
    fontWeight: '900',
  },
  promptInput: {
    minHeight: 150,
    padding: 12,
    borderWidth: 1,
    borderColor: '#d7deea',
    borderRadius: 8,
    color: '#111827',
    backgroundColor: '#fbfcff',
    fontSize: 15,
    lineHeight: 21,
  },
  chipRow: {
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d7deea',
    backgroundColor: '#fff',
  },
  chipActive: {
    borderColor: '#111827',
    backgroundColor: '#111827',
  },
  chipText: {
    color: '#4b5563',
    fontWeight: '900',
  },
  chipTextActive: {
    color: '#fff',
  },
  primaryButton: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#111827',
    paddingHorizontal: 18,
  },
  disabledButton: {
    opacity: 0.68,
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: '900',
    fontSize: 15,
  },
  errorText: {
    color: '#b42318',
    fontSize: 13,
    fontWeight: '700',
  },
  errorBanner: {
    padding: 12,
    borderRadius: 8,
    overflow: 'hidden',
    color: '#b42318',
    backgroundColor: '#fff0ee',
    fontWeight: '800',
  },
  footerText: {
    color: '#6b7280',
    fontWeight: '800',
  },
  projectRow: {
    padding: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e5eaf2',
    backgroundColor: '#fff',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  projectName: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '900',
  },
  projectMeta: {
    color: '#6b7280',
    fontSize: 12,
    fontWeight: '700',
  },
  rowArrow: {
    color: '#2563eb',
    fontSize: 12,
    fontWeight: '900',
  },
  previewWrap: {
    flex: 1,
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#d7deea',
    backgroundColor: '#fff',
  },
  preview: {
    flex: 1,
    backgroundColor: '#fff',
  },
  previewBadge: {
    position: 'absolute',
    top: 10,
    left: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    overflow: 'hidden',
    color: '#111827',
    backgroundColor: 'rgba(255,255,255,0.9)',
    fontSize: 12,
    fontWeight: '900',
  },
  webFrame: {
    width: '100%',
    height: '100%',
    borderWidth: 0,
  },
  filesLayout: {
    flex: 1,
  },
  fileTabs: {
    paddingHorizontal: 16,
    paddingBottom: 10,
    gap: 8,
  },
  fileTab: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#e8edf5',
  },
  fileTabActive: {
    backgroundColor: '#111827',
  },
  fileTabText: {
    color: '#596273',
    fontWeight: '900',
    fontSize: 12,
  },
  fileTabTextActive: {
    color: '#fff',
  },
  codePanel: {
    flex: 1,
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 8,
    backgroundColor: '#101828',
  },
  codeContent: {
    padding: 16,
  },
  codeText: {
    color: '#eef4ff',
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    fontSize: 12,
    lineHeight: 18,
  },
  logRow: {
    padding: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e5eaf2',
    backgroundColor: '#fff',
    flexDirection: 'row',
    gap: 10,
  },
  logDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 4,
  },
  logDot_info: {
    backgroundColor: '#2563eb',
  },
  logDot_success: {
    backgroundColor: '#15803d',
  },
  logDot_warning: {
    backgroundColor: '#d97706',
  },
  logDot_error: {
    backgroundColor: '#b42318',
  },
  logMessage: {
    color: '#111827',
    fontWeight: '800',
  },
  logTime: {
    color: '#6b7280',
    fontSize: 11,
    marginTop: 4,
  },
  pillColumn: {
    gap: 6,
    alignItems: 'flex-end',
  },
  statusPill: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: '#fff7ed',
  },
  statusPillActive: {
    backgroundColor: '#ecfdf3',
  },
  statusPillText: {
    color: '#c2410c',
    fontSize: 11,
    fontWeight: '900',
  },
  statusPillTextActive: {
    color: '#047857',
  },
  emptyState: {
    flex: 1,
    minHeight: 180,
    margin: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e5eaf2',
    backgroundColor: '#fff',
    padding: 18,
  },
  emptyTitle: {
    color: '#6b7280',
    fontWeight: '900',
    textAlign: 'center',
  },
});
