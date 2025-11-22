/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CommandContext, SlashCommand, SlashCommandActionReturn } from './types.js';
import { CommandKind } from './types.js';
import { MessageType } from '../types.js';

// Function to extract SEI package versions from dependency output
function extractSeiVersions(dependencyOutput: string): Map<string, string> {
  const versions = new Map<string, string>();
  const lines = dependencyOutput.split('\n');

  // Multiple regex patterns to catch different formats of dependency output
  // Pattern 1: For typical Gradle dependency output: "group:artifact:version"
  const pattern1 = /([a-zA-Z0-9\.\-_]+\.[sS][eE][iI][a-zA-Z0-9\.\-_]*):([a-zA-Z0-9\.\-_]+):([^\s]+)/g;
  // Pattern 2: For dependencyInsight output that might have different formatting
  const pattern2 = /([a-zA-Z0-9\.\-_]*[sS][eE][iI][a-zA-Z0-9\.\-_]*):([a-zA-Z0-9\.\-_]+):([^\s]+)/g;
  // Pattern 3: For any line that has "sei" in it with version format
  const pattern3 = /([^\s]*[sS][eE][iI][^\s]*):([^\s]*):([^\s]+)/g;

  for (const line of lines) {
    if (line.toLowerCase().includes('sei')) {
      // Try pattern 1 (most common Gradle format)
      let match;
      while ((match = pattern1.exec(line)) !== null) {
        const group = match[1];
        const artifact = match[2];
        const version = match[3];
        const fullKey = `${group}:${artifact}`;
        // Clean up version string (remove any extra characters)
        const cleanVersion = version.replace(/[^\d\.\-\w]/g, '').replace(/[\s\)]+$/, '');
        versions.set(fullKey, cleanVersion);
      }

      // Try pattern 2 (SEI in artifact name)
      pattern2.lastIndex = 0; // Reset regex index
      while ((match = pattern2.exec(line)) !== null) {
        const group = match[1];
        const artifact = match[2];
        const version = match[3];
        const fullKey = `${group}:${artifact}`;
        // Clean up version string (remove any extra characters)
        const cleanVersion = version.replace(/[^\d\.\-\w]/g, '').replace(/[\s\)]+$/, '');
        versions.set(fullKey, cleanVersion);
      }

      // Try pattern 3 (catch-all for any "artifact:version" format)
      pattern3.lastIndex = 0; // Reset regex index
      while ((match = pattern3.exec(line)) !== null) {
        const fullArtifact = match[1];
        const version = match[3];

        // Check if this is likely an SEI dependency by examining the artifact name or group
        if (fullArtifact.toLowerCase().includes('sei')) {
          // Use full artifact name as the key
          // Clean up version string
          const cleanVersion = version.replace(/[^\d\.\-\w]/g, '').replace(/[\s\)]+$/, '');
          versions.set(fullArtifact, cleanVersion);
        }
      }
    }
  }

  return versions;
}

// Function to format SEI package version summary
function formatVersionSummary(versions: Map<string, string>): string {
  if (versions.size === 0) {
    return 'No SEI packages found in the project.';
  }

  const summaryLines = ['SEI Package Versions Summary:', ''];
  for (const [artifact, version] of versions.entries()) {
    summaryLines.push(`  ${artifact}:${version}`);
  }

  return summaryLines.join('\n');
}

// Function to read module names from settings.gradle or settings.gradle.kts
async function readModulesFromSettings(projectRoot: string): Promise<string[]> {
  const { promises: fs } = await import('node:fs');
  const path = await import('node:path');

  const settingsGradlePath = path.join(projectRoot, 'settings.gradle');
  const settingsGradleKtsPath = path.join(projectRoot, 'settings.gradle.kts');

  let settingsContent = '';

  // Try to read settings.gradle first, then settings.gradle.kts
  if (await fs.access(settingsGradlePath).then(() => true).catch(() => false)) {
    settingsContent = await fs.readFile(settingsGradlePath, 'utf-8');
  } else if (await fs.access(settingsGradleKtsPath).then(() => true).catch(() => false)) {
    settingsContent = await fs.readFile(settingsGradleKtsPath, 'utf-8');
  } else {
    // No settings file found, return empty array
    return [];
  }

  // Extract module names from include statements
  // Look for patterns like: include 'module-name' or include ':module-name'
  const includePattern = /include\s+['"]([^'"]+)['"]/g;
  const modules: string[] = [];

  let match;
  while ((match = includePattern.exec(settingsContent)) !== null) {
    // Extract the module name from the include statement
    const module = match[1].trim();
    if (module) {
      modules.push(module);
    }
  }

  return modules;
}

