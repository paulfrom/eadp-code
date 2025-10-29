/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useIsScreenReaderEnabled } from 'ink';
import { useTerminalSize } from './hooks/useTerminalSize.js';
<<<<<<< HEAD
import { useGeminiStream } from './hooks/useGeminiStream.js';
import { useLoadingIndicator } from './hooks/useLoadingIndicator.js';
import { useThemeCommand } from './hooks/useThemeCommand.js';
import { useAuthCommand } from './hooks/useAuthCommand.js';
import { useQwenAuth } from './hooks/useQwenAuth.js';
import { useFolderTrust } from './hooks/useFolderTrust.js';
import { useEditorSettings } from './hooks/useEditorSettings.js';
import { useQuitConfirmation } from './hooks/useQuitConfirmation.js';
import { useWelcomeBack } from './hooks/useWelcomeBack.js';
import { useDialogClose } from './hooks/useDialogClose.js';
import { useSlashCommandProcessor } from './hooks/slashCommandProcessor.js';
import { useSubagentCreateDialog } from './hooks/useSubagentCreateDialog.js';
import { useAgentsManagerDialog } from './hooks/useAgentsManagerDialog.js';
import { useAutoAcceptIndicator } from './hooks/useAutoAcceptIndicator.js';
import { useMessageQueue } from './hooks/useMessageQueue.js';
import { useConsoleMessages } from './hooks/useConsoleMessages.js';
import { Header } from './components/Header.js';
import { LoadingIndicator } from './components/LoadingIndicator.js';
import { AutoAcceptIndicator } from './components/AutoAcceptIndicator.js';
import { ShellModeIndicator } from './components/ShellModeIndicator.js';
import { InputPrompt } from './components/InputPrompt.js';
import { Footer } from './components/Footer.js';
import { ThemeDialog } from './components/ThemeDialog.js';
import { AuthDialog } from './components/AuthDialog.js';
import { AuthInProgress } from './components/AuthInProgress.js';
import { QwenOAuthProgress } from './components/QwenOAuthProgress.js';
import { EditorSettingsDialog } from './components/EditorSettingsDialog.js';
import { FolderTrustDialog } from './components/FolderTrustDialog.js';
import { ShellConfirmationDialog } from './components/ShellConfirmationDialog.js';
import { QuitConfirmationDialog } from './components/QuitConfirmationDialog.js';
import { RadioButtonSelect } from './components/shared/RadioButtonSelect.js';
import { ModelSelectionDialog } from './components/ModelSelectionDialog.js';
import {
  ModelSwitchDialog,
  type VisionSwitchOutcome,
} from './components/ModelSwitchDialog.js';
import {
  getOpenAIAvailableModelFromEnv,
  getFilteredQwenModels,
  type AvailableModel,
} from './models/availableModels.js';
import { processVisionSwitchOutcome } from './hooks/useVisionAutoSwitch.js';
import {
  AgentCreationWizard,
  AgentsManagerDialog,
} from './components/subagents/index.js';
import { Colors } from './colors.js';
import { loadHierarchicalGeminiMemory } from '../config/config.js';
import type { LoadedSettings } from '../config/settings.js';
import { SettingScope } from '../config/settings.js';
import { Tips } from './components/Tips.js';
import { ConsolePatcher } from './utils/ConsolePatcher.js';
import { registerCleanup } from '../utils/cleanup.js';
import { DetailedMessagesDisplay } from './components/DetailedMessagesDisplay.js';
import { HistoryItemDisplay } from './components/HistoryItemDisplay.js';
import { ContextSummaryDisplay } from './components/ContextSummaryDisplay.js';
import { useHistory } from './hooks/useHistoryManager.js';
import process from 'node:process';
import type { EditorType, Config, IdeContext } from 'eadp-code-core';
import {
  ApprovalMode,
  getAllGeminiMdFilenames,
  isEditorAvailable,
  getErrorMessage,
  AuthType,
  logFlashFallback,
  FlashFallbackEvent,
  ideContext,
  isProQuotaExceededError,
  isGenericQuotaExceededError,
  UserTierId,
} from 'eadp-code-core';
import type { IdeIntegrationNudgeResult } from './IdeIntegrationNudge.js';
import { IdeIntegrationNudge } from './IdeIntegrationNudge.js';
import { validateAuthMethod } from '../config/auth.js';
import { useLogger } from './hooks/useLogger.js';
=======
import { lerp } from '../utils/math.js';
import { useUIState } from './contexts/UIStateContext.js';
>>>>>>> main
import { StreamingContext } from './contexts/StreamingContext.js';
import { QuittingDisplay } from './components/QuittingDisplay.js';
import { ScreenReaderAppLayout } from './layouts/ScreenReaderAppLayout.js';
import { DefaultAppLayout } from './layouts/DefaultAppLayout.js';

const getContainerWidth = (terminalWidth: number): string => {
  if (terminalWidth <= 80) {
    return '98%';
  }
  if (terminalWidth >= 132) {
    return '90%';
  }

  // Linearly interpolate between 80 columns (98%) and 132 columns (90%).
  const t = (terminalWidth - 80) / (132 - 80);
  const percentage = lerp(98, 90, t);

  return `${Math.round(percentage)}%`;
};

export const App = () => {
  const uiState = useUIState();
  const isScreenReaderEnabled = useIsScreenReaderEnabled();
  const { columns } = useTerminalSize();
  const containerWidth = getContainerWidth(columns);

  if (uiState.quittingMessages) {
    return <QuittingDisplay />;
  }

  return (
    <StreamingContext.Provider value={uiState.streamingState}>
      {isScreenReaderEnabled ? (
        <ScreenReaderAppLayout />
      ) : (
        <DefaultAppLayout width={containerWidth} />
      )}
    </StreamingContext.Provider>
  );
};
