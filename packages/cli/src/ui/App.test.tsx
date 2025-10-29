/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

<<<<<<< HEAD
import type {
  AccessibilitySettings,
  AuthType,
  GeminiClient,
  MCPServerConfig,
  SandboxConfig,
  ToolRegistry,
} from 'eadp-code-core';
import {
  ApprovalMode,
  Config as ServerConfig,
  ideContext,
} from 'eadp-code-core';
import { waitFor } from '@testing-library/react';
import { EventEmitter } from 'node:events';
import process from 'node:process';
import type { Mock } from 'vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as auth from '../config/auth.js';
import {
  LoadedSettings,
  type Settings,
  type SettingsFile,
} from '../config/settings.js';
import { renderWithProviders } from '../test-utils/render.js';
import { updateEventEmitter } from '../utils/updateEventEmitter.js';
import { AppWrapper as App } from './App.js';
import { Tips } from './components/Tips.js';
import { useConsoleMessages } from './hooks/useConsoleMessages.js';
import { useGeminiStream } from './hooks/useGeminiStream.js';
import * as useTerminalSize from './hooks/useTerminalSize.js';
import type { ConsoleMessageItem } from './types.js';
import { StreamingState, ToolCallStatus } from './types.js';
import type { UpdateObject } from './utils/updateCheck.js';
import { checkForUpdates } from './utils/updateCheck.js';

// Define a more complete mock server config based on actual Config
interface MockServerConfig {
  apiKey: string;
  model: string;
  sandbox?: SandboxConfig;
  targetDir: string;
  debugMode: boolean;
  question?: string;
  fullContext: boolean;
  coreTools?: string[];
  toolDiscoveryCommand?: string;
  toolCallCommand?: string;
  mcpServerCommand?: string;
  mcpServers?: Record<string, MCPServerConfig>; // Use imported MCPServerConfig
  userAgent: string;
  userMemory: string;
  geminiMdFileCount: number;
  approvalMode: ApprovalMode;
  vertexai?: boolean;
  showMemoryUsage?: boolean;
  accessibility?: AccessibilitySettings;
  embeddingModel: string;
  checkpointing?: boolean;

  getApiKey: Mock<() => string>;
  getModel: Mock<() => string>;
  getSandbox: Mock<() => SandboxConfig | undefined>;
  getTargetDir: Mock<() => string>;
  getToolRegistry: Mock<() => ToolRegistry>; // Use imported ToolRegistry type
  getDebugMode: Mock<() => boolean>;
  getQuestion: Mock<() => string | undefined>;
  getFullContext: Mock<() => boolean>;
  getCoreTools: Mock<() => string[] | undefined>;
  getToolDiscoveryCommand: Mock<() => string | undefined>;
  getToolCallCommand: Mock<() => string | undefined>;
  getMcpServerCommand: Mock<() => string | undefined>;
  getMcpServers: Mock<() => Record<string, MCPServerConfig> | undefined>;
  getPromptRegistry: Mock<() => Record<string, unknown>>;
  getExtensions: Mock<
    () => Array<{ name: string; version: string; isActive: boolean }>
  >;
  getBlockedMcpServers: Mock<
    () => Array<{ name: string; extensionName: string }>
  >;
  getUserAgent: Mock<() => string>;
  getUserMemory: Mock<() => string>;
  setUserMemory: Mock<(newUserMemory: string) => void>;
  getGeminiMdFileCount: Mock<() => number>;
  setGeminiMdFileCount: Mock<(count: number) => void>;
  getApprovalMode: Mock<() => ApprovalMode>;
  setApprovalMode: Mock<(skip: ApprovalMode) => void>;
  getVertexAI: Mock<() => boolean | undefined>;
  getShowMemoryUsage: Mock<() => boolean>;
  getAccessibility: Mock<() => AccessibilitySettings>;
  getProjectRoot: Mock<() => string | undefined>;
  getEnablePromptCompletion: Mock<() => boolean>;
  getGeminiClient: Mock<() => GeminiClient | undefined>;
  getCheckpointingEnabled: Mock<() => boolean>;
  getAllGeminiMdFilenames: Mock<() => string[]>;
  setFlashFallbackHandler: Mock<(handler: (fallback: boolean) => void) => void>;
  getSessionId: Mock<() => string>;
  getUserTier: Mock<() => Promise<string | undefined>>;
  getIdeMode: Mock<() => boolean>;
  getWorkspaceContext: Mock<
    () => {
      getDirectories: Mock<() => string[]>;
    }
  >;
  getIdeClient: Mock<
    () => {
      getCurrentIde: Mock<() => string | undefined>;
      getDetectedIdeDisplayName: Mock<() => string>;
      addStatusChangeListener: Mock<
        (listener: (status: string) => void) => void
      >;
      removeStatusChangeListener: Mock<
        (listener: (status: string) => void) => void
      >;
      getConnectionStatus: Mock<() => string>;
    }
  >;
  isTrustedFolder: Mock<() => boolean>;
  getScreenReader: Mock<() => boolean>;
}