// Function to get SEI package versions using dependencyInsight for each module
async function getSeiPackageVersions(context: CommandContext, args?: string): Promise<SlashCommandActionReturn | void> {
  try {
    // Check if we're in a Gradle project
    const { promises: fs } = await import('node:fs');
    const path = await import('node:path');
    const child_process = await import('node:child_process');
    const { promisify } = await import('node:util');

    const exec = promisify(child_process.exec);

    const projectRoot = context.services.config?.getProjectRoot() || process.cwd();
    const settingsGradlePath = path.join(projectRoot, 'settings.gradle');
    const settingsGradleKtsPath = path.join(projectRoot, 'settings.gradle.kts');
    const buildGradlePath = path.join(projectRoot, 'build.gradle');
    const buildGradleKtsPath = path.join(projectRoot, 'build.gradle.kts');

    const settingsGradleExists = await fs.access(settingsGradlePath).then(() => true).catch(() => false);
    const settingsGradleKtsExists = await fs.access(settingsGradleKtsPath).then(() => true).catch(() => false);
    const buildGradleExists = await fs.access(buildGradlePath).then(() => true).catch(() => false);
    const buildGradleKtsExists = await fs.access(buildGradleKtsPath).then(() => true).catch(() => false);

    if (!settingsGradleExists && !settingsGradleKtsExists && !buildGradleExists && !buildGradleKtsExists) {
      context.ui.addItem({
        type: MessageType.WARNING,
        text: 'No Gradle project found in current directory. Please navigate to a Gradle project directory.',
      }, Date.now());
      return;
    }

    context.ui.addItem({
      type: MessageType.INFO,
      text: `Looking for SEI package versions using Gradle dependencyInsight...`,
    }, Date.now());

    // Use Gradle directly since it's assumed to be installed
    const gradleCmd = process.platform === 'win32' ? 'gradle.bat' : 'gradle';

    try {
      // Read module names from settings.gradle
      const modules = await readModulesFromSettings(projectRoot);

      let allOutput = '';

      if (modules.length > 0) {
        // Run dependencyInsight for each module that might contain SEI dependencies
        for (const module of modules) {
          try {
            const moduleCommand = `${gradleCmd} -q ${module}:dependencyInsight --dependency sei`;
            const result = await exec(moduleCommand, { cwd: projectRoot });
            allOutput += result.stdout + '\n';
          } catch (moduleError) {
            // If a specific module fails, continue with others
            console.debug(`Could not get dependency insight for module ${module}:`, moduleError);
          }
        }
      } else {
        // If no modules found, try the root project
        const rootCommand = `${gradleCmd} -q dependencyInsight --dependency sei`;
        const result = await exec(rootCommand, { cwd: projectRoot });
        allOutput = result.stdout;
      }

      // Extract and summarize SEI package versions from all outputs
      const versions = extractSeiVersions(allOutput);
      const summary = formatVersionSummary(versions);

      context.ui.addItem({
        type: MessageType.INFO,
        text: summary,
      }, Date.now());

      // Generate a prompt for the large model to analyze the SEI packages
      const analysisPrompt = generateSeiAnalysisPrompt(versions, projectRoot, 'version');

      // Submit the prompt to the large model for analysis
      return {
        type: 'submit_prompt',
        content: analysisPrompt
      };
    } catch (execError) {
      // If the primary approach fails, fall back to the previous approach
      context.ui.addItem({
        type: MessageType.WARNING,
        text: 'Could not execute dependencyInsight for modules. Trying alternative approach...',
      }, Date.now());

      try {
        // Execute a more comprehensive command to find SEI dependencies across all configurations
        const command = process.platform === 'win32'
          ? `${gradleCmd} dependencies --configuration compileClasspath | findstr /i sei && ${gradleCmd} dependencies --configuration runtimeClasspath | findstr /i sei`
          : `${gradleCmd} dependencies --configuration compileClasspath | grep -i sei && ${gradleCmd} dependencies --configuration runtimeClasspath | grep -i sei`;

        const result = await exec(command, { cwd: projectRoot });

        // Extract versions from dependencies output
        const versions = extractSeiVersions(result.stdout);
        const summary = formatVersionSummary(versions);

        context.ui.addItem({
          type: MessageType.INFO,
          text: summary,
        }, Date.now());

        // Generate a prompt for the large model to analyze the SEI packages
        const analysisPrompt = generateSeiAnalysisPrompt(versions, projectRoot, 'version');

        // Submit the prompt to the large model for analysis
        return {
          type: 'submit_prompt',
          content: analysisPrompt
        };
      } catch (fallbackError) {
        // Final fallback: scan build files directly
        context.ui.addItem({
          type: MessageType.WARNING,
          text: 'Could not execute Gradle commands. Scanning build files directly...',
        }, Date.now());

        // Read build.gradle files to find SEI dependencies
        const buildGradlePath = path.join(projectRoot, 'build.gradle');
        const buildGradleKtsPath = path.join(projectRoot, 'build.gradle.kts');

        let fileContent = '';

        try {
          if (await fs.access(buildGradlePath).then(() => true).catch(() => false)) {
            fileContent = await fs.readFile(buildGradlePath, 'utf-8');
          } else if (await fs.access(buildGradleKtsPath).then(() => true).catch(() => false)) {
            fileContent = await fs.readFile(buildGradleKtsPath, 'utf-8');
          }
        } catch (readError) {
          console.error('Error reading build file:', readError);
        }

        // Extract SEI dependencies from file content
        const fileVersions = extractSeiVersions(fileContent);
        const fileSummary = formatVersionSummary(fileVersions);

        context.ui.addItem({
          type: MessageType.INFO,
          text: fileSummary,
        }, Date.now());

        // Generate a prompt for the large model to analyze the SEI packages
        const analysisPrompt = generateSeiAnalysisPrompt(fileVersions, projectRoot, 'version');

        // Submit the prompt to the large model for analysis
        return {
          type: 'submit_prompt',
          content: analysisPrompt
        };
      }
    }
  } catch (error) {
    context.ui.addItem({
      type: MessageType.ERROR,
      text: `Error getting SEI package versions: ${error instanceof Error ? error.message : String(error)}`,
    }, Date.now());
  }
}

