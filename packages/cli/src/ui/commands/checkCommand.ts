/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SlashCommand } from './types.js';
import { CommandKind } from './types.js';

export const checkCommand: SlashCommand = {
  name: 'check',
  description: 'Code review commands',
  kind: CommandKind.BUILT_IN,
  subCommands: [
    {
      name: 'diff',
      description: 'Execute git diff and run code review using AI',
      kind: CommandKind.BUILT_IN,
      action: async (context) => {
        const config = context.services.config;
        if (!config) {
          return {
            type: 'message',
            messageType: 'error',
            content: 'Config is not available',
          };
        }

        try {
          // Submit a prompt asking the AI to perform code review with Chinese output
          const codeReviewPrompt = `你是一位资深的软件开发工程师，专注于代码的规范性、功能性、安全性和稳定性。本次任务是对员工提交的代码变更进行严格审查，结合内部审核规则与审查标准，输出结构化报告。

## 审核规则摘要（重点遵循）
以下是你必须参考的核心规则要点，请在审查中严格执行：

### Part0: 通用规则
- 遵循团队的编码规范和最佳实践
- 识别潜在的错误、漏洞和性能问题

### Part1: 代码风格与质量
#### 代码风格与格式
- 类和接口使用首字母大写的驼峰命名法（PascalCase）
- 方法和变量使用小写字母开头的驼峰命名法（camelCase）
- 常量使用全大写字母和下划线（UPPER_SNAKE_CASE）
- 包名使用全小写字母
- 名称应当具有描述性，清晰表达其用途

#### 代码质量
- 采用单一职责原则，将复杂逻辑拆分为独立方法或模块，识别并消除重复代码，考虑使用设计模式，
- 避免过长的表达式，将复杂条件提取为命名良好的函数或变量
- 函数长度合理（通常不超过30-50行），参数数量合理（通常不超过3-4个）
- 不能有测试代码，业务逻辑与数据处理分离
- 不应该有没有使用到的变量、方法或导入

### Part2 功能、安全与性能
#### 功能规则
- 所有外部输入必须进行校验（如非空检查、类型检查、范围检查等）
- 获取对象的属性前进行判空处理，避免空指针异常
- 不要捕获通用的Exception异常，而应该捕获特定的异常
- 在捕获异常时，记录异常信息以便于调试
- 捕获到的异常不能忽略，要打印相应的日志

#### 性能与效率
- 选择适当的算法，优化时间复杂度和空间复杂度
- 及时释放资源（文件句柄、连接等），避免内存泄漏
- 避免在循环中执行数据库查询（避免 N+1）
- 正确处理并发访问，避免死锁和竞态条件

#### 日志
- 日志级别选择正确（error、warn、info、debug）
- 业务日志包含关键参数，如userId、bizSeq等，便于问题排查
- 不符合预期的情况，如未知异常或特殊场景，打印相关日志

#### 可维护性
- 代码适当模块化，模块之间低耦合，模块内部高内聚
- 代码具有良好的可读性，命名规范，注释清晰
- 避免大量重复代码，方法参数过多（可封装成一个DTO对象）
- 方法过长（抽小函数），判断条件太多（优化if...else）

### 问题描述和优化建议
若未发现问题，写："未发现明显问题"。

请列出所有发现的问题，每条问题必须包含以下五个部分：
1. **位置**：文件名与行号范围
2. **问题描述**：简要说明问题本质
3. **影响**：可能导致的后果
4. **建议**：文字性改进建议
5. **建议代码**（如有）：提供修复后的代码片段

请分块输出修改建议，方便用户同意修修复建议后执行代码修改。

现在，请执行 "git diff" 命令获取代码变更内容，并根据上述规则进行详细代码审查，输出结果请使用中文。`;

          return {
            type: 'submit_prompt',
            content: [
              {
                text: codeReviewPrompt,
              },
            ],
          };
        } catch (error) {
          return {
            type: 'message',
            messageType: 'error',
            content: `Error initiating check: ${(error as Error).message}`,
          };
        }
      },
    },
    {
      name: 'pull',
      description: 'Execute git pull and summarize the changes using AI',
      kind: CommandKind.BUILT_IN,
      action: async (context) => {
        const config = context.services.config;
        if (!config) {
          return {
            type: 'message',
            messageType: 'error',
            content: 'Config is not available',
          };
        }

        // Submit a prompt to AI asking it to execute git pull, get changes, and summarize them
        const pullAndSummarizePrompt = `你是一位资深的软件开发工程师。请执行以下操作：
1. 执行 "git pull" 命令更新本地代码
2. 如果 pull 成功执行，获取本次更新的代码变更内容
3. 使用中文按照提交人总结本次 pull 的主要改动，包括：
   - 通过代码改动和提交消息，分析总结出本次更新主要实现、变更以及删除的功能
   - 本次更新可能引入的风险点，以及对现有功能可能产生的影响
   - 按提交人和提交消息分类说明
请详细分析变更内容并提供总结报告。`;

        return {
          type: 'submit_prompt',
          content: [
            {
              text: pullAndSummarizePrompt,
            },
          ],
        };
      },
    },
  ],
};
