/**
 * @license
 * Copyright 2025 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  CommandContext,
  SlashCommand,
  SlashCommandActionReturn,
} from './types.js';
import { getCurrentGeminiMdFilename } from 'eadp-code-core';
import { CommandKind } from './types.js';
import { Text } from 'ink';
import React from 'react';

export const initCommand: SlashCommand = {
  name: 'init',
  description: 'Analyzes the project and creates a tailored EADP.md file.',
  kind: CommandKind.BUILT_IN,
  action: async (
    context: CommandContext,
    _args: string,
  ): Promise<SlashCommandActionReturn> => {
    if (!context.services.config) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Configuration not available.',
      };
    }
    const targetDir = context.services.config.getTargetDir();
    const contextFileName = getCurrentGeminiMdFilename();
    const contextFilePath = path.join(targetDir, contextFileName);

    try {
      if (fs.existsSync(contextFilePath)) {
        // If file exists but is empty (or whitespace), continue to initialize
        try {
          const existing = fs.readFileSync(contextFilePath, 'utf8');
          if (existing && existing.trim().length > 0) {
            // File exists and has content - ask for confirmation to overwrite
            if (!context.overwriteConfirmed) {
              return {
                type: 'confirm_action',
                // TODO: Move to .tsx file to use JSX syntax instead of React.createElement
                // For now, using React.createElement to maintain .ts compatibility for PR review
                prompt: React.createElement(
                  Text,
                  null,
                  `A ${contextFileName} file already exists in this directory. Do you want to regenerate it?`,
                ),
                originalInvocation: {
                  raw: context.invocation?.raw || '/init',
                },
              };
            }
            // User confirmed overwrite, continue with regeneration
          }
        } catch {
          // If we fail to read, conservatively proceed to (re)create the file
        }
      }

      // Ensure an empty context file exists before prompting the model to populate it
      try {
        fs.writeFileSync(contextFilePath, '', 'utf8');
        context.ui.addItem(
          {
            type: 'info',
            text: `Empty ${contextFileName} created. Now analyzing the project to populate it.`,
          },
          Date.now(),
        );
      } catch (err) {
        return {
          type: 'message',
          messageType: 'error',
          content: `Failed to create ${contextFileName}: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    } catch (error) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Unexpected error preparing ${contextFileName}: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    return {
      type: 'submit_prompt',
      content: `
      你是 EADP Code，一个交互式 CLI 代理。分析当前目录并生成一个全面的 ${contextFileName} 文件，用作未来交互的说明上下文。

**分析流程：**

1. **初步探索：**
   - 首先列出所有文件和目录以了解高层结构。
   - 检查是否存在 \`README.md\` 或 \`README.txt\` 文件并阅读，它通常包含关键的项目上下文。

2. **迭代深入（最多10个文件）：**
   - 根据初步发现，优先阅读能揭示项目性质的关键文件：
     - 对于**前端项目**：检查 \`package.json\`、\`src/\` 和任何 React 组件文件。
     - 对于**后端项目**：检查 \`build.gradle\`、\`settings.gradle\` 和 \`src/main/java\` 下的 Java 源文件。
   - 使用每个文件的见解来指导后续文件的选择。你不需要预先选择全部10个文件——让分析迭代发展。

3. **项目类型识别：**
   - **前端项目**：通过存在 \`package.json\` 和 React 相关依赖来识别。**所有前端项目必须使用 \`@sei/suid\` 包**。
   - **后端项目**：通过 \`build.gradle\` 和 Java 源代码结构来识别。**所有后端项目都属于 \`com.changhong.sei\` 包命名空间**。
   - **没有"非代码"项目**。每个分析的目录都是如上定义的前端或后端代码项目。

**${contextFileName} 内容生成：**

# 后端项目
- **技术栈**: Java
- **依赖分析**: 通过 \`build.gradle\` 分析项目依赖
- **模块结构**: \`settings.gradle\` 中定义的项目模块分类

**后端分析流程：**
1. **公共方法分析**: 首先，检查非业务领域并分析通用的工具方法、帮助类和共享服务。寻找像 utils、common、helper、core、base、framework 或类似命名模式的包。
2. **SEI 包审查**: 在依赖文件 (build.gradle) 中识别并分析已引用的 SEI 包，包括：
   - \`sei-cloud-nacos-starter\`: 用于微服务注册、发现和配置。
   - \`sei-basic-api\`: 用于访问用户、组织、公司、角色和权限数据。
   - \`sei-edm-sdk\`: 用于附件/文件存储操作。
   - \`sei-notify-sdk\`: 用于发送通知（短信、邮件、内部消息）。
   - \`sei-serial-sdk\`: 用于生成统一序列号（例如，订单ID）。
3. **总结**: 结合公共方法和 SEI 包使用的分析，总结其主要用途以及如何支持项目架构。
4. **业务分析**: 最后，分析项目的业务特性、领域逻辑、控制器、服务和数据模型以了解核心功能。
5. **编程风格**: 记录项目的关键编程风格、编码约定、架构模式和开发实践。

**关键组件和用途**：
- \`sei-cloud-nacos-starter\`: 用于服务注册和发现的微服务治理套件
- \`sei-basic-api\`: 提供用户、组织、公司、权限和职位管理API的基本应用套件
- \`sei-edm-sdk\`: 用于文件上传和管理的附件存储服务
- \`sei-notify-sdk\`: 用于系统通知和警报的消息发送服务
- \`sei-serial-sdk\`: 用于生成唯一订单标识符的统一订单号服务

# 前端项目
- **技术栈**: React
- **依赖分析**: 通过 \`package.json\` 分析项目依赖
- **必需包**: 所有前端项目必须包含对 \`@sei/suid\` 的引用

**前端分析流程：**
1. **公共组件分析**: 首先，检查项目中现有的公共/通用组件。特别查找名为 \`components\`、\`common\`、\`shared\`、\`utils\` 或类似模式的文件夹。记录已存在可重用组件及其用途。
2. **SEI 包分析**: 分析项目中如何使用 \`@sei/suid\`，包括导入的组件、样式和包中利用的功能。
3. **SEI 专家视角**: 从 SEI 前端专家的角度，评估项目如何使用 \`@sei/suid\` 组件并遵循 SEI 设计原则和最佳实践。
4. **项目总结**: 基于组件分析和 SEI 集成提供项目的全面总结。
5. **编程风格**: 记录符合 SEI 前端标准的项目关键编程风格、组件架构、状态管理模式和开发实践。

**最终输出：**

将完整内容写入 \`${contextFileName}\` 文件。输出必须是格式良好的 Markdown。
`,
    };
  },
};