// Function to format version comparison summary
function formatVersionComparison(before: Map<string, string>, after: Map<string, string>): string {
  const allArtifacts = new Set([...before.keys(), ...after.keys()]);
  const changes: string[] = [];

  for (const artifact of allArtifacts) {
    const beforeVersion = before.get(artifact);
    const afterVersion = after.get(artifact);

    if (beforeVersion && afterVersion) {
      if (beforeVersion !== afterVersion) {
        changes.push(`  ${artifact}: ${beforeVersion} -> ${afterVersion} (CHANGED)`);
      } else {
        changes.push(`  ${artifact}: ${beforeVersion} (no change)`);
      }
    } else if (beforeVersion) {
      changes.push(`  ${artifact}: ${beforeVersion} -> REMOVED`);
    } else if (afterVersion) {
      changes.push(`  ${artifact}: ADDED -> ${afterVersion}`);
    }
  }

  if (changes.length === 0) {
    return 'No SEI package changes detected.';
  }

  return ['SEI Package Version Changes:', '', ...changes].join('\n');
}

// Function to generate a prompt for the large model about SEI packages
function generateSeiAnalysisPrompt(versions: Map<string, string>, projectRoot: string, commandType: 'version' | 'refresh', refreshComparison?: string): string {
  // Format the SEI packages list
  let packagesList = '';
  for (const [artifact, version] of versions.entries()) {
    packagesList += `  - ${artifact}:${version}\n`;
  }

  if (packagesList === '') {
    packagesList = '  项目中未找到 SEI 包。';
  }

  // Base prompt
  let basePrompt = `你是 EADP Code，一个交互式 CLI 代理。我已经识别出位于 ${projectRoot} 的项目中的以下 SEI 包：\n\n${packagesList}\n`;

  if (commandType === 'version') {
    basePrompt += `
请分析这些 SEI 包并提供：

1. 每个 SEI 包的简要描述及其在 EADP（企业应用开发平台）生态系统中的用途
2. 这些包提供的常见用例和功能
3. 在当前项目上下文中优化使用这些包的建议
4. 这些包版本的潜在兼容性或升级注意事项
5. 检查项目文件，确定这些 SEI 包在代码库中的使用位置和方式（搜索导入、依赖、配置或使用情况）
6. 提供这些包被实现的具体文件路径和代码示例

重点帮助开发者了解如何在特定项目中充分利用这些 SEI 包。
`;
  } else if (commandType === 'refresh') {
    basePrompt += `
项目刚刚进行了依赖更新。以下是 SEI 包版本的变化：

${refreshComparison}

请分析：

1. 每个 SEI 包的简要描述及其在 EADP 生态系统中的用途
2. 版本变化的影响分析 - 版本之间可能发生了什么变化
3. 这些版本更新可能引起的潜在兼容性问题
4. 为适应新版本可能需要的代码修改
5. 检查项目文件，确定这些 SEI 包在代码库中的使用位置并评估是否需要任何更新
6. 提供这些包被实现和可能需要更改的具体文件路径和代码示例
7. 刷新后的测试建议

重点帮助开发者了解这些版本变化的影响以及如何相应调整他们的实现。
`;
  }

  return basePrompt;
}

