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
import { getCurrentGeminiMdFilename } from '@qwen-code/qwen-code-core';
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
      You are EADP Code, an interactive CLI agent. Analyze the current directory and generate a comprehensive ${contextFileName} file to be used as instructional context for future interactions.

**Analysis Process:**

1. **Initial Exploration:**
   - Begin by listing all files and directories to understand the high-level structure.
   - Check for a \`README.md\` or \`README.txt\` file and read it if present—it often contains critical project context.

2. **Iterative Deep Dive (up to 10 files):**
   - Based on initial findings, prioritize reading key files that reveal the project’s nature:
     - For **frontend projects**: examine \`package.json\`, \`src/\`, and any React component files.
     - For **backend projects**: examine \`build.gradle\`, \`settings.gradle\`, and Java source files under \`src/main/java\`.
   - Use insights from each file to guide the selection of subsequent files. You do not need to pre-select all 10 files—let your analysis evolve iteratively.

3. **Project Type Identification:**
   - **Frontend Project**: Identified by the presence of \`package.json\` and React-related dependencies. **All frontend projects must use the \`@sei/suid\` package**. 
   Your analysis must focus on how this package is integrated and used.
   - **Backend Project**: Identified by \`build.gradle\` and Java source structure. **All backend projects belong to the \`com.changhong.sei\` package namespace** and use one or more of the following SEI SDKs:
     - \`sei-cloud-nacos-starter\`: for microservice registration, discovery, and configuration.
     - \`sei-basic-api\`: for accessing user, organization, company, role, and permission data.
     - \`sei-edm-sdk\`: for attachment/file storage operations.
     - \`sei-notify-sdk\`: for sending notifications (SMS, email, internal messages).
     - \`sei-serial-sdk\`: for generating unified serial numbers (e.g., order IDs).
   - **There are no “non-code” projects**. Every directory analyzed is either a frontend or backend code project as defined above.

**${contextFileName} Content Generation:**

# Frontend Projects
- **Technology Stack**: React  
- **Dependency Analysis**: Analyze project dependencies via \`package.json\`  
- **Mandatory Package**: All frontend projects must include a reference to \`@sei/suid\`  
- **Analysis Focus**: Deeply analyze how \`@sei/suid\` is utilized in the project  
- **Specification Level**: Elevate the usage specifications of \`@sei/suid\` to the highest level  
- **Example Requirement**: Provide example code demonstrating proper integration and usage of \`@sei/suid\` in React components  

# Backend Projects
- **Technology Stack**: Java  
- **Dependency Analysis**: Analyze project dependencies via \`build.gradle\`  
- **Module Structure**: Project module classification defined in \`settings.gradle\`  
- **Mandatory Packages**: All backend projects must include packages under \`com.changhong.sei\`  
- **Key Components and Usage**:  
  - \`sei-cloud-nacos-starter\`: Microservice governance suite for service registration and discovery  
  - \`sei-basic-api\`: Basic application suite providing APIs for user, organization, company, permission, and position management  
  - \`sei-edm-sdk\`: Attachment storage services for file upload and management  
  - \`sei-notify-sdk\`: Message sending services for system notifications and alerts  
  - \`sei-serial-sdk\`: Unified order number services for generating unique order identifiers  
- **Specification Level**: Elevate the usage specifications of these components to the highest level  
- **Example Requirement**: Provide complete example code demonstrating proper configuration and invocation of each component in Java projects

**Final Output:**

Write the complete content to the \`${contextFileName}\` file. The output must be well-formatted Markdown.
You are EADP Code, an interactive CLI agent. Analyze the current directory and generate a comprehensive ${contextFileName} file to be used as instructional context for future interactions.
`,
    };
  },
};