// Mock eadp-code-core and its Config class
vi.mock('eadp-code-core', async (importOriginal) => {
  const actualCore =
    await importOriginal<typeof import('eadp-code-core')>();
  const ConfigClassMock = vi
    .fn()
    .mockImplementation((optionsPassedToConstructor) => {
      const opts = { ...optionsPassedToConstructor }; // Clone
      // Basic mock structure, will be extended by the instance in tests
      return {
        apiKey: opts.apiKey || 'test-key',
        model: opts.model || 'test-model-in-mock-factory',
        sandbox: opts.sandbox,
        targetDir: opts.targetDir || '/test/dir',
        debugMode: opts.debugMode || false,
        question: opts.question,
        fullContext: opts.fullContext ?? false,
        coreTools: opts.coreTools,
        toolDiscoveryCommand: opts.toolDiscoveryCommand,
        toolCallCommand: opts.toolCallCommand,
        mcpServerCommand: opts.mcpServerCommand,
        mcpServers: opts.mcpServers,
        userAgent: opts.userAgent || 'test-agent',
        userMemory: opts.userMemory || '',
        geminiMdFileCount: opts.geminiMdFileCount || 0,
        approvalMode: opts.approvalMode ?? ApprovalMode.DEFAULT,
        vertexai: opts.vertexai,
        showMemoryUsage: opts.showMemoryUsage ?? false,
        accessibility: opts.accessibility ?? {},
        embeddingModel: opts.embeddingModel || 'test-embedding-model',

        getApiKey: vi.fn(() => opts.apiKey || 'test-key'),
        getModel: vi.fn(() => opts.model || 'test-model-in-mock-factory'),
        getSandbox: vi.fn(() => opts.sandbox),
        getTargetDir: vi.fn(() => opts.targetDir || '/test/dir'),
        getToolRegistry: vi.fn(() => ({}) as ToolRegistry), // Simple mock
        getDebugMode: vi.fn(() => opts.debugMode || false),
        getQuestion: vi.fn(() => opts.question),
        getFullContext: vi.fn(() => opts.fullContext ?? false),
        getCoreTools: vi.fn(() => opts.coreTools),
        getToolDiscoveryCommand: vi.fn(() => opts.toolDiscoveryCommand),
        getToolCallCommand: vi.fn(() => opts.toolCallCommand),
        getMcpServerCommand: vi.fn(() => opts.mcpServerCommand),
        getMcpServers: vi.fn(() => opts.mcpServers),
        getPromptRegistry: vi.fn(),
        getExtensions: vi.fn(() => []),
        getBlockedMcpServers: vi.fn(() => []),
        getUserAgent: vi.fn(() => opts.userAgent || 'test-agent'),
        getUserMemory: vi.fn(() => opts.userMemory || ''),
        setUserMemory: vi.fn(),
        getGeminiMdFileCount: vi.fn(() => opts.geminiMdFileCount || 0),
        setGeminiMdFileCount: vi.fn(),
        getApprovalMode: vi.fn(() => opts.approvalMode ?? ApprovalMode.DEFAULT),
        setApprovalMode: vi.fn(),
        getVertexAI: vi.fn(() => opts.vertexai),
        getShowMemoryUsage: vi.fn(() => opts.showMemoryUsage ?? false),
        getAccessibility: vi.fn(() => opts.accessibility ?? {}),
        getProjectRoot: vi.fn(() => opts.targetDir),
        getEnablePromptCompletion: vi.fn(() => false),
        getGeminiClient: vi.fn(() => ({
          getUserTier: vi.fn(),
        })),
        getCheckpointingEnabled: vi.fn(() => opts.checkpointing ?? true),
        getAllGeminiMdFilenames: vi.fn(() => ['QWEN.md']),
        setFlashFallbackHandler: vi.fn(),
        getSessionId: vi.fn(() => 'test-session-id'),
        getUserTier: vi.fn().mockResolvedValue(undefined),
        getIdeMode: vi.fn(() => true),
        getWorkspaceContext: vi.fn(() => ({
          getDirectories: vi.fn(() => []),
        })),
        getIdeClient: vi.fn(() => ({
          getCurrentIde: vi.fn(() => 'vscode'),
          getDetectedIdeDisplayName: vi.fn(() => 'VSCode'),
          addStatusChangeListener: vi.fn(),
          removeStatusChangeListener: vi.fn(),
          getConnectionStatus: vi.fn(() => 'connected'),
        })),
        isTrustedFolder: vi.fn(() => true),
        getScreenReader: vi.fn(() => false),
      };
    });

  const ideContextMock = {
    getIdeContext: vi.fn(),
    subscribeToIdeContext: vi.fn(() => vi.fn()), // subscribe returns an unsubscribe function
  };
=======
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { Text, useIsScreenReaderEnabled } from 'ink';
import { App } from './App.js';
import { UIStateContext, type UIState } from './contexts/UIStateContext.js';
import { StreamingState } from './types.js';
>>>>>>> main

vi.mock('ink', async (importOriginal) => {
  const original = await importOriginal<typeof import('ink')>();
  return {
    ...original,
    useIsScreenReaderEnabled: vi.fn(),
  };
});

vi.mock('./components/MainContent.js', () => ({
  MainContent: () => <Text>MainContent</Text>,
}));

vi.mock('./components/DialogManager.js', () => ({
  DialogManager: () => <Text>DialogManager</Text>,
}));

vi.mock('./components/Composer.js', () => ({
  Composer: () => <Text>Composer</Text>,
}));

vi.mock('./components/Notifications.js', () => ({
  Notifications: () => <Text>Notifications</Text>,
}));

vi.mock('./components/QuittingDisplay.js', () => ({
  QuittingDisplay: () => <Text>Quitting...</Text>,
}));

vi.mock('./components/Footer.js', () => ({
  Footer: () => <Text>Footer</Text>,
}));

<<<<<<< HEAD
vi.mock('./components/Header.js', () => ({
  Header: vi.fn(() => null),
}));

vi.mock('./utils/updateCheck.js', () => ({
  checkForUpdates: vi.fn(),
}));

vi.mock('../config/auth.js', () => ({
  validateAuthMethod: vi.fn(),
}));

vi.mock('../hooks/useTerminalSize.js', () => ({
  useTerminalSize: vi.fn(),
}));

const mockedCheckForUpdates = vi.mocked(checkForUpdates);
const { isGitRepository: mockedIsGitRepository } = vi.mocked(
  await import('eadp-code-core'),
);

vi.mock('node:child_process');

describe('App UI', () => {
  let mockConfig: MockServerConfig;
  let mockSettings: LoadedSettings;
  let mockVersion: string;
  let currentUnmount: (() => void) | undefined;

  const createMockSettings = (
    settings: {
      system?: Partial<Settings>;
      user?: Partial<Settings>;
      workspace?: Partial<Settings>;
    } = {},
  ): LoadedSettings => {
    const systemSettingsFile: SettingsFile = {
      path: '/system/settings.json',
      settings: settings.system || {},
    };
    const systemDefaultsFile: SettingsFile = {
      path: '/system/system-defaults.json',
      settings: {},
    };
    const userSettingsFile: SettingsFile = {
      path: '/user/settings.json',
      settings: settings.user || {},
    };
    const workspaceSettingsFile: SettingsFile = {
      path: '/workspace/.gemini/settings.json',
      settings: settings.workspace || {},
    };
    return new LoadedSettings(
      systemSettingsFile,
      systemDefaultsFile,
      userSettingsFile,
      workspaceSettingsFile,
      [],
      true,
      new Set(),
    );
=======
describe('App', () => {
  const mockUIState: Partial<UIState> = {
    streamingState: StreamingState.Idle,
    quittingMessages: null,
    dialogsVisible: false,
    mainControlsRef: { current: null },
    historyManager: {
      addItem: vi.fn(),
      history: [],
      updateItem: vi.fn(),
      clearItems: vi.fn(),
      loadHistory: vi.fn(),
    },
>>>>>>> main
  };

  it('should render main content and composer when not quitting', () => {
    const { lastFrame } = render(
      <UIStateContext.Provider value={mockUIState as UIState}>
        <App />
      </UIStateContext.Provider>,
    );

    expect(lastFrame()).toContain('MainContent');
    expect(lastFrame()).toContain('Notifications');
    expect(lastFrame()).toContain('Composer');
  });

  it('should render quitting display when quittingMessages is set', () => {
    const quittingUIState = {
      ...mockUIState,
      quittingMessages: [{ id: 1, type: 'user', text: 'test' }],
    } as UIState;

    const { lastFrame } = render(
      <UIStateContext.Provider value={quittingUIState}>
        <App />
      </UIStateContext.Provider>,
    );

    expect(lastFrame()).toContain('Quitting...');
  });

  it('should render dialog manager when dialogs are visible', () => {
    const dialogUIState = {
      ...mockUIState,
      dialogsVisible: true,
    } as UIState;

    const { lastFrame } = render(
      <UIStateContext.Provider value={dialogUIState}>
        <App />
      </UIStateContext.Provider>,
    );

    expect(lastFrame()).toContain('MainContent');
    expect(lastFrame()).toContain('Notifications');
    expect(lastFrame()).toContain('DialogManager');
  });

  it('should show Ctrl+C exit prompt when dialogs are visible and ctrlCPressedOnce is true', () => {
    const ctrlCUIState = {
      ...mockUIState,
      dialogsVisible: true,
      ctrlCPressedOnce: true,
    } as UIState;

    const { lastFrame } = render(
      <UIStateContext.Provider value={ctrlCUIState}>
        <App />
      </UIStateContext.Provider>,
    );

    expect(lastFrame()).toContain('Press Ctrl+C again to exit.');
  });

  it('should show Ctrl+D exit prompt when dialogs are visible and ctrlDPressedOnce is true', () => {
    const ctrlDUIState = {
      ...mockUIState,
      dialogsVisible: true,
      ctrlDPressedOnce: true,
    } as UIState;

    const { lastFrame } = render(
      <UIStateContext.Provider value={ctrlDUIState}>
        <App />
      </UIStateContext.Provider>,
    );

    expect(lastFrame()).toContain('Press Ctrl+D again to exit.');
  });

  it('should render ScreenReaderAppLayout when screen reader is enabled', () => {
    (useIsScreenReaderEnabled as vi.Mock).mockReturnValue(true);

    const { lastFrame } = render(
      <UIStateContext.Provider value={mockUIState as UIState}>
        <App />
      </UIStateContext.Provider>,
    );

    expect(lastFrame()).toContain(
      'Notifications\nFooter\nMainContent\nComposer',
    );
  });

  it('should render DefaultAppLayout when screen reader is not enabled', () => {
    (useIsScreenReaderEnabled as vi.Mock).mockReturnValue(false);

    const { lastFrame } = render(
      <UIStateContext.Provider value={mockUIState as UIState}>
        <App />
      </UIStateContext.Provider>,
    );

    expect(lastFrame()).toContain('MainContent\nNotifications\nComposer');
  });
});