// Function to run dependencyInsight for all modules and collect output
async function runDependencyInsightForAllModules(projectRoot: string, gradleCmd: string): Promise<string> {
  const child_process = await import('node:child_process');
  const { promisify } = await import('node:util');
  const exec = promisify(child_process.exec);

  const modules = await readModulesFromSettings(projectRoot);
  let allOutput = '';

  if (modules.length > 0) {
    // Run dependencyInsight for each module that might contain SEI dependencies
    for (const module of modules) {
      try {
        const moduleCommand = `${gradleCmd} -q ${module}:dependencyInsight --dependency sei`;
        const result = await exec(moduleCommand, { cwd: projectRoot });
        allOutput += result.stdout + '\n';
      } catch (moduleError) {
        // If a specific module fails, continue with others
        console.debug(`Could not get dependency insight for module ${module}:`, moduleError);
      }
    }
  } else {
    // If no modules found, try the root project
    const rootCommand = `${gradleCmd} -q dependencyInsight --dependency sei`;
    const result = await exec(rootCommand, { cwd: projectRoot });
    allOutput = result.stdout;
  }

  return allOutput;
}

// Function to refresh Gradle packages
async function refreshGradlePackages(context: CommandContext, args?: string): Promise<SlashCommandActionReturn | void> {
  try {
    // Check if we're in a Gradle project
    const { promises: fs } = await import('node:fs');
    const path = await import('node:path');
    const child_process = await import('node:child_process');
    const { promisify } = await import('node:util');

    const exec = promisify(child_process.exec);

    const projectRoot = context.services.config?.getProjectRoot() || process.cwd();
    const settingsGradlePath = path.join(projectRoot, 'settings.gradle');
    const settingsGradleKtsPath = path.join(projectRoot, 'settings.gradle.kts');
    const buildGradlePath = path.join(projectRoot, 'build.gradle');
    const buildGradleKtsPath = path.join(projectRoot, 'build.gradle.kts');

    const settingsGradleExists = await fs.access(settingsGradlePath).then(() => true).catch(() => false);
    const settingsGradleKtsExists = await fs.access(settingsGradleKtsPath).then(() => true).catch(() => false);
    const buildGradleExists = await fs.access(buildGradlePath).then(() => true).catch(() => false);
    const buildGradleKtsExists = await fs.access(buildGradleKtsPath).then(() => true).catch(() => false);

    if (!settingsGradleExists && !settingsGradleKtsExists && !buildGradleExists && !buildGradleKtsExists) {
      context.ui.addItem({
        type: MessageType.WARNING,
        text: 'No Gradle project found. Please navigate to a Gradle project directory.',
      }, Date.now());
      return;
    }

    context.ui.addItem({
      type: MessageType.INFO,
      text: `Refreshing Gradle packages... This may take a moment.`,
    }, Date.now());

    // Use Gradle directly since it's assumed to be installed
    const gradleCmd = process.platform === 'win32' ? 'gradle.bat' : 'gradle';

    try {
      // Get SEI package versions before refresh using module-specific dependencyInsight
      const beforeOutput = await runDependencyInsightForAllModules(projectRoot, gradleCmd);
      const beforeVersions = extractSeiVersions(beforeOutput);

      context.ui.addItem({
        type: MessageType.INFO,
        text: 'SEI package versions before refresh:',
      }, Date.now());

      context.ui.addItem({
        type: MessageType.INFO,
        text: formatVersionSummary(beforeVersions),
      }, Date.now());

      // Execute Gradle refresh command
      await exec(`${gradleCmd} --refresh-dependencies`, { cwd: projectRoot });

      // Get SEI package versions after refresh using module-specific dependencyInsight
      const afterOutput = await runDependencyInsightForAllModules(projectRoot, gradleCmd);
      const afterVersions = extractSeiVersions(afterOutput);

      // Compare versions and show changes
      const comparison = formatVersionComparison(beforeVersions, afterVersions);

      context.ui.addItem({
        type: MessageType.INFO,
        text: 'SEI package versions after refresh:',
      }, Date.now());

      context.ui.addItem({
        type: MessageType.INFO,
        text: formatVersionSummary(afterVersions),
      }, Date.now());

      context.ui.addItem({
        type: MessageType.INFO,
        text: 'Version changes summary:',
      }, Date.now());

      context.ui.addItem({
        type: MessageType.INFO,
        text: comparison,
      }, Date.now());

      // Generate a prompt for the large model to analyze the SEI packages and version changes
      const analysisPrompt = generateSeiAnalysisPrompt(afterVersions, projectRoot, 'refresh', comparison);

      // Submit the prompt to the large model for analysis
      return {
        type: 'submit_prompt',
        content: analysisPrompt
      };

    } catch (execError) {
      context.ui.addItem({
        type: MessageType.WARNING,
        text: `Error during refresh: ${execError instanceof Error ? execError.message : String(execError)}`,
      }, Date.now());

      // Fallback using the same module-specific approach as the version command
      try {
        // Before refresh
        const beforeOutput = await runDependencyInsightForAllModules(projectRoot, gradleCmd);
        const beforeVersions = extractSeiVersions(beforeOutput);

        // Execute Gradle refresh command
        await exec(`${gradleCmd} --refresh-dependencies`, { cwd: projectRoot });

        // After refresh
        const afterOutput = await runDependencyInsightForAllModules(projectRoot, gradleCmd);
        const afterVersions = extractSeiVersions(afterOutput);

        // Compare versions and show changes
        const comparison = formatVersionComparison(beforeVersions, afterVersions);

        context.ui.addItem({
          type: MessageType.INFO,
          text: comparison,
        }, Date.now());

        // Generate a prompt for the large model to analyze the SEI packages and version changes
        const analysisPrompt = generateSeiAnalysisPrompt(afterVersions, projectRoot, 'refresh', comparison);

        // Submit the prompt to the large model for analysis
        return {
          type: 'submit_prompt',
          content: analysisPrompt
        };
      } catch (fallbackError) {
        // If module-specific approach fails, use the comprehensive fallback
        await exec(`${gradleCmd} --refresh-dependencies`, { cwd: projectRoot });

        const command = process.platform === 'win32'
          ? `${gradleCmd} dependencies --configuration compileClasspath | findstr /i sei && ${gradleCmd} dependencies --configuration runtimeClasspath | findstr /i sei`
          : `${gradleCmd} dependencies --configuration compileClasspath | grep -i sei && ${gradleCmd} dependencies --configuration runtimeClasspath | grep -i sei`;

        const result = await exec(command, { cwd: projectRoot });

        // Extract versions from dependencies output
        const versions = extractSeiVersions(result.stdout);
        const summary = formatVersionSummary(versions);

        context.ui.addItem({
          type: MessageType.INFO,
          text: `Refresh completed. SEI dependencies:\n${summary}`,
        }, Date.now());

        // Generate a prompt for the large model to analyze the SEI packages
        const analysisPrompt = generateSeiAnalysisPrompt(versions, projectRoot, 'refresh', summary);

        // Submit the prompt to the large model for analysis
        return {
          type: 'submit_prompt',
          content: analysisPrompt
        };
      }
    }
  } catch (error) {
    context.ui.addItem({
      type: MessageType.ERROR,
      text: `Error refreshing Gradle packages: ${error instanceof Error ? error.message : String(error)}`,
    }, Date.now());
  }
}

export const eadpCommand: SlashCommand = {
  name: 'eadp',
  description: 'EADP-specific commands for Gradle package management',
  kind: CommandKind.BUILT_IN,
  action: async (context: CommandContext, args?: string): Promise<SlashCommandActionReturn | void> => {
    const subCommandName = args?.trim().split(' ')[0]?.toLowerCase() || '';

    // If no subcommand is provided, show help
    if (!subCommandName) {
      const helpText = [
        'EADP commands for Gradle package management:',
        '  /eadp version - Show current SEI package versions via Gradle',
        '  /eadp refresh - Refresh Gradle packages and show latest SEI dependencies'
      ].join('\n');

      context.ui.addItem({
        type: MessageType.INFO,
        text: helpText,
      }, Date.now());
      return;
    }

    // Handle subcommands
    if (subCommandName === 'version') {
      return getSeiPackageVersions(context, args?.substring(subCommandName.length).trim());
    } else if (subCommandName === 'refresh') {
      return refreshGradlePackages(context, args?.substring(subCommandName.length).trim());
    } else {
      context.ui.addItem({
        type: MessageType.ERROR,
        text: `Unknown subcommand: ${subCommandName}. Available subcommands: version, refresh`,
      }, Date.now());
      return;
    }
  },
  subCommands: [
    {
      name: 'version',
      description: 'Show current SEI package versions via Gradle',
      kind: CommandKind.BUILT_IN,
      action: getSeiPackageVersions,
    },
    {
      name: 'refresh',
      description: 'Refresh Gradle packages and show latest SEI dependencies',
      kind: CommandKind.BUILT_IN,
      action: refreshGradlePackages,
    }
  ],
};